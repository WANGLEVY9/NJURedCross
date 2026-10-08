import { readFileSync } from 'node:fs';
import { Base } from 'seatable-api';
import * as box from '../lib/attachment/box.js';
import { SHOWCASE_TABLE, showcaseFromRow, sanitizeDirname } from '../lib/attachment/store.js';
import { coverFilenameFromUrl, downloadCover, fetchArticles } from '../lib/attachment/showcase-source.js';

/**
 * 宣传展示板块·手动批量导入脚本（后台运营用，主路径数据源）。
 *
 * 输入 JSON（--input=showcase.json）二选一格式：
 *   A. 直接条目数组：[{ "group": "精选推荐", "title": "...", "link": "https://...",
 *                        "cover": "D:/covers/a.jpg 或 https://.../a.jpg", "order": 1 }]
 *   B. 公众号文章 URL 抓取：{ "mode": "wechat", "urls": ["https://mp.weixin.qq.com/s/..."],
 *                              "group": "公众号推荐" }
 *
 * 行为：
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

const boxStatus = box.boxStatus({
  njuboxServerUrl: process.env.NJUBOX_SERVER_URL,
  njuboxToken: process.env.NJUBOX_API_TOKEN,
  njuboxRepoId: process.env.NJUBOX_REPO_ID,
  njuboxShowcaseDir: process.env.NJUBOX_SHOWCASE_DIR,
});

// ---- 解析输入为统一条目列表 ----
let plan = [];
if (!Array.isArray(entries) && entries.mode === 'wechat') {
  if (!boxStatus.configured) throw new Error('公众号抓取需要 NJU Box 配置（封面要上传）。');
  console.log(`Fetching ${entries.urls.length} WeChat article(s)...`);
  const results = await fetchArticles({ urls: entries.urls, group: entries.group || '公众号推荐' });
  const failures = results.filter((item) => !item.ok);
  for (const failure of failures) console.error(`  FAILED ${failure.url}: ${failure.error}`);
  plan = results.filter((item) => item.ok).map(({ article }, index) => ({
    group: article.group,
    title: article.title,
    link: article.link,
    cover: article.coverUrl || null,
    coverFilename: article.coverFilename || (article.coverUrl ? coverFilenameFromUrl(article.coverUrl) : ''),
    order: index + 1,
    source: '公众号抓取',
  }));
  if (failures.length && !plan.length) throw new Error('全部文章抓取失败——公众号侧可能限制访问，请改用手动导入。');
} else if (Array.isArray(entries)) {
  plan = entries.map((item, index) => ({
    group: String(item.group || '精选推荐').trim() || '精选推荐',
    title: String(item.title || '').trim(),
    link: String(item.link || '').trim(),
    cover: item.cover ? String(item.cover).trim() : null,
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

// ---- 查重（标题+链接）----
const existingRows = await base.listRows(SHOWCASE_TABLE, '', '', false, '', 2000);
const existing = new Set(existingRows.map((row) => {
  const item = showcaseFromRow(row);
  return `${item.title}|${item.link}`;
}));
const fresh = valid.filter((item) => !existing.has(`${item.title}|${item.link}`));
const duplicates = valid.length - fresh.length;

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  boxConfigured: boxStatus.configured,
  showcaseDir: boxStatus.dirs.showcase,
  parsed: valid.length,
  duplicatesSkipped: duplicates,
  toImport: fresh.map((item) => ({ group: item.group, title: item.title, link: item.link, order: item.order, source: item.source, hasCover: Boolean(item.cover) })),
}, null, 2));

if (!apply) process.exit(0);
if (!fresh.length) {
  console.log('Nothing to import.');
  process.exit(0);
}

const imported = [];
const failed = [];
for (const item of fresh) {
  let coverPath = '';
  let repoId = '';
  try {
    if (item.cover && boxStatus.configured) {
      const buffer = item.cover.startsWith('http')
        ? await downloadCover(item.cover)
        : (await import('node:fs')).readFileSync(item.cover);
      if (buffer) {
        const filename = item.coverFilename || `cover-${Date.now().toString(36)}.jpg`;
        const stored = await box.uploadBuffer({
          njuboxServerUrl: process.env.NJUBOX_SERVER_URL,
          njuboxToken: process.env.NJUBOX_API_TOKEN,
          njuboxRepoId: process.env.NJUBOX_REPO_ID,
        }, {
          repoId: boxStatus.repoId,
          dir: boxStatus.dirs.showcase,
          relativePath: sanitizeDirname(item.group) || '默认',
          filename,
          buffer,
          contentType: 'image/jpeg',
        });
        coverPath = stored.path;
        repoId = boxStatus.repoId;
      } else {
        console.warn(`  Cover download failed (kept without cover): ${item.title}`);
      }
    }
    const id = `SHW-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
    await base.appendRow(SHOWCASE_TABLE, {
      条目ID: id,
      分组: item.group,
      标题: item.title,
      链接: item.link,
      封面路径: coverPath,
      库ID: repoId,
      排序: String(item.order),
      来源: item.source,
      创建时间: new Date().toISOString(),
    });
    imported.push(`${item.group} · ${item.title}`);
    console.log(`Imported: ${item.group} · ${item.title}${coverPath ? '（含封面）' : ''}`);
  } catch (error) {
    failed.push(`${item.title}: ${error?.message || error}`);
    console.error(`Failed: ${item.title}: ${error?.message || error}`);
  }
}

console.log(JSON.stringify({ imported: imported.length, failed, duplicatesSkipped: duplicates }, null, 2));
if (failed.length) process.exitCode = 1;
