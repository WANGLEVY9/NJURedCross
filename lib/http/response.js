import { gzipSync } from 'node:zlib';
import { acceptsGzip } from './compression.js';

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
  let body=JSON.stringify(payload);
  const publicPath=String(res.req?.url||'').split('?')[0];
  const publicProjection=['/api/public/events','/api/public/overview','/api/public/workflow/events','/api/public/warmth/capabilities'].includes(publicPath);
  // Explicit read-only management payloads contain no session/CSRF credentials.
  // Keep no-store: compression is not permission to cache private responses.
  const managementProjection=res.req?.method==='GET'&&status===200&&(
    ['/api/volunteer/workflow','/api/volunteer/workflow/catalog','/api/volunteer/workflow/sources','/api/volunteer/workflow/directory','/api/materials/overview'].includes(publicPath)
    || /^\/api\/volunteer\/workflow\/events\/[^/]+\/detail$/.test(publicPath)
  );
  const compressible=publicProjection||managementProjection;
  const encoding={};
  if(compressible){
    encoding.Vary='Accept-Encoding';
    if(Buffer.byteLength(body)>=1024&&acceptsGzip(res.req)){
      const zipped=gzipSync(body,{level:4});
      if(zipped.length<Buffer.byteLength(body)){body=zipped;encoding['Content-Encoding']='gzip';}
    }
  }
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...encoding,
    ...headers,
  });
  res.end(body);
}
