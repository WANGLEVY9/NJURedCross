import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coverFilenameFromUrl,
  fetchArticles,
  parseArticleHtml,
  parseBodyImages,
} from '../lib/attachment/showcase-source.js';
import {
  extractArticles,
  extractAndImport,
  importShowcaseItems,
  loadExistingKeys,
  makeShowcaseId,
} from '../lib/attachment/showcase-import.js';

/* -------------------------------------------------------------------------- *
 * v3 S7（N2 / D12）：宣传展示半自动导入
 *   · showcase-source.js：正文图解析 + 文章抓取
 *   · showcase-import.js：抓取计划 + 落库 + 幂等查重 + 逐条回显
 * -------------------------------------------------------------------------- */

/* ---------------------------- showcase-source ---------------------------- */

test('coverFilenameFromUrl：解码中文、清洗非法字符、保留合法扩展名', () => {
  assert.equal(coverFilenameFromUrl('https://mmbiz.qpic.cn/a/b/图片1.png'), '图片1.png');
  assert.equal(coverFilenameFromUrl('https://x.com/path/na me?x=1'), 'na-me.jpg', '空格转 - 且兜底 .jpg');
  assert.equal(coverFilenameFromUrl('not a url'), 'cover.jpg', '非法 URL 兜底');
  assert.equal(coverFilenameFromUrl('https://x.com/'), 'cover.jpg', '无路径兜底');
});

test('parseBodyImages：抓 data-src / data-original / src，去重、去非 http(s)、去 data:占位', () => {
  const html = `
    <div>
      <img data-src="https://mmbiz.qpic.cn/a.jpg" />
      <img data-original="https://mmbiz.qpic.cn/b.png" />
      <img src="https://mmbiz.qpic.cn/a.jpg" />
      <img src="data:image/gif;base64,R0lGOD..." />
      <img data-src="/relative/x.jpg" />
      <img data-src="http://cdn.example.com/c.webp" />
    </div>`;
  const images = parseBodyImages(html);
  assert.deepEqual(images.map((i) => i.url), [
    'https://mmbiz.qpic.cn/a.jpg',
    'https://mmbiz.qpic.cn/b.png',
    'http://cdn.example.com/c.webp',
  ], '去重 + 保留顺序 + 过滤相对/data:');
  assert.equal(images[0].filename, 'a.jpg');
});

test('parseBodyImages：limit 上限生效', () => {
  const html = Array.from({ length: 10 }, (_, i) => `<img data-src="https://x.com/${i}.jpg" />`).join('');
  assert.equal(parseBodyImages(html, { limit: 3 }).length, 3);
  assert.equal(parseBodyImages('').length, 0, '空 HTML 返回空数组');
});

test('parseArticleHtml：缺标题抛错（区分反爬占位页 / 结构变化）；正常解析 og:title/og:image', () => {
  assert.throws(() => parseArticleHtml('<html></html>', 'https://x.com/a'), /无法从文章页解析标题/);
  // 公众号反爬占位页 → 给出可操作提示
  assert.throws(
    () => parseArticleHtml('<meta name="wechat-enable-text-zoom-em" content="true"><div>环境异常</div>', 'https://x.com/a'),
    /反爬拦截/,
  );
  const parsed = parseArticleHtml(
    '<meta property="og:title" content="南大红会招新" /><meta property="og:image" content="https://mmbiz.qpic.cn/c.jpg" />',
    'https://x.com/a',
  );
  assert.equal(parsed.title, '南大红会招新');
  assert.equal(parsed.coverUrl, 'https://mmbiz.qpic.cn/c.jpg');
});

test('fetchArticles：逐条返回 ok/error，不吞错误，withBodyImages 附带正文图', async () => {
  const fetchImpl = async (url, options) => {
    if (String(url).includes('bad')) return { ok: false, status: 500, text: async () => '' };
    const html = '<meta property="og:title" content="标题一"><img data-src="https://mmbiz.qpic.cn/body.jpg">';
    return { ok: true, status: 200, text: async () => html };
  };
  const results = await fetchArticles({ urls: ['https://ok/a', 'https://bad/b'], group: '新闻', withBodyImages: true, fetchImpl });
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].article.title, '标题一');
  assert.equal(results[0].article.group, '新闻');
  assert.equal(results[0].article.bodyImages.length, 1, '正文图被解析');
  assert.equal(results[1].ok, false);
  assert.ok(results[1].error, '失败项带 error');
  assert.equal(results[1].url, 'https://bad/b');
});

/* ---------------------------- showcase-import ---------------------------- */

test('makeShowcaseId：SHW- 前缀且两次不同', () => {
  const a = makeShowcaseId();
  const b = makeShowcaseId();
  assert.ok(a.startsWith('SHW-'));
  assert.notEqual(a, b);
});

/** 造一个内存 Base：listRows / appendRow / updateRow / deleteRow。 */
function makeMemoryBase(seed = []) {
  const rows = seed.map((row, index) => ({ _id: `row-${index}`, ...row }));
  let seq = rows.length;
  return {
    rows,
    async listRows() { return rows; },
    async appendRow(_table, row) { const created = { _id: `row-${seq++}`, ...row }; rows.push(created); return created; },
    async updateRow(_table, id, patch) { const target = rows.find((r) => r._id === id); if (target) Object.assign(target, patch); return target; },
    async deleteRow(_table, id) { const i = rows.findIndex((r) => r._id === id); if (i >= 0) rows.splice(i, 1); },
  };
}

