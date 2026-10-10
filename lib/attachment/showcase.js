/**
 * 宣传展示板块路由：纯展示（长方形卡片：封面图 + 标题 + 超链接）。
 *
 * 挂载前缀：/api/public/showcase*（公开读取，无需登录）
 *
 * v2 架构：
 *   · 数据源双方案共用同一张「宣传展示表」：
 *       来源='手动导入'  ← scripts/import-showcase.mjs（后台批量导入 JSON/CSV）
 *       来源='公众号抓取' ← lib/attachment/showcase-source.js（适配层）
 *   · 封面图实体存 NJU Box /宣传展示/；封面 URL 经本服务 302 到新鲜
 *     seafhttp 直链，浏览器 <img> 直接加载（CSP img-src https: 已放开）
 *   · 无硬编码路径：Box 目录与库 ID 全走 .env 配置
 *
 * ctx 注入契约：
 *   json / getBase / tables{ showcase } / config{ njubox* } / enforceLimit
 */

import * as box from './box.js';
import {
  DESIGN_CATEGORIES,
  SHOWCASE_GROUPS,
  SHOWCASE_TABLE,
  groupBySection,
  showcaseFromRow,
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
