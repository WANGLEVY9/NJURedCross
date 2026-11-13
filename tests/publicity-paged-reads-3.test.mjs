import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mediaRoutes } from '../lib/attachment/media.js';
import { loadExistingKeys } from '../lib/attachment/showcase-import.js';
import {
  MEDIA_KEEP_STATUS,
  MEDIA_PICK_STATUS,
  mediaRow,
  showcaseRow,
} from '../lib/attachment/store.js';

/**
 * 「超过单页 1000 行之后」的行为契约（第三批：影像素材表 / 展示导入查重）。
 *
 * listRows 单次请求、服务端单页上限 1000、返回体无截断标记，故
 * `listRows(表, '', '', false, '', 2000)` 在表越千行后只拿到前 1000 行：
 *   · 影像素材表 —— /photos 列表漏掉老照片，按「照片ID」定位后改精选/删除审核
 *     会误报「照片不存在」；
 *   · 宣传展示表 —— 导入查重漏掉页外条目，同一篇推文被重复导入。
 *
 * 分页桩严格按 start/limit 切片、单页上限 1000，复刻真实语义。
 */

const PAGE_CAP = 1_000;
const TOTAL = 1_200;
const LAST_ID = `MP-${String(TOTAL).padStart(5, '0')}`;

function mediaRowAt(index) {
  return {
    _id: `media-${index}`,
    ...mediaRow({
      id: `MP-${String(index).padStart(5, '0')}`,
      center: '生命中心',
      activity: `活动${index}`,
      photographer: '张三',
      filename: `p${index}.jpg`,
      mimeType: 'image/jpeg',
      size: 1_024,
      checksum: `sum${index}`,
      path: `/生命中心/活动${index}/活动${index}-照片/p${index}.jpg`,
      keepStatus: MEDIA_KEEP_STATUS.pending,
      uploader: 'ACC-1',
      uploadedAt: '2026-11-01T10:00:00Z',
      pickStatus: MEDIA_PICK_STATUS.none,
    }),
  };
}

function showcaseRowAt(index) {
  return {
    _id: `show-${index}`,
    ...showcaseRow({
      id: `SHW-${String(index).padStart(5, '0')}`,
      title: `标题${index}`,
      link: `https://mp.weixin.qq.com/s/art${index}`,
      group: '红会新闻',
      source: '手动导入',
    }),
  };
}

