import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticHandler } from '../lib/http/static.js';

const digest = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'nju-font-cache-'));
  await mkdir(join(dir, 'assets/fonts'), { recursive: true });
  const bytes = Buffer.from('synthetic-font-bytes');
  await writeFile(join(dir, 'assets/fonts/test.woff2'), bytes);
  await writeFile(join(dir, 'index.html'), '<h1>synthetic</h1>');
  await writeFile(join(dir, 'site.css'), 'body { color: black; }');
  const handler = createStaticHandler(dir);
  t.after(() => rm(dir, { recursive: true, force: true }));
  async function get(path, options = {}) {
    const headers = Object.fromEntries(Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    const req = { url: path, method: 'GET', headers };
    let status, responseHeaders, body;
    const res = { req,
      writeHead(code, values) { status = code; responseHeaders = new Headers(values); },
      end(value) { body = Buffer.from(value || ''); },
    };
    await handler(req, res, new URL(path, 'http://fixture'));
    return { status, headers: responseHeaders, arrayBuffer: async () => Uint8Array.from(body).buffer };
  }
  return { dir, bytes, get };
}
test('matching font content hash enables long caching without altering bytes', async t => {
  const f = await fixture(t); const response = await f.get(`/assets/fonts/test.woff2?v=${digest(f.bytes)}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes);
});
test('unversioned, malformed and incorrect hashes still require revalidation', async t => {
  const f = await fixture(t);
  for (const suffix of ['', '?v=bad', `?v=${'0'.repeat(64)}`]) {
    const response = await f.get('/assets/fonts/test.woff2' + suffix);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
  }
});
test('matching font revalidation returns 304 and preserves its cache policy', async t => {
  const f = await fixture(t); const path = `/assets/fonts/test.woff2?v=${digest(f.bytes)}`;
  const first = await f.get(path);
  const next = await f.get(path, { headers: { 'If-None-Match': first.headers.get('etag') } });
  assert.equal(next.status, 304);
  assert.equal((await next.arrayBuffer()).byteLength, 0);
  assert.equal(next.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});
test('after a font update only its new content hash authorizes long caching', async t => {
  const f = await fixture(t); const old = digest(f.bytes);
  const changed = Buffer.from('synthetic-updated-font-with-more-bytes');
  await writeFile(join(f.dir, 'assets/fonts/test.woff2'), changed);
  const stale = await f.get(`/assets/fonts/test.woff2?v=${old}`);
  assert.equal(stale.headers.get('cache-control'), 'no-cache');
  const fresh = await f.get(`/assets/fonts/test.woff2?v=${digest(changed)}`);
  assert.equal(fresh.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.deepEqual(Buffer.from(await fresh.arrayBuffer()), changed);
});
test('HTML and CSS do not gain long caching from arbitrary version parameters', async t => {
  const f = await fixture(t);
  const html = await f.get('/index.html?v=' + '0'.repeat(64));
  assert.equal(html.headers.get('cache-control'), 'no-store');
  const css = await f.get('/site.css?v=' + digest('body { color: black; }'));
  assert.equal(css.headers.get('cache-control'), 'no-cache');
});
test('missing versioned font remains a non-cacheable error', async t => {
  const f = await fixture(t); const response = await f.get('/assets/fonts/missing.woff2?v=' + '0'.repeat(64));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('responsive public images require their actual content hash for immutable caching', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, 'assets/test.webp'), f.bytes);
  const path = `/assets/test.webp?v=${digest(f.bytes)}`;
  const first = await f.get(path);
  assert.equal(first.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(first.headers.get('content-type'), 'image/webp');
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), f.bytes);
  const cached = await f.get(path, { headers: { 'If-None-Match': first.headers.get('etag') } });
  assert.equal(cached.status, 304);
  await writeFile(join(f.dir, 'assets/test.webp'), Buffer.from('different image bytes'));
  const stale = await f.get(path);
  assert.equal(stale.headers.get('cache-control'), 'no-cache');
});
