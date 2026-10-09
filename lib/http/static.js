import { encodePublicText, acceptsGzip } from './compression.js';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, relative, sep, isAbsolute } from 'node:path';
import { json, securityHeaders } from './response.js';

/** Serve the public directory and fall back to the SPA shell for extensionless routes. */
export function createStaticHandler(directory) {
  const publicDir = resolve(directory);
  const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
  };

  const assets = new Map();

  async function sendAppShell(req, res) {
    try {
      const contents = await readFile(resolve(publicDir, 'index.html'));
      const encoded=await encodePublicText(req,contents);
      res.writeHead(200, { ...securityHeaders(), ...encoded.headers, 'Content-Type': mimeTypes['.html'], 'Cache-Control': 'no-store' });
      res.end(encoded.body);
    } catch {
      json(res, 500, { ok: false, message: 'Application shell is missing' });
    }
  }

  async function staticFile(req, res, url) {
    let requested;
    try {
      requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    } catch {
      return json(res, 400, { ok: false, message: 'Malformed request path' });
    }
    if (requested.includes('\0')) return json(res, 400, { ok: false, message: 'Malformed request path' });
    const file = resolve(publicDir, `.${requested}`);
    const relativePath = relative(publicDir, file);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return json(res, 403, { ok: false, message: 'Forbidden' });
    const extension = extname(file);

    let info;
    try {
      info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
    } catch {
      // Client-side routes such as /events/EVT-1 or /console/materials have no
      // file on disk: return the application shell so the router can take over.
      if (!extension) return sendAppShell(req,res);
      return json(res, 404, { ok: false, message: 'File not found' });
    }

    // Assets are unversioned, so they must revalidate rather than be held for a
    // fixed lifetime; otherwise a deploy leaves users on stale CSS and JS.
    const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ...securityHeaders(), ETag: etag, Vary:'Accept-Encoding', 'Cache-Control': 'no-cache' });
      return res.end();
    }

    try {
      const compressible=['.js','.mjs','.css','.svg','.html','.json'].includes(extension);
      const key=`${file}|${acceptsGzip(req)?'gzip':'identity'}`;
      const saved=assets.get(key);
      let encoded;
      if(compressible && saved?.etag===etag)encoded=saved.encoded;
      else {
        const contents=await readFile(file);
        encoded=compressible?await encodePublicText(req,contents):{body:contents,headers:{}};
        if(compressible&&extension!=='.html'&&info.size<=512_000){
          if(assets.size>=128)assets.delete(assets.keys().next().value);
          assets.set(key,{etag,encoded});
        }
      }
      res.writeHead(200, {
        ...securityHeaders(),
        ...encoded.headers,
        'Content-Type': mimeTypes[extension] || 'application/octet-stream',
        'Cache-Control': requested.endsWith('.html') ? 'no-store' : 'no-cache',
        ETag: etag,
        'Last-Modified': info.mtime.toUTCString(),
      });
      res.end(encoded.body);
    } catch {
      json(res, 404, { ok: false, message: 'File not found' });
    }
  }

  return staticFile;
}
