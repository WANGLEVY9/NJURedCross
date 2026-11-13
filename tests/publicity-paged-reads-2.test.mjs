import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { attachmentRoutes, outreachSubmissionAttachments } from '../lib/attachment/api.js';
import { consoleShowcaseRoutes } from '../lib/attachment/showcase.js';
import { attachmentRow, ATTACHMENT_PROVIDER_NJUBOX, ATTACHMENT_STATUS } from '../lib/attachment/store.js';

/**
 * 「超过单页 1000 行之后」的行为契约。
 *
 * SeaTable 的 listRows 只发一次请求、服务端单页上限 1000，返回体里也没有任何截断
 * 标记（node_modules/seatable-api/lib/api-gateway.js）。所以任何写成
 * `listRows(表, '', '', false, '', 1000|2000)` 的读取，在表越过千行后都会**静默**
 * 只看到前一千行。投稿附件表只增不删，越线只是时间问题。
 *
 * 这里的分页桩严格按 start/limit 切片、单页上限 1000，复刻真实语义：
 * 「能读到第 1000 行之后」才算通过。
 */

const PAGE_CAP = 1_000;

function attachmentRowAt(index, overrides = {}) {
  return {
    ...attachmentRow({
      id: `ATT-${String(index).padStart(5, '0')}`,
      submissionId: '',
      filename: `f${index}.png`,
      mimeType: 'image/png',
      size: 1024,
      checksum: '',
      provider: ATTACHMENT_PROVIDER_NJUBOX,
      bucket: '',
      objectKey: '',
      status: ATTACHMENT_STATUS.pending,
      uploader: 'ACC-1',
      uploadedAt: '',
      boundAt: '',
      center: '博爱中心',
      activity: '急救培训 AED',
      ...overrides,
    }),
    _id: `rec-${index}`,
  };
}

/** 3000 行：前 1000 行是历史投稿，之后是尚未被任何投稿选中的新行。 */
function bigAttachmentTable() {
  const rows = [];
  for (let i = 0; i < PAGE_CAP; i += 1) {
    rows.push(attachmentRowAt(i, {
      submissionId: `OLD-${i}`,
      status: ATTACHMENT_STATUS.uploaded,
      objectKey: `/旧/${i}.png`,
    }));
  }
  for (let i = PAGE_CAP; i < 1_200; i += 1) rows.push(attachmentRowAt(i));
  return rows;
}

function pagedClient(tables, stats = { calls: 0 }) {
  return {
    async listRows(table, _view, _order, _desc, start = 0, limit = PAGE_CAP) {
      stats.calls += 1;
      const rows = tables[table] || [];
      const from = Number(start) || 0;
      const take = Math.min(Number(limit) || PAGE_CAP, PAGE_CAP);
      return rows.slice(from, from + take).map((row) => ({ ...row }));
    },
    async updateRow() { return { ok: true }; },
    async appendRow() { return { ok: true }; },
  };
}

function makeCtx(tables, extra = {}) {
  const json = [];
  const stats = { calls: 0 };
  const client = pagedClient(tables, stats);
  const ctx = {
    json: (res, status, payload) => { json.push({ status, payload }); return payload; },
    readJson: async () => ({}),
    getBase: async () => client,
    requirePortalSession: () => ({ username: 'tester', csrf: 'c' }),
    requireCsrf: () => true,
    requireConsoleAccess: () => ({ username: 'tester' }),
    recordAudit: async () => {},
    enforceLimit: () => {},
    ownsBusinessRef: (_s, value) => String(value || '') === 'ACC-1',
    businessAccountRef: () => 'ACC-1',
    tables: { attachment: '投稿附件表', submission: '宣传投稿表', project: '活动项目表', showcase: '宣传展示表' },
    config: {},
    ...extra,
  };
  return { ctx, json, stats };
}

function makeReq(method, path) {
  return { method, url: new URL(`http://localhost${path}`), headers: {} };
}

function lastJson(json) {
  assert.ok(json.length, 'expected a json response');
  return json[json.length - 1];
}

/* ------------------------------------------------------------------ *
 * 投稿附件：越千行后仍然可读
 * ------------------------------------------------------------------ */

test('超过 1000 行时 /mine 仍能看到页外附件（否则「待绑定附件」恒空）', async () => {
  const { ctx, json } = makeCtx({ 投稿附件表: bigAttachmentTable() });
  await attachmentRoutes(makeReq('GET', '/api/public/attachments/mine'), {}, new URL('http://localhost/api/public/attachments/mine'), ctx);

  const payload = lastJson(json).payload;
  assert.equal(payload.attachments.length, 200, '页外 200 条必须全部可见');
  assert.ok(
    payload.attachments.some((item) => item.id === 'ATT-01105'),
    '页外新附件不得失联',
  );
});

