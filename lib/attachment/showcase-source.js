import { observedFetch } from '../observability.js';

/**
 * 宣传展示板块的数据源适配层（双方案代码兼容）。
 *
 *   · manual 来源：scripts/import-showcase.mjs 手动批量导入（主路径，稳定）
 *   · wechat 来源：抓取「南大红会」公众号文章页的标题与封面
 *       —— 公众号页面有反爬与时效限制：任何一条抓取失败都会在结果中
 *          明确报错，绝不静默丢弃；整体不可用时降级为手动导入。
 *
 * 适配器契约（供导入脚本与后续定时任务共用）：
 *   fetchArticles({ urls, fetchImpl }) → Promise<Article[]>
 *   Article = { title, link, coverUrl, coverFilename, group? }
 *
 * 本模块只做抓取与解析，不写 SeaTable、不传 Box——落库统一走
 * scripts/import-showcase.mjs，保证数据入口单一可审计。
 */

const WECHAT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 从公众号文章 HTML 提取标题与封面（og:title / og:image，公众号页面标准字段）。 */
export function parseArticleHtml(html, link) {
  const pick = (pattern) => {
    const match = String(html || '').match(pattern);
    return match ? match[1].trim() : '';
  };
  const title = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<title>([^<]+)<\/title>/i);
  const coverUrl = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<meta[^>]+name=["']cover-img_1["'][^>]+content=["']([^"']+)["']/i);
  if (!title) {
    // 公众号对未登录/机房 IP 会返回「环境异常」占位页（无 og:title）。
    // 明确区分「反爬占位页」与「页面结构变化」，给出可操作的提示。
    const placeholder = /wechat-enable-text-zoom-em|环境异常|请在微信客户端打开|去验证/i.test(String(html || ''));
    throw new Error(placeholder
      ? `公众号反爬拦截（需在微信内打开验证）：${link} —— 请在手机微信里打开该文章，用「复制链接」或截图后走手动导入。`
      : `无法从文章页解析标题（页面结构可能已变）：${link}`);
  }
  return {
    title: decodeHtmlEntities(title),
    link,
    coverUrl,
    coverFilename: coverUrl ? coverFilenameFromUrl(coverUrl) : '',
  };
}

/**
 * v3 第 N2/D12 项：抓正文全文图（提取器能力重写）。
 * 微信公众号正文图片放在 <img data-src="...">（懒加载），少数用 src 直出。
 * 只做字符串/正则扫描，零依赖；去重、去非 http(s)、过滤微信图床外的杂图。
 * 正文页反爬导致抓不到是常态——返回空数组即代表「尽力抓但无果」，由调用方明确回显。
 */
export function parseBodyImages(html, { limit = 50 } = {}) {
  const source = String(html || '');
  const urls = [];
  const seen = new Set();
  const attrRe = /<img\b[^>]*?\b(?:data-src|data-original|src)\s*=\s*["']([^"']+)["']/gi;
  let match = attrRe.exec(source);
  while (match !== null) {
    const raw = match[1].trim();
    // 微信正文图多为 https://mmbiz.qpic.cn/... ；过滤 data: 占位与相对路径。
    if (/^https?:\/\//i.test(raw) && !seen.has(raw)) {
      seen.add(raw);
      urls.push(raw);
      if (urls.length >= limit) break;
    }
    match = attrRe.exec(source);
  }
  return urls.map((url) => ({ url, filename: coverFilenameFromUrl(url) }));
}

/** 从 URL 推断封面文件名（解码中文、清洗非法字符、保留扩展名，兜底 .jpg）。 */
export function coverFilenameFromUrl(url) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const last = path.split('/').filter(Boolean).pop() || '';
    const dot = last.lastIndexOf('.');
    const ext = dot > 0 ? last.slice(dot).toLowerCase() : '.jpg';
    const safe = (dot > 0 ? last.slice(0, dot) : last)
      .replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'cover';
    return `${safe}${/^\.(jpe?g|png|gif|webp)$/i.test(ext) ? ext : '.jpg'}`;
  } catch {
    return 'cover.jpg';
  }
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * 抓取一组公众号文章。逐条返回 { ok, article?, error? }——调用方决定
 * 部分成功时的策略；本函数不吞错误。
 * withBodyImages=true 时额外解析正文全文图（尽力抓，可能为空）。
 */
export async function fetchArticles({ urls, fetchImpl, group = '公众号推荐', withBodyImages = false } = {}) {
  const doFetch = (...args)=>observedFetch('content',fetchImpl||globalThis.fetch,...args);
  const list = (Array.isArray(urls) ? urls : []).map((url) => String(url || '').trim()).filter(Boolean);
  const results = [];
  for (const url of list) {
    try {
      const response = await doFetch(url, { headers: { 'user-agent': WECHAT_UA, accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const parsed = { ...parseArticleHtml(html, url), group };
      if (withBodyImages) parsed.bodyImages = parseBodyImages(html);
      results.push({ ok: true, article: parsed });
    } catch (error) {
      results.push({ ok: false, url, error: error?.message || String(error) });
    }
  }
  return results;
}

/** 下载封面图到 Buffer（导入脚本用；公众号 CDN 需带 Referer 的场景也兜不住时返回 null）。 */
export async function downloadCover(coverUrl, { fetchImpl } = {}) {
  const doFetch = (...args)=>observedFetch('content',fetchImpl||globalThis.fetch,...args);
  try {
    const response = await doFetch(coverUrl, { headers: { 'user-agent': WECHAT_UA, referer: 'https://mp.weixin.qq.com/' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 20 * 1024 * 1024) return null;
    return buffer;
  } catch {
    return null;
  }
}
