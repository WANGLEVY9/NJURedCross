import { createHash } from 'node:crypto';
import { encodePublicText, preferredEncoding } from './compression.js';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, relative, sep, isAbsolute } from 'node:path';
import { json, securityHeaders } from './response.js';
import {
  createWebAssets,
  STYLE_BUNDLE_PATH,
  CONSOLE_STYLE_BUNDLE_PATH,
  EXTRA_STYLE_BUNDLE_PATH,
  CONSOLE_EXTRA_STYLE_BUNDLE_PATH,
} from './web-assets.js';

/** Serve the public directory and fall back to the SPA shell for extensionless routes. */
export function createStaticHandler(directory) {
  const publicDir = resolve(directory);
  const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
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
  const webAssets = createWebAssets(publicDir);
  const bundles = new Map();

  function surfaceOf(pathname) {
    return pathname.startsWith('/console') || pathname.startsWith('/admin') ? 'console' : 'portal';
  }

  async function sendAppShell(req, res, url) {
    let html;
    try {
      ({ html } = await webAssets.shell(surfaceOf(url.pathname)));
    } catch {
      // Delivery-time assembly is best effort: serving the shell with its
      // original stylesheet links beats failing the page outright.
      try {
        html = await readFile(resolve(publicDir, 'index.html'), 'utf8');
      } catch {
        return json(res, 500, { ok: false, message: 'Application shell is missing' });
      }
    }
    try {
      const encoded = await encodePublicText(req, html);
      res.writeHead(200, { ...securityHeaders(), ...encoded.headers, 'Content-Type': mimeTypes['.html'], 'Cache-Control': 'no-store' });
      res.end(encoded.body);
    } catch {
      json(res, 500, { ok: false, message: 'Application shell is missing' });
    }
  }

  /** The concatenated stylesheet. Only `/styles/app*.css?v=<current>` is immutable. */
  async function sendStyleBundle(req, res, url, surface, part = 'critical') {
    let body;
    let version;
    try {
      ({ body, version } = await webAssets.bundle(surface, part));
    } catch {
      return json(res, 500, { ok: false, message: 'Application shell is missing' });
    }
    const etag = `W/"${version}"`;
    const cacheControl = url.searchParams.get('v') === version
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ...securityHeaders(), ETag: etag, Vary: 'Accept-Encoding', 'Cache-Control': cacheControl });
      return res.end();
    }
    const key = `${version}|${preferredEncoding(req)}`;
    let encoded = bundles.get(key);
    if (!encoded) {
      encoded = await encodePublicText(req, body);
      if (bundles.size >= 4) bundles.delete(bundles.keys().next().value);
      bundles.set(key, encoded);
    }
    res.writeHead(200, {
      ...securityHeaders(),
      ...encoded.headers,
      'Content-Type': mimeTypes['.css'],
      'Cache-Control': cacheControl,
      ETag: etag,
    });
    res.end(encoded.body);
  }

  async function staticFile(req, res, url) {
    let requested;
    try {
      requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    } catch {
      return json(res, 400, { ok: false, message: 'Malformed request path' });
    }
    if (requested.includes('\0')) return json(res, 400, { ok: false, message: 'Malformed request path' });
    if (requested === STYLE_BUNDLE_PATH) return sendStyleBundle(req, res, url, 'portal', 'critical');
    if (requested === EXTRA_STYLE_BUNDLE_PATH) return sendStyleBundle(req, res, url, 'portal', 'extra');
    if (requested === CONSOLE_STYLE_BUNDLE_PATH) return sendStyleBundle(req, res, url, 'console', 'critical');
    if (requested === CONSOLE_EXTRA_STYLE_BUNDLE_PATH) return sendStyleBundle(req, res, url, 'console', 'extra');
    // index.html is the application shell, not an ordinary asset: it must be
    // rewritten for delivery, so it never takes the plain file path.
    if (requested === '/index.html') return sendAppShell(req, res, url);
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
      if (!extension) return sendAppShell(req, res, url);
      return json(res, 404, { ok: false, message: 'File not found' });
    }

    // Unversioned assets must revalidate. Only fonts and images with a verified content
    // hash below may use a long lifetime; CSS and JS keep deployment-safe checks.
    const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
    let cacheControl = extension === '.html' ? 'no-store' : 'no-cache';
    let fontContents = null;
    const version = url.searchParams.get('v');
    if (['.woff2', '.webp', '.jpg', '.jpeg', '.png'].includes(extension) && requested.startsWith('/assets/') && /^[a-f0-9]{64}$/.test(version || '')) {
      try {
        fontContents = await readFile(file);
        if (createHash('sha256').update(fontContents).digest('hex') === version) {
          cacheControl = 'public, max-age=31536000, immutable';
        }
      } catch {
        return json(res, 404, { ok: false, message: 'File not found' });
      }
    }
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ...securityHeaders(), ETag: etag, Vary:'Accept-Encoding', 'Cache-Control': cacheControl });
      return res.end();
    }

    try {
      const compressible = ['.js', '.mjs', '.css', '.svg', '.html', '.json'].includes(extension);
      const key = `${file}|${preferredEncoding(req)}`;
      const saved = assets.get(key);
      let encoded;
      if (compressible && saved?.etag === etag) encoded = saved.encoded;
      else {
        const contents = fontContents || await readFile(file);
        encoded = compressible ? await encodePublicText(req, contents) : { body: contents, headers: {} };
        if (compressible && extension !== '.html' && info.size <= 512_000) {
          if (assets.size >= 128) assets.delete(assets.keys().next().value);
          assets.set(key, { etag, encoded });
        }
      }
      res.writeHead(200, {
        ...securityHeaders(),
        ...encoded.headers,
        'Content-Type': mimeTypes[extension] || 'application/octet-stream',
        'Cache-Control': cacheControl,
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
