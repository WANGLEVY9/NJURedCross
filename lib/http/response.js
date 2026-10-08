/** Shared HTTP response policy for APIs and static assets. */
export function securityHeaders() {
  return {
    // img-src 允许 https：正文/附件均为 textContent 渲染（无 HTML 注入面），
    // 唯一消费远程图片的是控制台附件灯箱（对象存储签名 URL）。
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  };
}

export function json(res, status, payload, headers = {}) {
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}