test('超过 1000 行时仍能定位页外槽位（否则上传报「槽位不存在」）', async () => {
  const { ctx, json } = makeCtx({ 投稿附件表: bigAttachmentTable() });
  await attachmentRoutes(
    makeReq('POST', '/api/public/attachments/ATT-01105'),
    {}, new URL('http://localhost/api/public/attachments/ATT-01105'), ctx,
  );

  const { status, payload } = lastJson(json);
  assert.notEqual(status, 404, `页外槽位不得被判为不存在，实得 ${status} ${payload?.message || ''}`);
  // 无 Box 配置时应走到「存储未配置」这一关，而不是在查找阶段就断掉。
  assert.equal(payload.code, 'njubox_not_configured');
});

test('超过 1000 行时仍能删除页外未绑定附件', async () => {
  const rows = bigAttachmentTable();
  rows[1_010] = {
    ...rows[1_010],
    上传状态: ATTACHMENT_STATUS.uploaded,
    对象Key: '/博爱中心/急救培训 AED/ATT-01010/f.png',
  };
  const { ctx, json } = makeCtx({ 投稿附件表: rows });
  await attachmentRoutes(
    makeReq('DELETE', '/api/public/attachments/ATT-01010'),
    {}, new URL('http://localhost/api/public/attachments/ATT-01010'), ctx,
  );

  assert.equal(lastJson(json).status, 200, '页外附件不得报「附件不存在」');
});

test('超过 1000 行时审核端仍能看到近期投稿的附件', async () => {
  const rows = bigAttachmentTable();
  // 行落库后一律用中文列名，改英文键不会被 attachmentFromRow 读到。
  rows[1_050] = {
    ...rows[1_050],
    投稿ID: 'SUB-NEW',
    上传状态: ATTACHMENT_STATUS.uploaded,
    对象Key: '/博爱中心/急救培训 AED/ATT-01050/f.png',
  };
  const { ctx, json } = makeCtx({ 投稿附件表: rows });
  await outreachSubmissionAttachments(makeReq('GET', '/x'), {}, ctx, 'SUB-NEW');

  const payload = lastJson(json).payload;
  assert.equal(payload.attachments.length, 1, '审核人必须看得到页外投稿的附件');
  assert.equal(payload.attachments[0].id, 'ATT-01050');
});

test('小表不回退成多打请求：30 行仍只读一次', async () => {
  const { ctx, stats } = makeCtx({ 投稿附件表: bigAttachmentTable().slice(0, 30) });
  await attachmentRoutes(makeReq('GET', '/api/public/attachments/mine'), {}, new URL('http://localhost/api/public/attachments/mine'), ctx);
  assert.equal(stats.calls, 1, '短页即表尾，不应继续翻页');
});

/* ------------------------------------------------------------------ *
 * 宣传展示 / 宣传投稿：越千行后控制台列表仍然完整
 * ------------------------------------------------------------------ */

test('超过 1000 条展示数据时控制台列表不丢尾部条目', async () => {
  const showcase = [];
  for (let i = 0; i < 1_050; i += 1) {
    showcase.push({
      _id: `shw-${i}`,
      展示ID: `SHW-${i}`,
      标题: `标题 ${i}`,
      链接: `https://mp.weixin.qq.com/s/${i}`,
      栏目: '红会新闻',
      来源: '手动导入',
      排序: i,
      创建时间: '2026-10-01 10:00:00',
    });
  }
  const { ctx, json } = makeCtx({ 宣传展示表: showcase });
  const res = { writeHead() {}, end() {} };
  await consoleShowcaseRoutes(makeReq('GET', '/api/console/showcase/items'), res, new URL('http://localhost/api/console/showcase/items'), ctx);

  const payload = lastJson(json).payload;
  assert.equal(payload.items.length, 1_050, '第 1000 条之后不得被静默截断');
});

/* ------------------------------------------------------------------ *
 * 源码守卫：不许再出现单页硬编码 limit
 * ------------------------------------------------------------------ */

const apiSource = (await readFile(new URL('../lib/attachment/api.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const showcaseSource = (await readFile(new URL('../lib/attachment/showcase.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('投稿附件模块不再对附件表单页硬编码 limit', () => {
  assert.doesNotMatch(
    apiSource,
    /client\.listRows\(\s*ctx\.tables\.attachment/,
    '附件表必须走 readPagedRows，不得退回单页读',
  );
  assert.match(apiSource, /readPagedRows\(client, ctx\.tables\.attachment/, '应改用翻页助手');
});

test('宣传展示模块不再对展示表/投稿表单页硬编码 limit', () => {
  assert.doesNotMatch(
    showcaseSource,
    /client\.listRows\(\s*ctx\.tables\.(showcase|submission|attachment)/,
    '展示表与投稿表必须走 readPagedRows',
  );
});
