import { createHash } from 'node:crypto';
import { encodePublicText, preferredEncoding } from './compression.js';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, resolve, relative, sep, isAbsolute } from 'node:path';
import { json, securityHeaders } from './response.js';
import {
  createWebAssets,
  STYLE_BUNDLE_PATH,
  CONSOLE_STYLE_BUNDLE_PATH,
  EXTRA_STYLE_BUNDLE_PATH,
  CONSOLE_EXTRA_STYLE_BUNDLE_PATH,
} from './web-assets.js';

/** Native ESM is shipped unbundled. A delivery-time release token pins the UNO
 * page module, its stylesheet and its card art for immutable caching; the shell
 * stays `no-store` and a deploy rotates the token. Scope is deliberately small:
 * many page modules are both statically and lazily imported, so giving only one
 * of those URLs a token would create two live module instances and split state.
 */
const UNO_LAZY = /(\bimport\s*\(\s*)(['"])([^'"]*\/pages\/uno\.js)\2(\s*\))/g;
const SHELL_MODULE = /(["'])(\/app\/[^"']+?\.(?:js|mjs))\1/g;
const ENTRY_MODULES = new Set(['/app/main.js', '/app/boot.js', '/app/portal/events-fonts.js']);
const UNO_PAGE = '/app/portal/pages/uno.js';
const UNO_HINTS = [
  UNO_PAGE,
  '/app/games/uno/engine.js',
  '/app/games/uno/ai.js',
  '/app/games/uno/client.js',
];
const VERSION_TTL_MS = 1000;

/** Only the game leaf module and static assets are versioned; shared modules keep one URL. */
export function versionablePath(path) {
  return ENTRY_MODULES.has(path) || path === UNO_PAGE || path.startsWith('/assets/') || path.startsWith('/styles/');
}

function withVersion(path, version) {
  if (!version) return path;
  const hashAt = path.indexOf('#');
  const head = hashAt < 0 ? path : path.slice(0, hashAt);
  const tail = hashAt < 0 ? '' : path.slice(hashAt);
  return `${head}${head.includes('?') ? '&' : '?'}v=${version}${tail}`;
}

/** Pure helper, shared with release verification so delivered bytes stay auditable. */
export function rewriteModuleUrls(source, version) {
  return source.replace(UNO_LAZY, (_all, prefix, quote, specifier, suffix) =>
    `${prefix}${quote}${withVersion(specifier, version)}${quote}${suffix}`);
}

async function frontendFiles(root) {
  const found = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const file = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (/\.(?:js|mjs|css)$/.test(entry.name)) found.push(file);
    }
  }
  await walk(resolve(root, 'app'));
  await walk(resolve(root, 'styles'));
  found.push(resolve(root, 'index.html'));
  return found;
}

/** Any front-end source change produces a new token; stats are cached briefly. */
export function createAssetVersion(root, { ttlMs = VERSION_TTL_MS } = {}) {
  let value = '', checkedAt = Number.NEGATIVE_INFINITY, pending = null;
  return {
    async current() {
      if (value && Date.now() - checkedAt < ttlMs) return value;
      if (pending) return pending;
      pending = (async () => {
        const rows = [];
        for (const file of await frontendFiles(root)) {
          try { const info = await stat(file); rows.push(`${relative(root, file)}:${info.size}:${info.mtimeMs}`); }
          catch { /* a removed optional asset must not break the shell */ }
        }
        value = createHash('sha256').update(rows.join('|')).digest('hex').slice(0, 16);
        checkedAt = Date.now();
        return value;
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}

async function versionedShell(html, version, publicDir, { uno = false } = {}) {
  const paths = [...new Set([...html.matchAll(SHELL_MODULE)].map(match => match[2]))];
  const exists = new Map();
  await Promise.all(paths.map(async path => {
    try { exists.set(path, (await stat(resolve(publicDir, `.${path}`))).isFile()); }
    catch { exists.set(path, false); }
  }));
  let result = html.replace(SHELL_MODULE, (all, quote, path) =>
    exists.get(path) && versionablePath(path) ? `${quote}${withVersion(path, version)}${quote}` : all);
  if (!/data-asset-version=/.test(result)) {
    result = result.replace(/<html\b([^>]*)>/, (_all, attrs) => `<html${attrs} data-asset-version="${version}">`);
  }
  if (uno) {
    const hints = [
      ...UNO_HINTS.map(path => `<link rel="modulepreload" href="${versionablePath(path) ? withVersion(path, version) : path}" />`),
      `<link rel="preload" as="style" href="${withVersion('/styles/uno.css', version)}" />`,
    ].join('');
    result = result.replace('</head>', `${hints}</head>`);
  }
  return result;
}

/** Serve the public directory and fall back to the SPA shell for extensionless routes. */
export function createStaticHandler(directory, { assetVersion = createAssetVersion(directory) } = {}) {
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
  const shells = new Map();
  // Only the platform's own bundle graph is rewritten. Static handlers for
  // third-party or synthetic directories keep serving their files verbatim.
  let moduleGraph = null;

  async function hasModuleGraph() {
    if (moduleGraph === null) {
      try { moduleGraph = (await stat(resolve(publicDir, 'app/main.js'))).isFile(); }
      catch { moduleGraph = false; }
    }
    return moduleGraph;
  }

  function surfaceOf(pathname) {
    return pathname.startsWith('/console') || pathname.startsWith('/admin') ? 'console' : 'portal';
  }

  async function sendAppShell(req, res, url) {
    const surface = surfaceOf(url.pathname);
    const uno = url.pathname === '/games/uno';
    const release = await hasModuleGraph() ? await assetVersion.current() : '';
    // The shell is deterministic for a release; stat-ing every preload target
    // per request would add avoidable work to the one document we cannot cache.
    const key = `${surface}|${release}|${uno}`;
    let html = shells.get(key);
    if (!html) {
      try {
        ({ html } = await webAssets.shell(surface));
      } catch {
        // Delivery-time assembly is best effort: serving the shell with its
        // original stylesheet links beats failing the page outright.
        try {
          html = await readFile(resolve(publicDir, 'index.html'), 'utf8');
        } catch {
          return json(res, 500, { ok: false, message: 'Application shell is missing' });
        }
      }
      if (release) html = await versionedShell(html, release, publicDir, { uno });
      if (shells.size >= 8) shells.clear();
      shells.set(key, html);
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

    // Unversioned assets must revalidate. A matching release token pins the
    // whole front-end graph, so modules, styles and game art are immutable
    // until the next deploy changes the token in the no-store shell.
    const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
    let cacheControl = extension === '.html' ? 'no-store' : 'no-cache';
    let fontContents = null;
    const version = url.searchParams.get('v');
    const release = await hasModuleGraph() ? await assetVersion.current() : '';
    const pinned = Boolean(release && version === release && requested !== '/index.html');
    if (pinned) cacheControl = 'public, max-age=31536000, immutable';
    else if (['.woff2', '.webp', '.jpg', '.jpeg', '.png'].includes(extension) && requested.startsWith('/assets/') && /^[a-f0-9]{64}$/.test(version || '')) {
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
      const key = `${file}|${preferredEncoding(req)}|${release}`;
      const saved = assets.get(key);
      let encoded;
      if (compressible && saved?.etag === etag) encoded = saved.encoded;
      else {
        let contents = fontContents || await readFile(file);
        if (release && ['.js', '.mjs'].includes(extension)) {
          const source = contents.toString('utf8');
          const rewritten = rewriteModuleUrls(source, release);
          if (rewritten !== source) contents = Buffer.from(rewritten);
        }
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
