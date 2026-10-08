import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import * as box from '../lib/attachment/box.js';
import { mediaRoutes } from '../lib/attachment/media.js';
import { showcaseRoutes } from '../lib/attachment/showcase.js';
import { parseArticleHtml, coverFilenameFromUrl } from '../lib/attachment/showcase-source.js';
import {
  ATTACHMENT_PROVIDER_NJUBOX,
  MEDIA_KEEP_STATUS,
  mediaFromRow,
  mediaRow,
  showcaseRow,
  sanitizeFilename,
  sanitizeDirname,
} from '../lib/attachment/store.js';

/* -------------------------------------------------------------------------- *
 * 合成基建
 * -------------------------------------------------------------------------- */

const BOX_CONFIG = {
  njuboxToken: 'box-token-test',
  njuboxRepoId: 'repo-test-id',
  njuboxSubmissionsDir: '/内容投稿',
  njuboxMediaDir: '/影像素材',
  njuboxShowcaseDir: '/宣传展示',
};

/** 按 URL 分派的 Box fetch mock；failOn 可指定 URL 片段返回 404。 */
function boxFetch(calls = [], { failOn = '' } = {}) {
  return async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, method: init.method || 'GET', form: init.body && typeof init.body === 'string' ? init.body : null });
    if (failOn && href.includes(failOn)) {
      return new Response('{"error_msg": "not found"}', { status: 404 });
    }
    if (href.includes('/upload-link/')) return new Response(JSON.stringify('https://box.nju.edu.cn/seafhttp/upload/abc'), { status: 200 });
    if (href.includes('/file/?') && (init.method || 'GET') === 'GET') return new Response(JSON.stringify('https://box.nju.edu.cn/seafhttp/files/xyz'), { status: 200 });
    if (href.includes('/dir/?') && (init.method || 'GET') === 'GET') return new Response('[]', { status: 200 });
    return new Response('ok', { status: 200 });
  };
}

function mediaHarness({ rows = [], projectRows = [], config = {} } = {}) {
  // 行必须有唯一 _id，updateRow 才能命中正确目标（SeaTable 行语义）。
  rows.forEach((row, index) => { if (!row._id) row._id = `row-${index + 1}`; });
  const calls = { json: [], audit: [], updated: [] };
  const client = {
    listRows: async (table) => (table === '活动项目表' ? projectRows.map((row) => ({ ...row })) : rows.map((row) => ({ ...row }))),
    appendRow: async (table, row) => {
      const created = { ...row, _id: `row-${rows.length + 1}` };
      rows.push(created);
      return created;
    },
    updateRow: async (table, rowId, patch) => {
      calls.updated.push({ table, rowId, patch });
      const target = rows.find((row) => row._id === rowId);
      if (target) Object.assign(target, patch);
      return { ok: true };
    },
  };
  const session = { username: 'tester', csrf: 'csrf-token' };
  const ctx = {
    json: (res, status, payload) => {
      calls.json.push({ status, payload });
      return payload;
    },
    readJson: async (req) => req.__body ?? {},
    getBase: async () => client,
    requirePortalSession: () => session,
    requireCsrf: () => true,
    recordAudit: async (req, s, action, target, outcome) => {
      calls.audit.push({ action, target, outcome });
    },
    enforceLimit: () => {},
    ownsBusinessRef: (s, value) => ['tester', 'ACC-1'].includes(String(value || '')),
    businessAccountRef: () => 'ACC-1',
    // 摄影师名由账号实名强制提供（要求3）。
    resolveRealName: () => '张三',
    tables: { media: '影像素材表', project: '活动项目表' },
    config: { ...BOX_CONFIG, ...config },
  };
  return { ctx, calls, rows };
}

function makeReq({ method, url, headers = {}, body = null, json = null }) {
  const stream = Readable.from(body ? [body] : []);
  stream.method = method;
  stream.url = url.pathname;
  stream.headers = headers;
  if (json !== null) stream.__body = json;
  return stream;
}

