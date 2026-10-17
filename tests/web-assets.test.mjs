import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createStaticHandler } from '../lib/http/static.js';
import { createWebAssets, STYLE_BUNDLE_PATH } from '../lib/http/web-assets.js';

const SHELL = `<!doctype html><html><head><title>fixture</title>
<link rel="stylesheet" href="/styles/first.css" />
<link rel="stylesheet" href="/styles/second.css">
<link rel="stylesheet" href="/assets/print.css" />
<link rel="modulepreload" href="/app/main.js" />
</head><body><div id="root"></div></body></html>`;
const FIRST = '/* first */\n.a{color:red}\n' + '.pad-first{content:"fixture padding"}\n'.repeat(90);
const SECOND = '/* second */\n.b{background:url("/assets/fonts/x.woff2")}\n' + '.pad-second{content:"fixture padding"}\n'.repeat(90);

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'nju-web-assets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'styles'));
  await writeFile(join(dir, 'index.html'), SHELL);
  await writeFile(join(dir, 'styles', 'first.css'), FIRST);
  await writeFile(join(dir, 'styles', 'second.css'), SECOND);
  const handler = createStaticHandler(dir);
  const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://fixture')));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

const get = (origin, path, headers = {}) => new Promise((resolve, reject) => {
  http.get(origin + path, { headers }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

test('the shell collapses stylesheet links into one versioned bundle', async t => {
  const origin = await fixture(t);
  const shell = await get(origin, '/');
  const html = shell.body.toString('utf8');
  const links = html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) || [];
  const local = links.filter(tag => /href="\/styles\//.test(tag));
  assert.equal(local.length, 1, 'all /styles/ sheets collapse into the bundle');
  assert.equal(links.length, 2, 'a non-/styles/ sheet is left untouched');
  const href = local[0].match(/href="([^"]+)"/)[1];
  assert.match(href, /^\/styles\/app\.css\?v=[0-9a-f]{12}$/);
  // Non-local stylesheets and preloads are left untouched.
  assert.match(html, /href="\/assets\/print\.css"/);
  assert.match(html, /rel="modulepreload" href="\/app\/main\.js"/);
  assert.match(html, /rel="modulepreload" href="\/app\/core\/format\.js"/);
  assert.equal(shell.headers['cache-control'], 'no-store');
  assert.equal(shell.headers.vary, 'Accept-Encoding');
});

test('the console surface preloads console modules; the portal does not', async t => {
  const origin = await fixture(t);
  const portal = (await get(origin, '/')).body.toString('utf8');
  const consoleShell = (await get(origin, '/console/overview')).body.toString('utf8');
  assert.doesNotMatch(portal, /console\/shell\.js/);
  assert.match(consoleShell, /console\/shell\.js/);
  assert.match(portal, /portal\/navigation\.js/);
});

test('the bundle preserves stylesheet order and pins to the shell version', async t => {
  const origin = await fixture(t);
  const html = (await get(origin, '/')).body.toString('utf8');
  const version = html.match(/app\.css\?v=([0-9a-f]{12})/)[1];

  const pinned = await get(origin, `/styles/app.css?v=${version}`, { 'Accept-Encoding': 'gzip' });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal(pinned.headers['cache-control'], 'public, max-age=31536000, immutable');
  const css = gunzipSync(pinned.body).toString('utf8');
  assert.ok(css.indexOf('/* first */') < css.indexOf('/* second */'), 'head order is preserved');
  assert.match(css, /url\("\/assets\/fonts\/x\.woff2"\)/);
  assert.match(pinned.headers.etag, /^W\/"[0-9a-f]{12}"$/);

  // Revalidation and a stale token both fall back to revalidation, never immutability.
  assert.equal((await get(origin, `/styles/app.css?v=${version}`, { 'If-None-Match': pinned.headers.etag })).status, 304);
  assert.equal((await get(origin, '/styles/app.css')).headers['cache-control'], 'no-cache');
  assert.equal((await get(origin, '/styles/app.css?v=000000000000')).headers['cache-control'], 'no-cache');
});

test('the bundle negotiates brotli and gzip independently of gzip-only callers', async t => {
  const origin = await fixture(t);
  const html = (await get(origin, '/')).body.toString('utf8');
  const version = html.match(/app\.css\?v=([0-9a-f]{12})/)[1];

  const br = await get(origin, `/styles/app.css?v=${version}`, { 'Accept-Encoding': 'br, gzip' });
  assert.equal(br.headers['content-encoding'], 'br');
  const brText = brotliDecompressSync(br.body).toString('utf8');
  assert.match(brText, /^\/\* \/styles\/first\.css \*\//);
  assert.ok(brText.includes('/* first */') && brText.indexOf('/* first */') < brText.indexOf('/* second */'));

  const gz = await get(origin, `/styles/app.css?v=${version}`, { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');

  const plain = await get(origin, `/styles/app.css?v=${version}`, { 'Accept-Encoding': 'identity' });
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.ok(plain.body.toString('utf8').includes('/* first */'));
});

test('the bundle token changes when a stylesheet changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nju-web-assets-version-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'styles'));
  await writeFile(join(dir, 'index.html'), SHELL);
  await writeFile(join(dir, 'styles', 'first.css'), FIRST);
  await writeFile(join(dir, 'styles', 'second.css'), SECOND);
  const first = (await createWebAssets(dir).bundle()).version;
  await writeFile(join(dir, 'styles', 'second.css'), SECOND + '.c{color:blue}\n');
  const second = (await createWebAssets(dir).bundle()).version;
  assert.notEqual(first, second);
  assert.equal(STYLE_BUNDLE_PATH, '/styles/app.css');
});
