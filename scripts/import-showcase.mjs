import { readFileSync } from 'node:fs';
import { Base } from 'seatable-api';
import * as box from '../lib/attachment/box.js';
import {
  SHOWCASE_TABLE,
  sanitizeDirname,
} from '../lib/attachment/store.js';
import {
  SHOWCASE_GROUPS,
} from '../lib/attachment/store.js';
import {
  extractArticles,
  importShowcaseItems,
  loadExistingKeys,
} from '../lib/attachment/showcase-import.js';

/**
 * 宣传展示板块·批量导入脚本（后台运营用）。
 *
 * ⚠️ v3 S7 起，日常导入推荐走控制台网页（宣传中心 → 宣传展示 →
 *    「提取并导入」），无需任何本地脚本/exe。本脚本保留给批量/服务器定时任务。
 *
 * 输入 JSON（--input=showcase.json）二选一格式：
 *   A. 直接条目数组：[{ "group": "精选推荐", "title": "...", "link": "https://...",
 *                        "cover": "D:/covers/a.jpg 或 https://.../a.jpg", "order": 1 }]
 *   B. 公众号文章 URL 抓取：{ "mode": "wechat", "urls": ["https://mp.weixin.qq.com/s/..."],
 *                              "group": "精选推荐", "withBodyImages": false }
 *
 * 行为（与网页端共用 lib/attachment/showcase-import.js，逻辑完全一致）：
 *   · cover 为本地路径或 http(s) URL：下载后上传到 NJU Box /宣传展示/
 *   · 按 标题+链接 查重（展示表内已有则跳过），不重复导入
 *   · 默认 dry-run 只打印计划；--apply --confirm=IMPORT-SHOWCASE 才写入
 *
 * 运行：
 *   npm run showcase:import -- --input=showcase.json            # 预览
 *   npm run showcase:import -- --input=showcase.json --apply --confirm=IMPORT-SHOWCASE
 */

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'IMPORT-SHOWCASE';
const inputFile = process.argv.find((arg) => arg.startsWith('--input='))?.slice('--input='.length);

if (!token) throw new Error('Missing SEATABLE_API_TOKEN');
if (!inputFile) throw new Error('Missing --input=<json file>');
if (apply && confirmation !== requiredConfirmation) {
  throw new Error(`Refusing to write. Pass --confirm=${requiredConfirmation} together with --apply.`);
}

const raw = JSON.parse(readFileSync(inputFile, 'utf8'));
const entries = Array.isArray(raw)
  ? raw.map((item) => ({ ...item, group: item.group || '精选推荐' }))
  : { ...raw };

const base = new Base({ server, APIToken: token });
await base.auth();

// v3：改用「资料库级令牌」接入（Bearer + via-repo-token），不再需要 repoId。
const boxConfig = {
  njuboxServerUrl: process.env.NJUBOX_SERVER_URL,
  njuboxToken: process.env.NJUBOX_MAIN_TOKEN || process.env.NJUBOX_API_TOKEN,
  njuboxShowcaseDir: process.env.NJUBOX_SHOWCASE_DIR,
};
const boxStatus = box.boxStatus(boxConfig);

/** 与网页端同构的 ctx（getBase 复用同一个 Base 实例）。 */
const ctx = {
  getBase: async () => base,
  boxConfig,
  config: boxConfig,
  tables: { showcase: SHOWCASE_TABLE },
};

const validGroups = new Set(SHOWCASE_GROUPS);

// ---- 解析输入为统一条目列表 ----
const isWechatMode = !Array.isArray(entries) && entries.mode === 'wechat';
let plan = [];
const fetchFailures = [];

