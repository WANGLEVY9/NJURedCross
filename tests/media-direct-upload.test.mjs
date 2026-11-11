import test from 'node:test';
import assert from 'node:assert/strict';

import { mediaRoutes, clearUploadTickets, readUploadTicket, UPLOAD_TICKET_TTL_MS } from '../lib/attachment/media.js';
import { requestBudgetMsFor, DEFAULT_REQUEST_BUDGET_MS, UPLOAD_REQUEST_BUDGET_MS } from '../lib/http/request-budget.js';
import { isMetadataOnlyFailure } from '../public/app/core/upload-retry.js';

/* -------------------------------------------------------------------------- *
 * 2026-11-12：照片改为「浏览器直传 NJU Box」
 *
 * 背景：中转链路是「浏览器 → 新加坡 → 南京 Box」两段跨境，5MB 单张 60～90 秒，
 * 还会撞上 30 秒请求预算，导致文件进了云盘、相册表没有记录。直传把字节挪出服务器，
 * 服务端只负责签票据与复核落库。
 * -------------------------------------------------------------------------- */

/* ---------------------------- 请求预算 ---------------------------- */

test('上传类接口单独放宽到 180 秒，其余仍是 30 秒', () => {
  assert.equal(UPLOAD_REQUEST_BUDGET_MS, 180_000);
  assert.equal(DEFAULT_REQUEST_BUDGET_MS, 30_000);

  for (const path of ['/api/public/media', '/api/public/attachments/ATT-1', '/api/console/showcase/batch']) {
    assert.equal(requestBudgetMsFor('POST', path), UPLOAD_REQUEST_BUDGET_MS, `${path} 应放宽`);
  }
  // 读路径与普通写接口保持 30 秒的快速失败语义。
  for (const [method, path] of [
    ['GET', '/api/public/media'],
    ['POST', '/api/public/media/picks'],
    ['POST', '/api/public/media/batch-rename'],
    ['POST', '/api/public/attachments'],
    ['DELETE', '/api/public/media/PHO-1'],
  ]) {
    assert.equal(requestBudgetMsFor(method, path), DEFAULT_REQUEST_BUDGET_MS, `${method} ${path} 不应放宽`);
  }
});

/* ---------------------------- 票据生命周期 ---------------------------- */

test('直传票据：过期即失效，清空后读不到', () => {
  clearUploadTickets();
  assert.equal(readUploadTicket('TKT-NOPE'), null);
  // TTL 常量本身也要是「够传完 20MB、又不长期占内存」的量级。
  assert.ok(UPLOAD_TICKET_TTL_MS >= 10 * 60 * 1000 && UPLOAD_TICKET_TTL_MS <= 60 * 60 * 1000);
});

/* ---------------------------- 端到端：票据 → 复核 → 落表 ---------------------------- */

/** 假的 Seafile：内存目录树 + 可记录调用，够跑 ensureDir / upload-link / listDir。 */
function createFakeBox() {
  const tree = new Map([['/', []]]);
  const calls = [];
  const addDir = (parent, name) => {
    const list = tree.get(parent) || [];
    if (!list.some((item) => item.type === 'dir' && item.name === name)) {
      list.push({ type: 'dir', name });
      tree.set(parent, list);
    }
  };
  addDir('/', '博爱中心');

  const fetchImpl = async (url, init = {}) => {
    const text = String(url);
    calls.push({ url: text, method: init.method || 'GET' });
    let parsed;
    try {
      parsed = new URL(text);
    } catch {
      return new Response('bad url', { status: 400 });
    }
    const path = parsed.searchParams.get('path');
    if (parsed.pathname.endsWith('/dir/')) {
      if (init.method === 'POST') {
        const parent = path.slice(0, path.lastIndexOf('/')) || '/';
        const name = path.slice(path.lastIndexOf('/') + 1);
        addDir(parent, name);
        tree.set(path, tree.get(path) || []);
        return new Response(JSON.stringify({ success: true }));
      }
      const entries = tree.get(path);
      if (!entries) return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 });
      return new Response(JSON.stringify({ dirent_list: entries }));
    }
    if (parsed.pathname.endsWith('/upload-link/')) {
      // 真实 Seafile 的直链是按目录签发的：把路径编进 token，测试才能区分
      // 「主图目录」和「缩略图目录」拿到的不是同一条链接。
      const slug = Buffer.from(path, 'utf8').toString('base64url');
      return new Response(JSON.stringify(`https://box.example/seafhttp/upload-api/${slug}?replace=1`));
    }
    if (parsed.pathname.endsWith('/download-link/')) {
      return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 });
    }
    return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 });
  };
  return { tree, calls, fetchImpl };
}

