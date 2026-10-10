/**
 * 宣传展示板块路由：纯展示（长方形卡片：封面图 + 标题 + 超链接）。
 *
 * 挂载前缀：
 *   /api/public/showcase*   —— 公开读取（无需登录）
 *   /api/console/showcase*  —— 控制台维护（登录 + 权限，写操作走 CSRF）
 *
 * v2 架构：
 *   · 数据源双方案共用同一张「宣传展示表」：
 *       来源='手动导入'  ← scripts/import-showcase.mjs（后台批量导入 JSON/CSV）
 *       来源='公众号抓取' ← lib/attachment/showcase-source.js（适配层）
 *   · 封面图实体存 NJU Box /宣传展示/；封面 URL 经本服务 302 到新鲜
 *     seafhttp 直链，浏览器 <img> 直接加载（CSP img-src https: 已放开）
 *   · 无硬编码路径：Box 目录与库 ID 全走 .env 配置
 *
 * v3 S7（N2 / D12）：新增控制台半自动导入接口，把「粘几条公众号链接 →
 * 一键抓封面 + 正文图 → 落展示表」搬到网页端，取代原来的 .exe 脚本。
 *
 * ctx 注入契约（公开域）：
 *   json / getBase / tables{ showcase } / config{ njubox* } / enforceLimit
 * ctx 注入契约（控制台域）：
 *   上述全部 + session / readJson / recordAudit / boxConfig
 */

import * as box from './box.js';
import * as showcaseImport from './showcase-import.js';
import {
  DESIGN_CATEGORIES,
  SHOWCASE_GROUPS,
  SHOWCASE_TABLE,
  groupBySection,
  showcaseFromRow,
  showcaseRow,
} from './store.js';

async function listShowcaseRows(ctx) {
  const client = await ctx.getBase();
  return client.listRows(ctx.tables.showcase, '', '', false, '', 2000);
}

/**
 * 文创展示板：已通过的「文创设计」投稿（笔名匿名），按文创类别分节。
 * 只读公开字段（作品标题 + 笔名 + 类别 + 封面），绝不带实名/学号/邮箱。
 */
async function listDesignWorks(ctx) {
  if (!ctx.tables?.submission) return [];
  const client = await ctx.getBase();
  const rows = await client.listRows(ctx.tables.submission, '', '', false, '', 2000);
  return rows
    .map((row) => ({
      id: String(row['投稿ID'] || ''),
      category: String(row['类别'] || ''),
      status: String(row['审核状态'] || ''),
      group: String(row['文创类别'] || ''),
      title: String(row['作品标题'] || row['标题'] || ''),
      penName: String(row['笔名'] || row['对外署名'] || ''),
      hasCover: Boolean(String(row['附件引用'] || '').trim()),
    }))
    .filter((item) => item.category === '文创设计' && item.status === '已通过' && item.title);
}

/**
 * 展示板块路由总入口（公开）。返回 false 表示路径不属于本域。
 * GET /api/public/showcase           —— 分组卡片数据
 * GET /api/public/showcase/covers/:id —— 封面 302 到 Box 新鲜直链
 */