if (isWechatMode) {
  if (!boxStatus.configured) throw new Error('公众号抓取需要 NJU Box 配置（封面要上传）。');
  const urls = (entries.urls || []).map((url) => String(url || '').trim()).filter(Boolean);
  console.log(`Fetching ${urls.length} WeChat article(s)…`);
  // v3 S7：抓取逻辑与网页端共用同一函数（含正文图提取开关）。
  const { plan: extracted, failures } = await extractArticles(ctx, {
    links: urls,
    category: entries.group || '精选推荐',
    withBodyImages: entries.withBodyImages === true,
  });
  plan = extracted.map((item) => ({ ...item, cover: item.coverUrl }));
  fetchFailures.push(...failures);
  for (const failure of failures) console.error(`  FETCH FAILED ${failure.url}: ${failure.error}`);
  if (failures.length && !plan.length) throw new Error('全部文章抓取失败——公众号侧可能限制访问，请改用手动导入。');
} else if (Array.isArray(entries)) {
  plan = entries.map((item, index) => ({
    group: String(item.group || '精选推荐').trim() || '精选推荐',
    showGroup: String(item.showGroup || '').trim(),
    title: String(item.title || '').trim(),
    link: String(item.link || '').trim(),
    coverUrl: item.cover ? String(item.cover).trim() : '',
    coverFilename: item.coverFilename ? String(item.coverFilename).trim() : '',
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1,
    source: '手动导入',
  }));
} else {
  throw new Error('输入 JSON 既不是条目数组，也不是 { "mode": "wechat", urls: [...] }');
}

const valid = plan.filter((item) => item.title && item.link);
const invalid = plan.length - valid.length;
if (invalid) console.warn(`${invalid} 条缺少标题或链接，已忽略。`);

const badGroup = valid.filter((item) => item.showGroup && !validGroups.has(item.showGroup));
for (const item of badGroup) {
  console.warn(`  「${item.title}」的展示分类「${item.showGroup}」不在 ${SHOWCASE_GROUPS.join('/')} 内，将留空。`);
  item.showGroup = '';
}

// ---- 查重（标题+链接）——与网页端共用同一实现 ----
const existing = await loadExistingKeys(ctx);
const fresh = valid.filter((item) => !existing.has(`${item.title}|${item.link}`));
const duplicates = valid.length - fresh.length;

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  source: isWechatMode ? 'wechat' : 'manual',
  boxConfigured: boxStatus.configured,
  showcaseDir: boxStatus.dirs.showcase,
  parsed: valid.length,
  fetchFailed: fetchFailures.length,
  duplicatesSkipped: duplicates,
  toImport: fresh.map((item) => ({
    group: item.group, showGroup: item.showGroup || '', title: item.title,
    link: item.link, order: item.order, source: item.source, hasCover: Boolean(item.coverUrl),
    bodyImages: item.bodyImages?.length || 0,
  })),
}, null, 2));

if (!apply) process.exit(0);
if (!fresh.length) {
  console.log('Nothing to import.');
  process.exit(0);
}

// ---- 落库：与网页端共用 importShowcaseItems（本地路径封面单独兜底） ----
// 本地文件封面（手动模式）不走 downloadCover，这里用注入实现兼容两种来源。
const { readFile } = await import('node:fs/promises');
const downloadImpl = async (url) => {
  if (/^https?:\/\//i.test(url)) {
    const { downloadCover } = await import('../lib/attachment/showcase-source.js');
    return downloadCover(url);
  }
  try { return await readFile(url); } catch { return null; }
};

const { imported, failed, skipped } = await importShowcaseItems(ctx, {
  plan: fresh, withBodyImages: isWechatMode && entries.withBodyImages === true, downloadCoverImpl: downloadImpl,
});

for (const item of imported) {
  console.log(`Imported: ${item.group} · ${item.title}${item.hasCover ? '（含封面）' : ''}${item.bodyCount ? `（正文图 ${item.bodyCount} 张）` : ''}`);
}
for (const item of failed) console.error(`Failed: ${item.title}: ${item.error}`);

console.log(JSON.stringify({
  imported: imported.length,
  failed,
  fetchFailed: fetchFailures,
  duplicatesSkipped: duplicates + skipped,
}, null, 2));
if (failed.length || fetchFailures.length) process.exitCode = 1;
