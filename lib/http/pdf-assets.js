import { fileURLToPath } from 'node:url';
import { createStaticHandler } from './static.js';
import { json } from './response.js';
/** Expose only PDF.js browser assets, never arbitrary files in node_modules. */
export function createPdfAssets() {
  const serve = createStaticHandler(fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url)));
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/vendor/pdfjs/')) return false;
    if (!['GET', 'HEAD'].includes(req.method)) { json(res, 405, { ok: false }); return true; }
    if (!/^\/vendor\/pdfjs\/(?:build\/pdf(?:\.worker)?\.mjs|cmaps\/[A-Za-z0-9_-]+\.bcmap|standard_fonts\/[A-Za-z0-9_.-]+|wasm\/[A-Za-z0-9_-]+\.wasm)$/.test(url.pathname)) {
      json(res, 404, { ok: false }); return true;
    }
    const asset = new URL(url); asset.pathname = url.pathname.slice('/vendor/pdfjs'.length);
    await serve(req, res, asset); return true;
  };
}
