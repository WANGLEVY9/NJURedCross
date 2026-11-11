import { encodePublicTextSync } from './compression.js';

/**
 * 浏览器直传 NJU Box 的目标源（2026-11-12）。
 *
 * 照片不再经过本站中转，由页面直接 POST 到 Box 的 seafhttp 上传直链，所以
 * connect-src 必须放行这个源。用配置里的 NJUBOX_SERVER_URL 推导，换库/换域名时
 * 不会悄悄把直传打回 CSP 报错（报错在控制台，用户只会看到「上传失败」）。
 */
let cachedBoxOrigin = '';
function boxUploadOrigin() {
  if (cachedBoxOrigin) return cachedBoxOrigin;
  const raw = String(process.env.NJUBOX_SERVER_URL || 'https://box.nju.edu.cn').trim();
  try {
    cachedBoxOrigin = new URL(raw).origin;
  } catch {
    cachedBoxOrigin = 'https://box.nju.edu.cn';
  }
  return cachedBoxOrigin;
}

/** Shared HTTP response policy for APIs and static assets. */
export function securityHeaders() {
  return {
    // img-src 允许 https：正文/附件均为 textContent 渲染（无 HTML 注入面），
    // 唯一消费远程图片的是控制台附件灯箱（对象存储签名 URL）。
    // blob: 给审核端「老照片补预览」用：原图下载到本地后先以 objectURL 立刻显示，
    // 等浏览器压好的缩略图回存成功再换成正式地址，避免几十秒白块。
    // connect-src 额外放行 Box：影像直传绕开新加坡中转，字节由浏览器直接发给云盘。
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https:; connect-src 'self' ${boxUploadOrigin()}; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  };
}

export function json(res, status, payload, headers = {}) {
  let body=JSON.stringify(payload);
  const publicPath=String(res.req?.url||'').split('?')[0];
  const publicProjection=['/api/public/events','/api/public/overview','/api/public/workflow/events','/api/public/warmth/capabilities'].includes(publicPath);
  // Explicit read-only management payloads contain no session/CSRF credentials.
  // Keep no-store: compression is not permission to cache private responses.
  const managementProjection=res.req?.method==='GET'&&status===200&&(
    ['/api/volunteer/workflow','/api/volunteer/workflow/catalog','/api/volunteer/workflow/workspace','/api/volunteer/workflow/sources','/api/volunteer/workflow/directory','/api/materials/overview','/api/events/overview','/api/volunteer/overview','/api/outreach/overview','/api/community/overview','/api/notifications/overview'].includes(publicPath)
    || /^\/api\/volunteer\/workflow\/events\/[^/]+\/detail$/.test(publicPath)
  );
  const compressible=publicProjection||managementProjection;
  const encoding={};
  if(compressible){
    // Brotli when offered, gzip otherwise; both only apply to public projections.
    const encoded=encodePublicTextSync(res.req,body);
    body=encoded.body;
    Object.assign(encoding,encoded.headers);
  }
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    // The entire (possibly compressed) body is already buffered. Explicit
    // framing lets proxies/clients detect incomplete delivery reliably.
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...encoding,
    ...headers,
  });
  res.end(body);
}