function createCtx(fetchImpl) {
  const appended = [];
  const audits = [];
  return {
    appended,
    audits,
    ctx: {
      json: (res, status, payload) => { res.status = status; res.body = payload; return payload; },
      readJson: async (req) => req.body,
      getBase: async () => ({
        listRows: async () => [{ 活动名称: '11.8 手语拍摄（鼓楼）', 中心: '博爱中心', 状态: '已结束' }],
        appendRow: async (table, row) => { appended.push({ table, row }); return { _id: `row-${appended.length}` }; },
      }),
      recordAudit: async (...args) => { audits.push(args); },
      enforceLimit: () => {},
      requirePortalSession: () => ({ username: 'volunteer1' }),
      requireCsrf: () => true,
      ownsBusinessRef: (session, ref) => ref === `account:${session.username}`,
      businessAccountRef: (session) => `account:${session.username}`,
      resolveRealName: () => '张三',
      tables: { media: '影像素材表', project: '活动项目表' },
      workflowActivities: async () => [],
      config: { njuboxToken: 'token', njuboxPicksToken: 'picks', njuboxServerUrl: 'https://box.example', njuboxFetch: fetchImpl },
    },
  };
}

function callRoute(ctx, method, path, body) {
  const res = {};
  const req = { method, headers: {}, body };
  const url = new URL(`https://njuredcross.cn${path}`);
  return mediaRoutes(req, res, url, ctx).then((returned) => ({ res, returned }));
}

