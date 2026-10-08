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
  SHOWCASE_TABLE,
  showcaseFromRow,
} from './store.js';

async function listShowcaseRows(ctx) {
  const client = await ctx.getBase();
  return client.listRows(ctx.tables.showcase, '', '', false, '', 2000);
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
    const groups = [];
    const byGroup = new Map();
    for (const item of items) {
      const name = item.group || '精选推荐';
      if (!byGroup.has(name)) {
        byGroup.set(name, []);
        groups.push(name);
      }
      byGroup.get(name).push({
        id: item.id,
        title: item.title,
        link: item.link,
        group: name,
        coverUrl: item.coverPath ? `/api/public/showcase/covers/${encodeURIComponent(item.id)}` : null,
        source: item.source,
      });
    }
    return ctx.json(res, 200, {
      ok: true,
      groups: groups.map((name) => ({ name, items: byGroup.get(name) })),
      total: items.length,
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
    if (!status.configured || !item.repoId) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '封面存储未配置。' }));
      return true;
    }
    try {
      const link = await box.fileLink(ctx.config, item.repoId, item.coverPath);
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