function bigTable(rowAt, count = TOTAL) {
  const rows = [];
  for (let i = 1; i <= count; i += 1) rows.push(rowAt(i));
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

function makeMediaCtx(tables, stats = { calls: 0 }) {
  const json = [];
  const ctx = {
    json: (res, status, payload) => { json.push({ status, payload }); return payload; },
    readJson: async () => ({}),
    getBase: async () => pagedClient(tables, stats),
    requirePortalSession: () => ({ username: 'tester', studentId: '251880207', role: 'member' }),
    requireCsrf: () => true,
    recordAudit: async () => {},
    enforceLimit: () => {},
    ownsBusinessRef: (_s, value) => String(value || '') === 'ACC-1',
    businessAccountRef: () => 'ACC-1',
    tables: { media: '影像素材表', project: '活动项目表', showcase: '宣传展示表', submission: '宣传投稿表' },
    config: {},
    boxConfig: {},
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
 * 影像素材表：越千行后仍然读全
 * ------------------------------------------------------------------ */

test('超过 1000 行时 /api/public/media 仍列出全部照片', async () => {
  const { ctx, json } = makeMediaCtx({ 影像素材表: bigTable(mediaRowAt) });
  await mediaRoutes(makeReq('GET', '/api/public/media'), {}, new URL('http://localhost/api/public/media'), ctx);

  const { status, payload } = lastJson(json);
  assert.equal(status, 200);
  assert.equal(payload.photos.length, TOTAL, '页外照片必须全部可见，不得静默截断');
  assert.ok(
    payload.photos.some((item) => item.id === LAST_ID),
    '第 1000 张之后的照片不得失联',
  );
});

test('影像表读不全时明确 503，而不是拿半份数据继续办事', async () => {
  const { ctx } = makeMediaCtx({ 影像素材表: bigTable(mediaRowAt) });
  // 桩退化：第二页起直接抛错，模拟读不全。
  ctx.getBase = async () => {
    let calls = 0;
    return {
      async listRows(table, _view, _order, _desc, start = 0, limit = PAGE_CAP) {
        calls += 1;
        if (calls > 1) throw new Error('server hiccup');
        const rows = ({ 影像素材表: bigTable(mediaRowAt) })[table] || [];
        return rows.slice(Number(start) || 0, (Number(start) || 0) + Math.min(Number(limit) || PAGE_CAP, PAGE_CAP));
      },
    };
  };
  // 路由层把错误抛给 server.js 的统一错误出口，那里按 statusCode 落 503；
  // 这里断言错误本身就是 503 且带明确 code，而不是返回半份列表。
  await assert.rejects(
    () => mediaRoutes(makeReq('GET', '/api/public/media'), {}, new URL('http://localhost/api/public/media'), ctx),
    (error) => {
      assert.equal(error.statusCode, 503, '读不全必须以 503 结束');
      assert.equal(error.code, 'paged_read_unavailable');
      return true;
    },
  );
});

test('影像素材表 30 行小表仍只读一次', async () => {
  const { ctx, stats } = makeMediaCtx({ 影像素材表: bigTable(mediaRowAt, 30) });
  await mediaRoutes(makeReq('GET', '/api/public/media'), {}, new URL('http://localhost/api/public/media'), ctx);
  assert.equal(stats.calls, 1, '短页即表尾，不应继续翻页');
});

/* ------------------------------------------------------------------ *
 * 宣传展示导入查重：越千行后不漏判重复
 * ------------------------------------------------------------------ */

test('超过 1000 条展示数据时导入查重覆盖全部条目', async () => {
  const ctx = {
    getBase: async () => pagedClient({ 宣传展示表: bigTable(showcaseRowAt) }),
    tables: { showcase: '宣传展示表' },
  };
  const keys = await loadExistingKeys(ctx);
  assert.equal(keys.size, TOTAL, '页外条目查不到会导致同一篇推文重复导入');
  assert.ok(
    keys.has(`标题${TOTAL}|https://mp.weixin.qq.com/s/art${TOTAL}`),
    '第 1000 条之后的查重键必须存在',
  );
});

test('宣传展示表 30 行小表仍只读一次', async () => {
  const stats = { calls: 0 };
  const ctx = {
    getBase: async () => pagedClient({ 宣传展示表: bigTable(showcaseRowAt, 30) }, stats),
    tables: { showcase: '宣传展示表' },
  };
  const keys = await loadExistingKeys(ctx);
  assert.equal(keys.size, 30);
  assert.equal(stats.calls, 1);
});

/* ------------------------------------------------------------------ *
 * 源码守卫：不许再对这两张表单页硬编码 limit
 * ------------------------------------------------------------------ */

const mediaSource = (await readFile(new URL('../lib/attachment/media.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const importSource = (await readFile(new URL('../lib/attachment/showcase-import.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('影像模块不再对影像素材表单页硬编码 limit', () => {
  assert.doesNotMatch(
    mediaSource,
    /client\.listRows\(\s*ctx\.tables\.media/,
    '影像素材表必须走 readPagedRows，不得退回单页读',
  );
  assert.match(mediaSource, /readPagedRows\(client, ctx\.tables\.media/, '应改用翻页助手');
});

test('展示导入查重不再对展示表单页硬编码 limit', () => {
  assert.doesNotMatch(
    importSource,
    /client\.listRows\(\s*ctx\.tables\.showcase/,
    '展示表查重必须走 readPagedRows',
  );
  assert.match(importSource, /readPagedRows\(client, ctx\.tables\.showcase/, '应改用翻页助手');
});