async function multipartBody(fields, files) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields || {})) form.append(name, value);
  for (const { field = 'files', filename, type, bytes } of files || []) {
    form.append(field, new Blob([bytes], { type }), filename);
  }
  const response = new Response(form);
  return { body: Buffer.from(await response.arrayBuffer()), headers: { 'content-type': response.headers.get('content-type') } };
}

function mockRes() {
  const state = { statusCode: 0, headers: {}, body: '' };
  return {
    writeHead(code, headers) { state.statusCode = code; Object.assign(state.headers, headers || {}); },
    end(chunk) { if (chunk !== undefined) state.body = String(chunk); },
    state,
  };
}

const last = (calls) => {
  assert.ok(calls.json.length, 'expected a json response');
  return calls.json[calls.json.length - 1];
};

/* -------------------------------------------------------------------------- *
 * box.js —— Seafile 客户端契约
 * -------------------------------------------------------------------------- */

test('boxStatus reports unconfigured without crashing', () => {
  const status = box.boxStatus({});
  assert.equal(status.configured, false);
  assert.equal(status.provider, 'njubox');
  assert.equal(status.dirs.media, '/影像素材');
});

test('ensureDir walks segments level by level and tolerates already-exists', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    calls.push(href);
    if (init.method === 'POST') {
      // 第一层已存在（400 exists 语义在 detail 里），第二层新建成功。
      if (calls.filter((item) => item.includes('operation') || item.includes('/dir/?p=')).length === 1 && href.endsWith(encodeURIComponent('/影像素材'))) {
        return new Response('{"error_msg": "Entry exists"}', { status: 400 });
      }
      return new Response('ok', { status: 200 });
    }
    return new Response('[]', { status: 200 });
  };
  const result = await box.ensureDir({ ...BOX_CONFIG, njuboxFetch: fetchImpl }, 'repo-test-id', '/影像素材/献血活动');
  assert.equal(result.path, '/影像素材/献血活动');
  assert.deepEqual(result.created, ['/影像素材/献血活动']);
  const mkdirCalls = calls.filter((item) => item.includes('/dir/?p='));
  assert.equal(mkdirCalls.length, 2, 'one mkdir per path segment');
});

test('uploadBuffer retries after creating a missing parent dir', async () => {
  const calls = [];
  let uploadLinkCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    const method = init.method || 'GET';
    calls.push({ href, method });
    if (href.includes('/upload-link/')) {
      uploadLinkCalls += 1;
      if (uploadLinkCalls === 1) return new Response('{"error_msg": "Folder not found"}', { status: 404 });
      return new Response(JSON.stringify('https://box.nju.edu.cn/seafhttp/upload/abc'), { status: 200 });
    }
    return new Response('file-id-1', { status: 200 });
  };
  const stored = await box.uploadBuffer({ ...BOX_CONFIG, njuboxFetch: fetchImpl }, {
    repoId: 'repo-test-id',
    dir: '/影像素材/新活动',
    filename: 'photo.jpg',
    buffer: Buffer.from('jpeg-bytes'),
    contentType: 'image/jpeg',
  });
  assert.equal(stored.path, '/影像素材/新活动/photo.jpg');
  // 404 后：mkdir（可能多次，每段一次）→ 重试 upload-link → POST 上传。
  const mkdirs = calls.filter((item) => item.method === 'POST' && item.href.includes('/dir/?p='));
  assert.ok(mkdirs.length >= 1, 'parent dir created before retry');
  assert.equal(uploadLinkCalls, 2, 'upload-link retried once');
});

test('renameFile posts operation=rename with sanitized newname', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ href: String(url), method: init.method || 'GET', form: init.body ?? null });
    return new Response('ok', { status: 200 });
  };
  const result = await box.renameFile({ ...BOX_CONFIG, njuboxFetch: fetchImpl }, 'repo-test-id', '/影像素材/献血/photo.jpg', '献血活动_001.jpg');
  assert.equal(result.filename, '献血活动_001.jpg');
  assert.equal(result.path, '/影像素材/献血/献血活动_001.jpg');
  const rename = calls.find((item) => item.form);
  assert.equal(rename.method, 'POST');
  assert.match(rename.form, /operation=rename/);
  assert.match(rename.form, /newname=/);
});