test('直传：票据给出目录与直链，复核确认后才落一行', async () => {
  clearUploadTickets();
  const fake = createFakeBox();
  const { ctx, appended, audits } = createCtx(fake.fetchImpl);

  const issued = await callRoute(ctx, 'POST', '/api/public/media/upload-ticket', {
    center: '博爱中心',
    activity: '11.8 手语拍摄（鼓楼）',
    filename: 'e07da40d.jpg',
    size: 5_527_040,
    contentType: 'image/jpeg',
  });
  assert.equal(issued.res.status, 201, JSON.stringify(issued.res.body));
  const ticket = issued.res.body.ticket;
  assert.match(ticket.id, /^TKT-/);
  assert.match(ticket.photoId, /^PHO-/);
  assert.match(ticket.uploadUrl, /^https:\/\/box\.example\/seafhttp\/upload-api\//);
  // 落点是 /<部门>/<活动>/<活动>-照片（三级 v3.1 布局）。
  assert.equal(ticket.dir, '/博爱中心/11.8 手语拍摄（鼓楼）/11.8 手语拍摄（鼓楼）-照片');
  assert.equal(ticket.thumbDir, `${ticket.dir}/_thumbnails`);
  // 主图与缩略图各拿一条按目录签发的直链，不能复用同一条。
  assert.match(ticket.thumbUploadUrl, /^https:\/\/box\.example\/seafhttp\/upload-api\//);
  assert.notEqual(ticket.thumbUploadUrl, ticket.uploadUrl);
  assert.equal(
    Buffer.from(ticket.uploadUrl.split('/upload-api/')[1].split('?')[0], 'base64url').toString('utf8'),
    ticket.dir,
  );
  assert.equal(
    Buffer.from(ticket.thumbUploadUrl.split('/upload-api/')[1].split('?')[0], 'base64url').toString('utf8'),
    ticket.thumbDir,
  );
  assert.equal(appended.length, 0, '发票据时不能写表');
  // 目录必须在发票据前建好，否则 upload-link 会 404。
  assert.ok(fake.calls.some((call) => call.method === 'POST' && call.url.includes('/dir/')), '应先建目录');

  // 模拟浏览器直传成功后的云盘状态
  fake.tree.get(ticket.dir).push({ type: 'file', name: 'e07da40d.jpg', size: 5_527_040, mtime: '2026-11-11T23:09:14+08:00' });

  const confirmed = await callRoute(ctx, 'POST', '/api/public/media/confirm', { ticketId: ticket.id });
  assert.equal(confirmed.res.status, 201, JSON.stringify(confirmed.res.body));
  assert.equal(appended.length, 1);
  const row = appended[0].row;
  assert.equal(row.照片ID, ticket.photoId);
  assert.equal(row.中心, '博爱中心');
  assert.equal(row.活动名, '11.8 手语拍摄（鼓楼）');
  assert.equal(row.文件名, 'e07da40d.jpg');
  assert.equal(row.大小, '5527040');
  assert.equal(row.文件路径, `${ticket.dir}/e07da40d.jpg`);
  assert.equal(row.摄影师, '张三');
  // mtime 是 +08:00，落表统一成 UTC ISO。
  assert.equal(row.上传时间, '2026-11-11T15:09:14.000Z');
  assert.ok(audits.some((args) => args[2] === 'media.photo.upload' && args[4] === 'success'));

  // 重复确认是幂等的：网关超时后重试不能多出一行。
  const again = await callRoute(ctx, 'POST', '/api/public/media/confirm', { ticketId: ticket.id });
  assert.equal(again.res.status, 200);
  assert.equal(again.res.body.duplicate, true);
  assert.equal(appended.length, 1, '重复确认不得再写一行');
});

test('直传复核：云盘没文件 / 大小对不上都拒绝落表', async () => {
  clearUploadTickets();
  const fake = createFakeBox();
  const { ctx, appended } = createCtx(fake.fetchImpl);

  const issued = await callRoute(ctx, 'POST', '/api/public/media/upload-ticket', {
    center: '博爱中心',
    activity: '11.8 手语拍摄（鼓楼）',
    filename: 'IMG_7701.JPG',
    size: 8_000_000,
    contentType: 'image/jpeg',
  });
  const ticket = issued.res.body.ticket;

  // 1) 浏览器根本没传上去
  const missing = await callRoute(ctx, 'POST', '/api/public/media/confirm', { ticketId: ticket.id });
  assert.equal(missing.res.status, 409);
  assert.equal(missing.res.body.code, 'media_upload_incomplete');
  assert.equal(appended.length, 0);

  // 2) 盘上有同名文件，但大小对不上（说明是另一个文件覆盖）
  fake.tree.get(ticket.dir).push({ type: 'file', name: 'IMG_7701.JPG', size: 1_024, mtime: '2026-11-12T00:00:00+08:00' });
  const mismatch = await callRoute(ctx, 'POST', '/api/public/media/confirm', { ticketId: ticket.id });
  assert.equal(mismatch.res.status, 409);
  assert.equal(mismatch.res.body.code, 'media_upload_size_mismatch');
  assert.equal(appended.length, 0, '大小不符不能落表');
});

test('直传复核：票据不存在或不属于当前账号都拒绝', async () => {
  clearUploadTickets();
  const fake = createFakeBox();
  const { ctx } = createCtx(fake.fetchImpl);

  const unknown = await callRoute(ctx, 'POST', '/api/public/media/confirm', { ticketId: 'TKT-FORGED' });
  assert.equal(unknown.res.status, 409);
  assert.equal(unknown.res.body.code, 'media_ticket_expired');

  const issued = await callRoute(ctx, 'POST', '/api/public/media/upload-ticket', {
    center: '博爱中心',
    activity: '11.8 手语拍摄（鼓楼）',
    filename: 'IMG_1.JPG',
    size: 100,
    contentType: 'image/jpeg',
  });
  const other = { ...ctx, ownsBusinessRef: () => false };
  const stolen = await callRoute(other, 'POST', '/api/public/media/confirm', { ticketId: issued.res.body.ticket.id });
  assert.equal(stolen.res.status, 403);
  assert.equal(stolen.res.body.code, 'media_ticket_not_owned');
});

test('直传票据：非图片、超限、活动不属于该中心都当场拒绝', async () => {
  clearUploadTickets();
  const fake = createFakeBox();
  const { ctx } = createCtx(fake.fetchImpl);

  const pdf = await callRoute(ctx, 'POST', '/api/public/media/upload-ticket', {
    center: '博爱中心', activity: '11.8 手语拍摄（鼓楼）', filename: 'a.pdf', size: 100, contentType: 'application/pdf',
  });
  assert.equal(pdf.res.status, 415);

  const huge = await callRoute(ctx, 'POST', '/api/public/media/upload-ticket', {
    center: '博爱中心', activity: '11.8 手语拍摄（鼓楼）', filename: 'a.jpg', size: 21 * 1024 * 1024, contentType: 'image/jpeg',
  });
  assert.equal(huge.res.status, 413);

  const wrongCenter = await callRoute(ctx, 'POST', '/api/public/media/upload-ticket', {
    center: '生命中心', activity: '11.8 手语拍摄（鼓楼）', filename: 'a.jpg', size: 100, contentType: 'image/jpeg',
  });
  assert.equal(wrongCenter.res.status, 400);
  assert.equal(wrongCenter.res.body.code, 'media_activity_not_allowed');
});

/* ---------------------------- 前端：不要重传已存住的照片 ---------------------------- */

test('「照片已存盘、只是没落表」的失败不自动重传', () => {
  // 中转路径：failed[] 里带 code
  assert.equal(isMetadataOnlyFailure({ status: 500, detail: { failed: [{ filename: 'a.jpg', code: 'media_metadata_failed' }] } }), true);
  // 直传路径：顶层 code
  assert.equal(isMetadataOnlyFailure({ status: 502, code: 'media_metadata_failed' }), true);
  // 普通网络/上游失败仍要重试
  assert.equal(isMetadataOnlyFailure({ status: 503, message: '上游超时' }), false);
  assert.equal(isMetadataOnlyFailure({ status: 0, code: 'timeout' }), false);
  assert.equal(isMetadataOnlyFailure(null), false);
});