export async function showcaseRoutes(req, res, url, ctx) {
  const tail = decodeURIComponent(url.pathname.replace(/^\/api\/public\/showcase\/?/, ''));
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  if (tail === '') {
    ctx.enforceLimit(req, 'showcase', 120);
    const rows = await listShowcaseRows(ctx);
    const items = rows
      .map((row) => showcaseFromRow(row))
      .filter((item) => item.title && item.link)
      .sort((a, b) => (a.order - b.order) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    // 板 A【公众号推文】：宣传展示表，按「展示分类」3 栏目分节（缺省归「精选推荐」）。
    const postItems = items.map((item) => ({
      id: item.id,
      title: item.title,
      link: item.link,
      group: item.showGroup || item.group || '',
      coverUrl: item.coverPath ? `/api/public/showcase/covers/${encodeURIComponent(item.id)}` : null,
      source: item.source,
    }));
    const postGroups = groupBySection(postItems, { key: 'group', preferred: SHOWCASE_GROUPS, fallback: '精选推荐' });

    // 板 B【文创展示】：已通过的文创设计投稿，按文创类别分节（无图则用首字母占位）。
    const designs = await listDesignWorks(ctx);
    const designItems = designs.map((item) => ({
      id: item.id,
      title: item.title,
      penName: item.penName || '匿名创作者',
      group: item.group || '',
      coverUrl: item.hasCover ? `/api/public/showcase/design-cover/${encodeURIComponent(item.id)}` : null,
    }));
    const designGroups = groupBySection(designItems, { key: 'group', preferred: DESIGN_CATEGORIES, fallback: '其他' });

    return ctx.json(res, 200, {
      ok: true,
      // 兼容旧客户端：groups 保留为「公众号推文」分节；新增 boards 双板结构。
      groups: postGroups,
      boards: {
        posts: { title: '公众号推文', groups: postGroups, total: postItems.length },
        designs: { title: '文创展示', groups: designGroups, total: designItems.length },
      },
      total: postItems.length + designItems.length,
    });
  }

  const coverMatch = tail.match(/^covers\/([A-Za-z0-9-]+)$/);
  if (coverMatch) {
    ctx.enforceLimit(req, 'showcase', 240);
    const rows = await listShowcaseRows(ctx);
    const item = rows
      .map((row) => showcaseFromRow(row))
      .find((entry) => entry.id === coverMatch[1] && entry.coverPath);
    if (!item) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '封面不存在。' }));
      return true;
    }
    const status = box.boxStatus(ctx.config);
    if (!status.configured || !item.coverPath) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '封面存储未配置。' }));
      return true;
    }
    try {
      // v3：资料库级令牌自带库身份，不再按行取 repoId；旧行（带 repoId 的主库）同样走主库。
      const link = await box.fileLink(ctx.config, item.coverPath);
      res.writeHead(302, { location: link, 'cache-control': 'no-store' });
      res.end();
    } catch {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '封面暂时无法访问，请稍后重试。' }));
    }
    return true;
  }

  // GET /api/public/showcase/design-cover/:submissionId —— 文创作品封面 302（已通过投稿的首张图片附件）
  const designCoverMatch = tail.match(/^design-cover\/([A-Za-z0-9-]+)$/);
  if (designCoverMatch) {
    ctx.enforceLimit(req, 'showcase', 240);
    const status = box.boxStatus(ctx.config);
    if (!status.configured) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '封面存储未配置。' }));
      return true;
    }
    const submissionId = designCoverMatch[1];
    const client = await ctx.getBase();
    const submission = (await client.listRows(ctx.tables.submission, '', '', false, '', 2000))
      .map((row) => ({
        id: String(row['投稿ID'] || ''),
        category: String(row['类别'] || ''),
        status: String(row['审核状态'] || ''),
        refs: String(row['附件引用'] || ''),
      }))
      .find((row) => row.id === submissionId && row.category === '文创设计' && row.status === '已通过');
    if (!submission) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '作品不存在或未通过审核。' }));
      return true;
    }
    let refs = [];
    try { refs = JSON.parse(submission.refs || '[]'); } catch { refs = []; }
    const attachmentIds = Array.isArray(refs) ? refs.map(String).filter(Boolean) : [];
    if (!attachmentIds.length || !ctx.tables.attachment) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '作品暂无封面图片。' }));
      return true;
    }
    const attachments = await client.listRows(ctx.tables.attachment, '', '', false, '', 2000);
    const cover = attachments
      .map((row) => ({
        id: String(row['附件ID'] || ''),
        mime: String(row['MIME类型'] || ''),
        objectKey: String(row['对象Key'] || ''),
        status: String(row['上传状态'] || ''),
      }))
      .find((row) => attachmentIds.includes(row.id) && row.mime.startsWith('image/') && row.status === '已上传' && row.objectKey);
    if (!cover) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '作品封面图片不可用。' }));
      return true;
    }
    try {
      const link = await box.fileLink(ctx.config, cover.objectKey);
      res.writeHead(302, { location: link, 'cache-control': 'no-store' });
      res.end();
    } catch {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '封面暂时无法访问，请稍后重试。' }));
    }
    return true;
  }

  return false;
}

/** 供导入脚本/适配层复用的行写入（appendRow 的领域封装）。 */
export async function appendShowcaseItem(ctx, item) {
  const client = await ctx.getBase();
  return client.appendRow(ctx.tables.showcase, {
    条目ID: item.id,
    分组: item.group || '',
    标题: item.title,
    链接: item.link,
    封面路径: item.coverPath || '',
    库ID: item.repoId || '',
    排序: String(Number.isFinite(Number(item.order)) ? Number(item.order) : 0),
    来源: item.source || '手动导入',
    创建时间: item.createdAt || new Date().toISOString(),
  });
}