function makeCtx(base, boxOverrides = {}) {
  return {
    getBase: async () => base,
    boxConfig: {
      njuboxServerUrl: 'https://box.example.com',
      njuboxToken: 'tok',
      njuboxShowcaseDir: '/宣传展示',
      ...boxOverrides,
    },
    tables: { showcase: '宣传展示表' },
  };
}

test('loadExistingKeys：按「标题|链接」去重集合', async () => {
  const base = makeMemoryBase([
    { 条目ID: 'S1', 标题: 'A', 链接: 'https://a' },
    { 条目ID: 'S2', 标题: 'B', 链接: 'https://b' },
  ]);
  const keys = await loadExistingKeys(makeCtx(base));
  assert.equal(keys.size, 2);
  assert.ok(keys.has('A|https://a'));
});

test('extractArticles：抓取成功进 plan、失败进 failures（绝不静默）', async () => {
  const base = makeMemoryBase();
  const fetchImpl = async (url) => {
    if (String(url).includes('bad')) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => '<meta property="og:title" content="好文章"><meta property="og:image" content="https://mmbiz.qpic.cn/c.jpg">' };
  };
  const { plan, failures } = await extractArticles(makeCtx(base), { links: ['https://ok/1', 'https://bad/2'], category: '新闻', fetchImpl });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].title, '好文章');
  assert.equal(plan[0].group, '新闻');
  assert.equal(plan[0].source, '公众号抓取');
  assert.equal(plan[0].coverFilename, 'c.jpg');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].url, 'https://bad/2');
});

test('importShowcaseItems：封面必抓 → 上传 Box → 落库；重复跳过', async () => {
  const base = makeMemoryBase();
  const ctx = makeCtx(base);
  let uploaded = 0;
  const uploadImpl = async () => { uploaded += 1; return { path: '/宣传展示/新闻/cover.jpg' }; };
  const plan = [
    { title: '文章一', link: 'https://a/1', coverUrl: 'https://mmbiz.qpic.cn/c.jpg', coverFilename: 'c.jpg', group: '新闻', order: 1 },
    { title: '无封面', link: 'https://a/2', coverUrl: '', group: '新闻', order: 2 },
    { title: '', link: 'https://a/3', group: '新闻', order: 3 },
  ];
  const downloadCoverImpl = async () => Buffer.from('img');
  const first = await importShowcaseItems(ctx, { plan, downloadCoverImpl, uploadImpl });
  assert.equal(first.imported.length, 2, '两条有效');
  assert.equal(first.skipped, 1, '缺标题跳过');
  assert.equal(uploaded, 1, '只有带封面的上传一次');
  assert.equal(base.rows.length, 2);

  // 幂等：同样内容再导一次 → 全部跳过
  const second = await importShowcaseItems(ctx, { plan, downloadCoverImpl, uploadImpl });
  assert.equal(second.imported.length, 0);
  assert.equal(base.rows.length, 2, '不产生重复行');
});

test('importShowcaseItems：封面下载失败 → 条目仍写入但失败被明确回显（不静默）', async () => {
  const base = makeMemoryBase();
  const ctx = makeCtx(base);
  const plan = [{ title: '封面挂了', link: 'https://a/x', coverUrl: 'https://x/broken.jpg', coverFilename: 'b.jpg', group: '新闻', order: 1 }];
  const { imported, failed } = await importShowcaseItems(ctx, { plan, downloadCoverImpl: async () => null });
  assert.equal(imported.length, 1, '条目仍写入');
  assert.equal(imported[0].hasCover, false);
  assert.equal(failed.length, 1, '失败明确回显');
  assert.match(failed[0].error, /封面下载失败/);
});

test('extractAndImport：一键抓取+落库，逐条汇总 requested/fetched/imported/failed/skipped', async () => {
  const base = makeMemoryBase();
  const ctx = makeCtx(base);
  const fetchImpl = async (url) => {
    if (String(url).includes('bad')) return { ok: false, status: 500, text: async () => '' };
    return { ok: true, status: 200, text: async () => '<meta property="og:title" content="一键导入文章">' };
  };
  const result = await extractAndImport(ctx, { links: ['https://ok/1', 'https://bad/2'], category: '活动总结', fetchImpl, downloadCoverImpl: async () => null });
  assert.equal(result.ok, true);
  assert.equal(result.requested, 2);
  assert.equal(result.fetched, 1);
  assert.equal(result.imported.length, 1);
  assert.equal(result.failed.length, 1, '抓取失败进 failed');
  assert.equal(base.rows.length, 1);
});

test('extractAndImport：Box 未配置时仍可落库（仅无封面）', async () => {
  const base = makeMemoryBase();
  const ctx = makeCtx(base, { njuboxServerUrl: '', njuboxToken: '' });
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<meta property="og:title" content="无 Box"><meta property="og:image" content="https://mmbiz.qpic.cn/c.jpg">' });
  const result = await extractAndImport(ctx, { links: ['https://ok/1'], category: '新闻', fetchImpl, downloadCoverImpl: async () => null });
  assert.equal(result.boxConfigured, false);
  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0].hasCover, false);
});
