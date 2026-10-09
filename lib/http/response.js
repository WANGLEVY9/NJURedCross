import { gzipSync } from 'node:zlib';
import { acceptsGzip } from './compression.js';

/** Shared HTTP response policy for APIs and static assets. */
export function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  };
}

export function json(res, status, payload, headers = {}) {
  let body=JSON.stringify(payload);
  const publicPath=String(res.req?.url||'').split('?')[0];
  const compressible=['/api/public/events','/api/public/overview','/api/public/workflow/events','/api/public/warmth/capabilities'].includes(publicPath);
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