/* ==========================================================================
   v3 S7（N2 / D12）：控制台宣传展示维护
   --------------------------------------------------------------------------
   鉴权由 server.js 前置把关（requireConsoleAccess + 写操作 requireCsrf），
   本模块只负责业务；每条写操作都记审计。

   接口一览：
     POST   /api/console/showcase/extract        —— 粘链接 → 抓取 + 导入
     GET    /api/console/showcase/items          —— 列表（分栏目，带库状态）
     PATCH  /api/console/showcase/items/:id      —— 改栏目 / 排序 / 上下架
     DELETE /api/console/showcase/items/:id      —— 删除条目不删文件
   ========================================================================== */

/** 单次最多导入多少条链接（防止一次粘贴几百条把服务器拖住）。 */
const EXTRACT_MAX_LINKS = 30;

async function listShowcaseRowsWithId(ctx) {
  const client = await ctx.getBase();
  return client.listRows(ctx.tables.showcase, '', '', false, '', 2000);
}

/** GET /api/console/showcase/items —— 全量列表 + 分栏目 + 库配置状态。 */
async function handleConsoleList(res, ctx) {
  const rows = await listShowcaseRowsWithId(ctx);
  const items = rows
    .map((row) => ({ rowId: row._id, ...showcaseFromRow(row) }))
    .sort((a, b) => (a.order - b.order) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const groups = groupBySection(
    items.map((item) => ({ ...item, group: item.showGroup || item.group || '' })),
    { key: 'group', preferred: SHOWCASE_GROUPS, fallback: '精选推荐' },
  );
  return ctx.json(res, 200, {
    ok: true,
    items,
    total: items.length,
    groups,
    categories: SHOWCASE_GROUPS,
    libraries: box.boxLibrariesStatus(ctx.boxConfig || ctx.config || {}),
  });
}

/**
 * POST /api/console/showcase/extract
 * body: { links: string[] | string, category, withBodyImages, order? }
 * 逐条回显成功 / 失败 / 已存在，失败绝不静默。
 */
async function handleExtract(req, res, ctx, session) {
  ctx.enforceLimit?.(req, 'showcase', 60);
  const body = await ctx.readJson(req).catch(() => ({}));
  const raw = Array.isArray(body.links) ? body.links : String(body.links || '').split(/\r?\n/);
  const links = raw.map((line) => String(line || '').trim()).filter(Boolean);
  if (!links.length) {
    return ctx.json(res, 400, { ok: false, code: 'showcase_links_missing', message: '请至少粘贴一条文章链接（每行一条）。' });
  }
  if (links.length > EXTRACT_MAX_LINKS) {
    return ctx.json(res, 413, {
      ok: false, code: 'showcase_links_too_many',
      message: `单次最多导入 ${EXTRACT_MAX_LINKS} 条链接（当前 ${links.length} 条）。`,
    });
  }
  const category = String(body.category || '').trim();
  if (category && !SHOWCASE_GROUPS.includes(category)) {
    return ctx.json(res, 400, {
      ok: false, code: 'showcase_category_invalid',
      message: `展示分类必须是：${SHOWCASE_GROUPS.join(' / ')}。`,
    });
  }
  const withBodyImages = body.withBodyImages === true || body.withBodyImages === 'true';

  let result;
  try {
    result = await showcaseImport.extractAndImport(ctx, { links, category, withBodyImages });
  } catch (error) {
    await ctx.recordAudit?.(req, session, 'showcase.extract', category || '(未分类)', 'failure', { links: links.length, error: error?.message }).catch(() => {});
    return ctx.json(res, 500, { ok: false, code: 'showcase_extract_failed', message: error?.message || '导入过程中出错。' });
  }

  await ctx.recordAudit?.(req, session, 'showcase.extract', category || '(未分类)', result.imported.length ? 'success' : 'failure', {
    requested: result.requested, imported: result.imported.length, failed: result.failed.length, skipped: result.skipped,
  }).catch(() => {});

  const message = result.imported.length
    ? `成功导入 ${result.imported.length} 条${result.failed.length ? `，${result.failed.length} 条失败` : ''}${result.skipped ? `，${result.skipped} 条已存在跳过` : ''}。`
    : (result.skipped ? '全部内容已存在，未重复导入。' : '没有成功导入任何条目，请查看逐条结果。');
  return ctx.json(res, 200, { ...result, message, categories: SHOWCASE_GROUPS });
}

/** PATCH /api/console/showcase/items/:id —— 改栏目 / 排序 / 上下架。 */
async function handleConsoleUpdate(req, res, ctx, session, itemId) {
  const body = await ctx.readJson(req).catch(() => ({}));
  const rows = await listShowcaseRowsWithId(ctx);
  const row = rows.find((entry) => String(entry['条目ID'] || '') === itemId);
  if (!row) {
    return ctx.json(res, 404, { ok: false, code: 'showcase_not_found', message: '展示条目不存在。' });
  }
  const patch = {};
  if (body.showGroup !== undefined) {
    const showGroup = String(body.showGroup || '').trim();
    if (showGroup && !SHOWCASE_GROUPS.includes(showGroup)) {
      return ctx.json(res, 400, { ok: false, code: 'showcase_category_invalid', message: `展示分类必须是：${SHOWCASE_GROUPS.join(' / ')}。` });
    }
    patch.展示分类 = showGroup;
  }
  if (body.order !== undefined) {
    const order = Number(body.order);
    if (!Number.isFinite(order)) {
      return ctx.json(res, 400, { ok: false, code: 'showcase_order_invalid', message: '排序必须是数字。' });
    }
    patch.排序 = String(order);
  }
  if (body.visible !== undefined) {
    patch.上架 = body.visible === true || body.visible === 'true' ? '是' : '否';
  }
  if (!Object.keys(patch).length) {
    return ctx.json(res, 400, { ok: false, code: 'showcase_patch_empty', message: '没有需要更新的字段。' });
  }
  const client = await ctx.getBase();
  await client.updateRow(ctx.tables.showcase, row._id, patch);
  await ctx.recordAudit?.(req, session, 'showcase.update', itemId, 'success', patch).catch(() => {});
  return ctx.json(res, 200, { ok: true, message: '已更新。', patch });
}

/** DELETE /api/console/showcase/items/:id —— 只删展示条目，不动 Box 封面文件。 */
async function handleConsoleDelete(req, res, ctx, session, itemId) {
  const rows = await listShowcaseRowsWithId(ctx);
  const row = rows.find((entry) => String(entry['条目ID'] || '') === itemId);
  if (!row) {
    return ctx.json(res, 404, { ok: false, code: 'showcase_not_found', message: '展示条目不存在。' });
  }
  const client = await ctx.getBase();
  await client.deleteRow(ctx.tables.showcase, row._id);
  await ctx.recordAudit?.(req, session, 'showcase.delete', itemId, 'success', { title: String(row['标题'] || '') }).catch(() => {});
  return ctx.json(res, 200, { ok: true, message: '展示条目已删除（Box 封面文件仍保留）。' });
}

/** 兼容辅助：把「上架」列（可能不存在）视为默认可见。 */
function isVisible(row) {
  const value = String(row['上架'] ?? '').trim();
  return value !== '否';
}

export { isVisible };

/**
 * 控制台路由总入口：/api/console/showcase*
 * 返回 false 表示路径不属于本域（由 server.js 继续下派）。
 */
export async function consoleShowcaseRoutes(req, res, url, ctx) {
  const tail = decodeURIComponent(url.pathname.replace(/^\/api\/console\/showcase\/?/, ''));
  const session = ctx.session;

  if (req.method === 'POST' && tail === 'extract') {
    return handleExtract(req, res, ctx, session);
  }
  if (req.method === 'GET' && (tail === '' || tail === 'items')) {
    return handleConsoleList(res, ctx);
  }
  const itemMatch = tail.match(/^items\/([^/]+)$/);
  if (itemMatch) {
    if (req.method === 'PATCH' || req.method === 'PUT') return handleConsoleUpdate(req, res, ctx, session, itemMatch[1]);
    if (req.method === 'DELETE') return handleConsoleDelete(req, res, ctx, session, itemMatch[1]);
  }
  return false;
}

/** 供 CLI/测试复用：单条写入的映射（与 showcaseRow 一致）。 */
export { showcaseRow };
