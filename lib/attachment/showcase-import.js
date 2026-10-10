/**
 * 宣传展示半自动导入（v3 S7 / N2 / D12）
 *
 * 把 scripts/import-showcase.mjs 的核心逻辑抽成**纯函数**，供两处共用：
 *   · 控制台接口 POST /api/console/showcase/extract（网页一键提取）
 *   · CLI scripts/import-showcase.mjs（服务器批处理）
 *
 * 设计边界（对齐 §7.7 现实边界）：
 *   · 封面必抓、正文全文图尽力抓、**失败明确报错绝不静默丢弃**
 *   · 幂等查重（标题 + 链接），重复导入不产生重复行
 *   · 零依赖：抓取走 showcase-source.js，上传走 box.js
 *
 * ctx 注入契约：
 *   getBase() / boxConfig{} / tables{ showcase } / config?{}
 */

import * as box from './box.js';
import {
  SHOWCASE_TABLE,
  showcaseFromRow,
  sanitizeDirname,
} from './store.js';
import {
  coverFilenameFromUrl,
  downloadCover,
  fetchArticles,
} from './showcase-source.js';

/** 生成展示条目编号，与 scripts/import-showcase.mjs 同构。 */
export function makeShowcaseId() {
  return `SHW-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
}

/** 已有的「标题|链接」查重集合。 */
export async function loadExistingKeys(ctx) {
  const client = await ctx.getBase();
  const rows = await client.listRows(ctx.tables.showcase, '', '', false, '', 2000);
  return new Set(rows.map((row) => {
    const item = showcaseFromRow(row);
    return `${item.title}|${item.link}`;
  }));
}

/**
 * 抓取一批推文链接 → 统一条目计划（不写库）。
 * 返回 { plan, failures }；failures 逐条带 url + error，交由调用方回显。
 */
export async function extractArticles(ctx, { links = [], category = '', withBodyImages = false, fetchImpl } = {}) {
  const status = box.boxStatus(ctx.boxConfig || ctx.config || {});
  const urls = (Array.isArray(links) ? links : []).map((x) => String(x || '').trim()).filter(Boolean);
  const results = await fetchArticles({ urls, group: category, withBodyImages, fetchImpl });
  const failures = results.filter((r) => !r.ok).map((r) => ({ url: r.url, error: r.error }));
  const plan = results.filter((r) => r.ok).map(({ article }, index) => ({
    group: article.group || category || '公众号推荐',
    title: article.title,
    link: article.link,
    coverUrl: article.coverUrl || '',
    coverFilename: article.coverFilename || (article.coverUrl ? coverFilenameFromUrl(article.coverUrl) : ''),
    bodyImages: article.bodyImages || [],
    order: index + 1,
    source: '公众号抓取',
  }));
  return { plan, failures, boxConfigured: status.configured, showcaseDir: status.dirs?.showcase || '' };
}

/**
 * 落库：为每条计划下载封面（+ 可选正文图）上传 Box，并写入展示表。
 * 逐条 try/catch，单条失败不影响其余；返回 { imported, failed, skipped }。
 * uploadImpl 可注入（测试用），默认真实 box.uploadBuffer。
 */
export async function importShowcaseItems(ctx, { plan = [], withBodyImages = false, downloadCoverImpl, uploadImpl } = {}) {
  const client = await ctx.getBase();
  const status = box.boxStatus(ctx.boxConfig || ctx.config || {});
  const doUpload = uploadImpl || box.uploadBuffer;
  const existing = await loadExistingKeys(ctx);
  const imported = [];
  const failed = [];
  let skipped = 0;

  for (const item of plan) {
    if (!item.title || !item.link) { skipped += 1; continue; }
    if (existing.has(`${item.title}|${item.link}`)) { skipped += 1; continue; }
    try {
      let coverPath = '';
      let repoId = '';
      if (item.coverUrl && status.configured) {
        const doDownload = downloadCoverImpl || downloadCover;
        const buffer = await doDownload(item.coverUrl);
        if (buffer) {
          const filename = item.coverFilename || `cover-${Date.now().toString(36)}.jpg`;
          const stored = await doUpload(ctx.boxConfig || ctx.config, {
            dir: status.dirs.showcase,
            relativePath: sanitizeDirname(item.group) || '默认',
            filename,
            buffer,
            contentType: 'image/jpeg',
          });
          coverPath = stored.path;
          repoId = status.library;
        } else {
          failed.push({ title: item.title, error: '封面下载失败（未上传封面，仍写入条目）' });
        }
      }
      // 正文全文图：尽力抓，逐张上传到 /宣传展示/<栏目>/<标题>/ 子目录。
      let bodyCount = 0;
      if (withBodyImages && Array.isArray(item.bodyImages) && item.bodyImages.length && status.configured) {
        const doDownload = downloadCoverImpl || downloadCover;
        for (const image of item.bodyImages.slice(0, 30)) {
          try {
            const buffer = await doDownload(image.url);
            if (!buffer) continue;
            await doUpload(ctx.boxConfig || ctx.config, {
              dir: status.dirs.showcase,
              relativePath: `${sanitizeDirname(item.group) || '默认'}/${sanitizeDirname(item.title)}`,
              filename: image.filename,
              buffer,
              contentType: 'image/jpeg',
            });
            bodyCount += 1;
          } catch { /* 单张正文图失败不阻断 */ }
        }
      }
      await client.appendRow(ctx.tables.showcase, {
        条目ID: makeShowcaseId(),
        分组: item.group,
        标题: item.title,
        链接: item.link,
        封面路径: coverPath,
        库ID: repoId,
        排序: String(Number.isFinite(Number(item.order)) ? Number(item.order) : 0),
        来源: item.source || '公众号抓取',
        创建时间: new Date().toISOString(),
        展示分类: item.showcaseGroup || '',
      });
      existing.add(`${item.title}|${item.link}`);
      imported.push({ title: item.title, group: item.group, hasCover: Boolean(coverPath), bodyCount });
    } catch (error) {
      failed.push({ title: item.title, error: error?.message || String(error) });
    }
  }
  return { imported, failed, skipped };
}

/**
 * 一键：抓取 + 落库。返回逐条结果，**失败绝不静默**。
 */
export async function extractAndImport(ctx, { links = [], category = '', withBodyImages = false, fetchImpl, downloadCoverImpl, uploadImpl } = {}) {
  const { plan, failures, boxConfigured } = await extractArticles(ctx, { links, category, withBodyImages, fetchImpl });
  const { imported, failed, skipped } = await importShowcaseItems(ctx, { plan, withBodyImages, downloadCoverImpl, uploadImpl });
  return {
    ok: true,
    boxConfigured,
    requested: links.length,
    fetched: plan.length,
    imported,
    failed: [...failures.map((f) => ({ title: '(抓取失败)', url: f.url, error: f.error })), ...failed],
    skipped,
  };
}

export { SHOWCASE_TABLE };
