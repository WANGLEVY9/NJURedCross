import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { consoleShowcaseRoutes } from '../lib/attachment/showcase.js';

/* -------------------------------------------------------------------------- *
 * 宣传展示 · 批量上传封面图（2026-10-28）
 *
 * 背景：生产服务器在境外，微信只回「环境异常」占位页，服务端抓 HTML 必失败。
 * 因此提供「把本地提取器抓好的封面图批量拖进来」的通道：文件名即文章标题。
 * 本测试全程 mock（内存表 + Box fetch stub），不联网。
 * -------------------------------------------------------------------------- */

const SHOWCASE = '宣传展示表';

function boxFetchMock(calls = []) {
  return async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, method: init.method || 'GET' });
    if (href.includes('/upload-link/')) return new Response(JSON.stringify('https://box.nju.edu.cn/seafhttp/upload/abc'), { status: 200 });
    if (href.includes('/dir/?')) return new Response(JSON.stringify({ dirent_list: [] }), { status: 200 });
    // mkdir / upload 都返回成功
    return new Response('file-id-1', { status: 200 });
  };
}

function createCtx({ rows = [], fetched = [], config = {} } = {}) {
  const appended = [];
  const captured = [];
  const client = {
    listRows: async () => rows.map((row) => ({ ...row })),
    appendRow: async (table, row) => {
      const created = { ...row, _id: `row-${rows.length + 1}` };
      rows.push(created);
      appended.push(created);
      return created;
    },
  };
  const ctx = {
    session: { username: 'admin' },
    json: (res, status, payload) => { captured.push({ status, payload }); return payload; },
    getBase: async () => client,
    enforceLimit: () => {},
    recordAudit: async () => {},
    tables: { showcase: SHOWCASE },
    config: {
      njuboxToken: 'token-test',
      njuboxShowcaseDir: '/宣传展示',
      njuboxFetch: boxFetchMock(fetched),
      ...config,
    },
  };
  return { ctx, captured, appended, rows };
}

/** 构造 multipart 请求（与 media 上传同一形态）。 */
async function multipartReq({ category = '', files = [] }) {
  const form = new FormData();
  if (category) form.append('category', category);
  for (const file of files) form.append('files', new Blob([file.bytes], { type: file.type }), file.name);
  const response = new Response(form);
  const buffer = Buffer.from(await response.arrayBuffer());
  const stream = Readable.from([buffer]);
  stream.method = 'POST';
  stream.headers = { 'content-type': response.headers.get('content-type') };
  return stream;
}

const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');

test('批量上传：文件名当标题、按栏目入库，落点在 /宣传展示/<栏目>/', async () => {
  const harness = createCtx();
  const url = new URL('http://l/api/console/showcase/batch');
  await consoleShowcaseRoutes(
    await multipartReq({
      category: '红会新闻',
      files: [
        { name: '今日节日｜国际老年人日：守护“银发”安全.jpg', type: 'image/jpeg', bytes: pngBytes },
        { name: '活动回顾（1）.png', type: 'image/png', bytes: pngBytes },
      ],
    }),
    {}, url, harness.ctx,
  );
  const { status, payload } = harness.captured.at(-1);
  assert.equal(status, 201, JSON.stringify(payload));
  assert.equal(payload.imported.length, 2);
  assert.equal(harness.appended.length, 2);

  const first = harness.appended[0];
  assert.equal(first['标题'], '今日节日｜国际老年人日：守护“银发”安全');
  assert.equal(first['分组'], '红会新闻');
  assert.equal(first['展示分类'], '红会新闻');
  assert.equal(first['链接'], '', '批量上传没有原文链接');
  assert.ok(String(first['封面路径']).startsWith('/宣传展示/红会新闻/'), first['封面路径']);
  // 「(1)」这类同名副本后缀会被去掉
  assert.equal(harness.appended[1]['标题'], '活动回顾');
});

test('批量上传：非图片 / 缺栏目非法 / 空选择都明确报错，不静默', async () => {
  // 非图片被逐条拒绝（其余正常项仍然入库）
  const harness = createCtx();
  const url = new URL('http://l/api/console/showcase/batch');
  await consoleShowcaseRoutes(
    await multipartReq({ category: '活动总结', files: [
      { name: '推文封面.jpg', type: 'image/jpeg', bytes: pngBytes },
      { name: '附件.pdf', type: 'application/pdf', bytes: pngBytes },
    ] }),
    {}, url, harness.ctx,
  );
  const payload = harness.captured.at(-1).payload;
  assert.equal(payload.imported.length, 1);
  assert.equal(payload.failed.length, 1);
  assert.match(payload.failed[0].error, /不是图片/);

  // 栏目不在 11 栏目字典内 → 400
  const bad = createCtx();
  await consoleShowcaseRoutes(
    await multipartReq({ category: '新闻', files: [{ name: 'a.jpg', type: 'image/jpeg', bytes: pngBytes }] }),
    {}, url, bad.ctx,
  );
  assert.equal(bad.captured.at(-1).status, 400);
  assert.equal(bad.captured.at(-1).payload.code, 'showcase_category_invalid');

  // 一张都没选 → 400
  const empty = createCtx();
  await consoleShowcaseRoutes(await multipartReq({ category: '活动总结', files: [] }), {}, url, empty.ctx);
  assert.equal(empty.captured.at(-1).status, 400);
  assert.equal(empty.captured.at(-1).payload.code, 'showcase_files_missing');
});

test('批量上传：同栏目同名图片视为重复，不产生第二行', async () => {
  const harness = createCtx({
    rows: [{ 条目ID: 'SHW-1', 标题: '活动回顾', 链接: '', 分组: '活动总结', 展示分类: '活动总结' }],
  });
  const url = new URL('http://l/api/console/showcase/batch');
  await consoleShowcaseRoutes(
    await multipartReq({ category: '活动总结', files: [{ name: '活动回顾.jpg', type: 'image/jpeg', bytes: pngBytes }] }),
    {}, url, harness.ctx,
  );
  const payload = harness.captured.at(-1).payload;
  assert.equal(payload.imported.length, 0);
  assert.equal(payload.skipped, 1);
  assert.equal(harness.appended.length, 0);
  assert.equal(payload.ok, false, '没有新条目时 ok=false，前端据此提示');
});