test('deleteFile and deleteDir treat 404 as already deleted', async () => {
  const fetchImpl = async (url, init = {}) => {
    if ((init.method || 'GET') === 'DELETE') return new Response('{"error_msg": "not found"}', { status: 404 });
    return new Response('[]', { status: 200 });
  };
  assert.equal(await box.deleteFile({ ...BOX_CONFIG, njuboxFetch: fetchImpl }, 'r', '/a/b.png'), false);
  assert.equal(await box.deleteDir({ ...BOX_CONFIG, njuboxFetch: fetchImpl }, 'r', '/a'), false);
});

/* -------------------------------------------------------------------------- *
 * store.js —— 清洗与行映射
 * -------------------------------------------------------------------------- */

test('sanitizeFilename strips paths and control characters, keeps extension', () => {
  assert.equal(sanitizeFilename('C:\\evil\\dir\\现场 照片.jpg'), '现场 照片.jpg');
  assert.equal(sanitizeFilename('..hidden'), 'hidden');
  assert.equal(sanitizeFilename(''), '');
  const long = `${'a'.repeat(200)}.png`;
  assert.ok(sanitizeFilename(long).length <= 120);
  assert.ok(sanitizeFilename(long).endsWith('.png'));
});

test('sanitizeDirname keeps CJK, drops filesystem-hostile characters', () => {
  assert.equal(sanitizeDirname('献血活动 2026'), '献血活动 2026');
  assert.equal(sanitizeDirname('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
  assert.equal(sanitizeDirname('   '), '');
});

test('mediaRow and showcaseRow round-trip through their columns', () => {
  const media = mediaRow({
    id: 'PHO-1', center: '生命中心', activity: '献血', photographer: '张三', filename: 'a.png', mimeType: 'image/png', size: 10,
    checksum: 'ABC', repoId: 'r', path: '/影像素材/生命中心/献血_张三/a.png',
    keepStatus: MEDIA_KEEP_STATUS.keep, uploader: 'ACC-1', uploadedAt: '2026-10-06T00:00:00.000Z',
  });
  assert.equal(media['留用状态'], '留用');
  assert.equal(media['存储提供商'], 'njubox');
  assert.equal(media['中心'], '生命中心');
  assert.equal(media['摄影师'], '张三');
  // 往返：行 → 领域对象应还原中心/摄影师。
  const back = mediaFromRow({ ...media, _id: 'x' });
  assert.equal(back.center, '生命中心');
  assert.equal(back.photographer, '张三');
  assert.equal(back.activity, '献血');
  const row = showcaseRow({ id: 'SHW-1', group: '推荐', title: 't', link: 'https://x', order: 3, source: '手动导入', createdAt: 'now' });
  assert.equal(row['排序'], '3');
  assert.equal(row['来源'], '手动导入');
});

/* -------------------------------------------------------------------------- *
 * media.js —— 影像模块端点
 * -------------------------------------------------------------------------- */

const PROJECTS = [
  { '活动名称': '无偿献血进校园', '状态': '已结束' },
  { '活动名称': '急救培训 AED', '状态': '报名中' },
  { '活动名称': '无偿献血进校园', '状态': '已结束' },
];

test('media activities endpoint dedupes project names and exposes centers', async () => {
  const harness = mediaHarness({ projectRows: PROJECTS });
  await mediaRoutes(makeReq({ method: 'GET', url: new URL('http://l/api/public/media/activities') }), {}, new URL('http://l/api/public/media/activities'), harness.ctx);
  const payload = last(harness.calls).payload;
  assert.equal(payload.activities.length, 2);
  assert.equal(payload.activities[0].name, '无偿献血进校园');
  // 5 个固定中心随活动候选一并下发（要求2）。
  assert.deepEqual(payload.centers, ['生命中心', '博爱中心', '综事中心', '苏州分部', '主席团活动']);
});

test('media upload requires a valid center and allows free-text activity names', async () => {
  // 缺中心 → 拒绝
  const noCenter = mediaHarness({ projectRows: PROJECTS, config: { njuboxFetch: boxFetch() } });
  const a = await multipartBody({ activity: '临时新活动' }, [{ filename: 'a.png', type: 'image/png', bytes: Buffer.from('png') }]);
  await mediaRoutes(makeReq({ method: 'POST', url: new URL('http://l/api/public/media'), body: a.body, headers: a.headers }), {}, new URL('http://l/api/public/media'), noCenter.ctx);
  assert.equal(last(noCenter.calls).status, 400);
  assert.equal(last(noCenter.calls).payload.code, 'media_center_invalid');

  // 非法中心 → 拒绝
  const badCenter = mediaHarness({ projectRows: PROJECTS, config: { njuboxFetch: boxFetch() } });
  const b = await multipartBody({ center: '不存在的中心', activity: '临时新活动' }, [{ filename: 'a.png', type: 'image/png', bytes: Buffer.from('png') }]);
  await mediaRoutes(makeReq({ method: 'POST', url: new URL('http://l/api/public/media'), body: b.body, headers: b.headers }), {}, new URL('http://l/api/public/media'), badCenter.ctx);
  assert.equal(last(badCenter.calls).status, 400);
  assert.equal(last(badCenter.calls).payload.code, 'media_center_invalid');

  // 手填新活动名（不在活动广场名单）+ 合法中心 → 允许入库
  const ok = mediaHarness({ projectRows: PROJECTS, config: { njuboxFetch: boxFetch() } });
  const c = await multipartBody({ center: '生命中心', activity: '临时新活动' }, [{ filename: 'a.png', type: 'image/png', bytes: Buffer.from('png') }]);
  await mediaRoutes(makeReq({ method: 'POST', url: new URL('http://l/api/public/media'), body: c.body, headers: c.headers }), {}, new URL('http://l/api/public/media'), ok.ctx);
  assert.equal(last(ok.calls).status, 201);
  assert.equal(ok.rows.length, 1);
});

test('media upload stores photos under <center>/<activity>_<photographer> and writes rows', async () => {
  const calls = [];
  const harness = mediaHarness({ projectRows: PROJECTS, config: { njuboxFetch: boxFetch(calls) } });
  const { body, headers } = await multipartBody(
    { center: '博爱中心', activity: '无偿献血进校园' },
    [
      { filename: '现场1.jpg', type: 'image/jpeg', bytes: Buffer.from('jpeg-1') },
      { filename: '现场2.jpg', type: 'image/jpeg', bytes: Buffer.from('jpeg-2') },
      { filename: 'notes.txt', type: 'text/plain', bytes: Buffer.from('not an image') },
    ],
  );
  await mediaRoutes(makeReq({ method: 'POST', url: new URL('http://l/api/public/media'), body, headers }), {}, new URL('http://l/api/public/media'), harness.ctx);
  const payload = last(harness.calls).payload;
  assert.equal(payload.photos.length, 2);
  assert.equal(payload.failed.length, 1);
  assert.match(payload.failed[0].reason, /图片/);
  assert.equal(harness.rows.length, 2);
  assert.equal(harness.rows[0]['中心'], '博爱中心');
  assert.equal(harness.rows[0]['活动名'], '无偿献血进校园');
  assert.equal(harness.rows[0]['摄影师'], '张三');
  // Box 路径：/影像素材/<中心>/<活动名>_<摄影师>/<文件>（要求2/3）。
  assert.equal(harness.rows[0]['文件路径'], '/影像素材/博爱中心/无偿献血进校园_张三/现场1.jpg');
  assert.equal(harness.rows[0]['留用状态'], '待定');
  assert.equal(harness.rows[0]['库ID'], 'repo-test-id');
  assert.equal(calls[0].url.includes('/upload-link/?p='), true);
});

test('media list groups photos into folders per center/activity/photographer', async () => {
  const harness = mediaHarness({
    rows: [
      mediaRow({ id: 'PHO-F1', center: '生命中心', activity: '献血', photographer: '张三', filename: 'a.png', mimeType: 'image/png', size: 3, keepStatus: '留用', uploader: 'ACC-1' }),
      mediaRow({ id: 'PHO-F2', center: '生命中心', activity: '献血', photographer: '张三', filename: 'b.png', mimeType: 'image/png', size: 5, keepStatus: '待定', uploader: 'ACC-1' }),
      mediaRow({ id: 'PHO-F3', center: '苏州分部', activity: '培训', photographer: '张三', filename: 'c.png', mimeType: 'image/png', size: 7, keepStatus: '待定', uploader: 'ACC-1' }),
    ],
  });
  const url = new URL('http://l/api/public/media');
  await mediaRoutes(makeReq({ method: 'GET', url }), {}, url, harness.ctx);
  const payload = last(harness.calls).payload;
  assert.equal(payload.folders.length, 2);
  const hemo = payload.folders.find((f) => f.activity === '献血');
  assert.equal(hemo.center, '生命中心');
  assert.equal(hemo.count, 2);
  assert.equal(hemo.keepCount, 1);
  assert.equal(hemo.totalSize, 8);
  assert.equal(hemo.folderName, '献血_张三');
  const su = payload.folders.find((f) => f.activity === '培训');
  assert.equal(su.center, '苏州分部');
  assert.equal(su.folderName, '培训_张三');
});

test('media keep/delete guard ownership and states', async () => {
  const harness = mediaHarness({
    rows: [
      mediaRow({ id: 'PHO-1', activity: 'a', filename: 'x.png', mimeType: 'image/png', size: 1, repoId: 'r', path: '/影像素材/a/x.png', keepStatus: '待定', uploader: 'ACC-1' }),
      mediaRow({ id: 'PHO-2', activity: 'a', filename: 'y.png', mimeType: 'image/png', size: 1, keepStatus: '待定', uploader: 'someone-else' }),
    ],
    config: { njuboxFetch: boxFetch() },
  });
  const keepUrl = new URL('http://l/api/public/media/PHO-1');
  await mediaRoutes(makeReq({ method: 'PATCH', url: keepUrl, json: { keep: '留用' } }), {}, keepUrl, harness.ctx);
  assert.equal(last(harness.calls).status, 200);
  assert.equal(harness.rows[0]['留用状态'], '留用');
  const badKeep = new URL('http://l/api/public/media/PHO-1');
  await mediaRoutes(makeReq({ method: 'PATCH', url: badKeep, json: { keep: '任意' } }), {}, badKeep, harness.ctx);
  assert.equal(last(harness.calls).status, 400);
  const foreign = new URL('http://l/api/public/media/PHO-2');
  await mediaRoutes(makeReq({ method: 'PATCH', url: foreign, json: { keep: '留用' } }), {}, foreign, harness.ctx);
  assert.equal(last(harness.calls).status, 403);
  const delUrl = new URL('http://l/api/public/media/PHO-1');
  await mediaRoutes(makeReq({ method: 'DELETE', url: delUrl }), {}, delUrl, harness.ctx);
  assert.equal(last(harness.calls).status, 200);
  assert.equal(harness.rows[0]['留用状态'], '已删除');
});

test('media link endpoint returns a fresh Box direct link for own photos', async () => {
  const harness = mediaHarness({
    rows: [mediaRow({ id: 'PHO-L', center: '生命中心', activity: 'a', photographer: '张三', filename: 'x.png', mimeType: 'image/png', size: 1, repoId: 'repo-test-id', path: '/影像素材/生命中心/a_张三/x.png', keepStatus: '待定', uploader: 'ACC-1' })],
    config: { njuboxFetch: boxFetch() },
  });
  const url = new URL('http://l/api/public/media/PHO-L/link');
  await mediaRoutes(makeReq({ method: 'GET', url }), {}, url, harness.ctx);
  const payload = last(harness.calls).payload;
  assert.equal(payload.link, 'https://box.nju.edu.cn/seafhttp/files/xyz');
});

test('media batch-rename numbers photos within one folder and rejects cross-folder', async () => {
  const calls = [];
  const dirListing = [{ name: '活动_001.png', type: 'file' }];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    const method = init.method || 'GET';
    calls.push({ href, method });
    if (href.includes('/dir/?') && method === 'GET') {
      return new Response(JSON.stringify(dirListing), { status: 200 });
    }
    if (href.includes('/file/?') && method === 'GET') {
      return new Response(JSON.stringify('https://box.nju.edu.cn/seafhttp/files/xyz'), { status: 200 });
    }
    return new Response('ok', { status: 200 });
  };
  const harness = mediaHarness({
    rows: [
      mediaRow({ id: 'PHO-R1', center: '生命中心', activity: '活动', photographer: '张三', filename: 'IMG_001.png', mimeType: 'image/png', size: 1, repoId: 'repo-test-id', path: '/影像素材/生命中心/活动_张三/IMG_001.png', keepStatus: '待定', uploader: 'ACC-1' }),
      mediaRow({ id: 'PHO-R2', center: '生命中心', activity: '活动', photographer: '张三', filename: 'IMG_002.png', mimeType: 'image/png', size: 1, repoId: 'repo-test-id', path: '/影像素材/生命中心/活动_张三/IMG_002.png', keepStatus: '待定', uploader: 'ACC-1' }),
      // 同一活动但不同中心：应被判定为跨文件夹。
      mediaRow({ id: 'PHO-R3', center: '苏州分部', activity: '活动', photographer: '张三', filename: 'z.png', mimeType: 'image/png', size: 1, keepStatus: '待定', uploader: 'ACC-1' }),
    ],
    config: { njuboxFetch: fetchImpl },
  });
  const url = new URL('http://l/api/public/media/batch-rename');
  await mediaRoutes(makeReq({ method: 'POST', url, json: { ids: ['PHO-R1', 'PHO-R2'] } }), {}, url, harness.ctx);
  const payload = last(harness.calls).payload;
  assert.equal(payload.ok, true);
  // 活动_001 已被占用 → 从 002 开始编号。
  assert.deepEqual(payload.renamed.map((item) => item.newName), ['活动_002.png', '活动_003.png']);
  assert.equal(harness.rows[0]['文件名'], '活动_002.png');
  assert.equal(harness.rows[0]['文件路径'], '/影像素材/生命中心/活动_张三/活动_002.png');
  // 跨文件夹（同活动名、不同中心）批量更名被拒绝。
  await mediaRoutes(makeReq({ method: 'POST', url, json: { ids: ['PHO-R1', 'PHO-R3'] } }), {}, url, harness.ctx);
  assert.equal(last(harness.calls).status, 400);
  assert.equal(last(harness.calls).payload.code, 'media_rename_cross_activity');
});

/* -------------------------------------------------------------------------- *
 * showcase.js —— 展示板块
 * -------------------------------------------------------------------------- */

function showcaseHarness({ rows = [], config = {} } = {}) {
  const calls = { json: [] };
  const client = {
    listRows: async () => rows.map((row) => ({ ...row })),
  };
  const ctx = {
    json: (res, status, payload) => {
      calls.json.push({ status, payload });
      return payload;
    },
    getBase: async () => client,
    enforceLimit: () => {},
    tables: { showcase: '宣传展示表' },
    config: { ...BOX_CONFIG, ...config },
  };
  return { ctx, calls };
}

test('showcase list groups items and orders by the order column', async () => {
  const harness = showcaseHarness({
    rows: [
      showcaseRow({ id: 'SHW-2', group: '公众号推荐', title: '文章 B', link: 'https://b', order: 2, createdAt: '2026-10-01' }),
      showcaseRow({ id: 'SHW-1', group: '公众号推荐', title: '文章 A', link: 'https://a', order: 1, createdAt: '2026-10-02' }),
      showcaseRow({ id: 'SHW-3', group: '精选推荐', title: '精选 C', link: 'https://c', coverPath: '/宣传展示/精选/c.jpg', repoId: 'repo-test-id', order: 1, createdAt: '2026-10-03' }),
      showcaseRow({ id: 'SHW-BAD', group: '精选推荐', title: '', link: '', order: 3 }),
    ],
  });
  const url = new URL('http://l/api/public/showcase');
  await showcaseRoutes(makeReq({ method: 'GET', url }), {}, url, harness.ctx);
  const payload = last(harness.calls).payload;
  assert.equal(payload.total, 3);
  // 同序号时按创建时间倒序：精选 C（10-03）排在文章 A（10-02）之前，
  // 分组按首见顺序聚合 → 精选推荐在前。
  assert.deepEqual(payload.groups.map((group) => group.name), ['精选推荐', '公众号推荐']);
  const featured = payload.groups[0].items[0];
  assert.equal(featured.title, '精选 C');
  assert.equal(featured.coverUrl, '/api/public/showcase/covers/SHW-3');
});

test('showcase cover endpoint 302-redirects to a fresh Box link', async () => {
  const harness = showcaseHarness({
    rows: [showcaseRow({ id: 'SHW-C', group: 'g', title: 't', link: 'https://t', coverPath: '/宣传展示/g/c.jpg', repoId: 'repo-test-id', order: 1 })],
    config: { njuboxFetch: boxFetch() },
  });
  const url = new URL('http://l/api/public/showcase/covers/SHW-C');
  const res = mockRes();
  const handled = await showcaseRoutes(makeReq({ method: 'GET', url }), res, url, harness.ctx);
  assert.equal(handled, true);
  assert.equal(res.state.statusCode, 302);
  assert.equal(res.state.headers.location, 'https://box.nju.edu.cn/seafhttp/files/xyz');
  // 无封面 → 404。
  const missing = new URL('http://l/api/public/showcase/covers/NOPE');
  const res404 = mockRes();
  await showcaseRoutes(makeReq({ method: 'GET', url: missing }), res404, missing, harness.ctx);
  assert.equal(res404.state.statusCode, 404);
});

/* -------------------------------------------------------------------------- *
 * showcase-source.js —— 公众号抓取适配层
 * -------------------------------------------------------------------------- */

test('parseArticleHtml extracts og:title and og:image', () => {
  const html = '<html><head>'
    + '<meta property="og:title" content="红十字应急救护培训纪实&amp;回顾" />'
    + '<meta property="og:image" content="https://mmbiz.qpic.cn/mmbiz_jpg/abc123/640?wx_fmt=jpeg" />'
    + '</head><body>...</body></html>';
  const article = parseArticleHtml(html, 'https://mp.weixin.qq.com/s/abc');
  assert.equal(article.title, '红十字应急救护培训纪实&回顾');
  assert.equal(article.coverUrl, 'https://mmbiz.qpic.cn/mmbiz_jpg/abc123/640?wx_fmt=jpeg');
  assert.equal(article.coverFilename, '640.jpg');
});

test('parseArticleHtml throws without a title; coverFilenameFromUrl falls back safely', () => {
  assert.throws(() => parseArticleHtml('<html></html>', 'https://x'), /解析标题/);
  assert.equal(coverFilenameFromUrl('https://mmbiz.qpic.cn/mmbiz/COVER!!名称.jpeg'), 'COVER-名称.jpeg');
  assert.equal(coverFilenameFromUrl('not a url'), 'cover.jpg');
});
