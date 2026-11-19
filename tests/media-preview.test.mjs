import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import http from 'node:http';
import { once } from 'node:events';
import { loadMediaPreview, clearMediaPreviewCache, MEDIA_PREVIEW_MAX_BYTES } from '../lib/attachment/media-preview.js';
import { mediaRoutes, resolveThumb, clearThumbCache } from '../lib/attachment/media.js';
import { withDisplayReads, invalidateDisplayReads, isDisplayRequest } from '../lib/http/display-reads.js';
import { withRequestBudget } from '../lib/http/request-budget.js';
import { createObserver } from '../lib/observability.js';
import { json } from '../lib/http/response.js';

test('large originals produce bounded oriented previews; concurrent and repeat reads download once', async t => {
  clearMediaPreviewCache();
  t.after(clearMediaPreviewCache);
  const bytes = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#367c59' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  let downloads = 0;
  const download = async (_config, _path, _library, { maxBytes }) => {
    downloads++;
    assert.equal(maxBytes, 20 * 1024 * 1024);
    return bytes;
  };
  const media = { id: 'PHO-FIXTURE', path: '/fixture.jpg' };
  const [a, b] = await Promise.all([loadMediaPreview({}, media, { download }), loadMediaPreview({}, media, { download })]);
  assert.equal(downloads, 1);
  assert.deepEqual(a, b);
  const metadata = await sharp(a).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1600);
  assert.equal(metadata.orientation, undefined);
  assert.ok(a.length <= MEDIA_PREVIEW_MAX_BYTES);
  await loadMediaPreview({}, media, { download });
  assert.equal(downloads, 1);
  await loadMediaPreview({}, { ...media, path: '/renamed.jpg' }, { download });
  assert.equal(downloads, 2);
});

test('failed downloads and invalid images do not poison preview cache; image work has bounded concurrency', async t => {
  clearMediaPreviewCache();
  t.after(clearMediaPreviewCache);
  const media = { id: 'PHO-FAIL', path: '/fixture.jpg' };
  await assert.rejects(loadMediaPreview({}, media, { download: async () => { throw Object.assign(Error('private'), { code: 'external_request_timeout' }); } }), { code: 'external_request_timeout' });
  await assert.rejects(loadMediaPreview({}, media, { download: async () => Buffer.from('not an image') }));
  const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#993345' } }).jpeg().toBuffer();
  let active = 0, peak = 0;
  const download = async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return bytes;
  };
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => loadMediaPreview({}, { id: `PHO-${i}`, path: `/fixture-${i}.jpg` }, { download })));
  assert.equal(peak, 1);
  assert.ok(results.every(buffer => buffer.length <= MEDIA_PREVIEW_MAX_BYTES));
  assert.ok((await loadMediaPreview({}, media, { download })).length > 0);
});

test('preview HTTP route checks ownership and deletion before shared cache and emits sanitized traces', async t => {
  clearMediaPreviewCache();
  t.after(clearMediaPreviewCache);
  const bytes = await sharp({ create: { width: 2200, height: 1200, channels: 3, background: '#306d80' } }).jpeg().toBuffer();
  let downloads = 0;
  const rows = [{ 照片ID: 'PHO-PRIVATE', 上传人: 'owner', 文件路径: '/SECRET.jpg', 文件名: 'SECRET.jpg' }];
  const logs = [];
  const observer = createObserver({ sink: record => logs.push(record) });
  const base = { listRows: async () => rows };
  const config = { njuboxToken: 'SECRET', njuboxServerUrl: 'https://box.example', njuboxFetch: async input => {
    if (new URL(input).pathname.endsWith('/download-link/')) return Response.json('https://box.example/seafhttp/SECRET');
    downloads++;
    return new Response(bytes);
  } };
  const server = http.createServer((req, res) => observer.http(req, res, async () => {
    const ctx = { config, tables: { media: 'fixture-media' }, getBase: async () => base, json,
      requirePortalSession: () => ({ user: req.headers['x-fixture-user'] }),
      ownsBusinessRef: (session, ref) => session.user === ref };
    try { await mediaRoutes(req, res, new URL(req.url, 'http://fixture'), ctx); }
    catch { json(res, 502, { ok: false }); }
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/public/media/PHO-PRIVATE/preview`;
  const get = user => fetch(url, { headers: { 'x-fixture-user': user } });
  const allowed = await get('owner');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
  assert.equal(allowed.headers.get('content-type'), 'image/jpeg');
  assert.ok((await allowed.arrayBuffer()).byteLength <= MEDIA_PREVIEW_MAX_BYTES);
  assert.equal((await get('stranger')).status, 403);
  assert.equal((await get('owner')).status, 200);
  assert.equal(downloads, 1);
  rows[0].留用状态 = '已删除';
  assert.equal((await get('owner')).status, 404);
  const httpLogs = logs.filter(record => record.type === 'http');
  assert.equal(httpLogs.length, 4);
  assert.equal(httpLogs[0].route, '/api/public/media/:id/preview');
  assert.ok(!JSON.stringify(logs).includes('SECRET'));
});

test('media display reads share a complete table and invalidate by tag; writes read current evidence', async t => {
  t.after(() => invalidateDisplayReads());
  invalidateDisplayReads();
  let reads = 0;
  const base = { listRows: async () => { reads++; return []; } };
  const ctx = { tables: { media: 'fixture-media' }, getBase: async () => base, json: (_res, _status, payload) => payload,
    requirePortalSession: () => ({}), ownsBusinessRef: () => true };
  const run = path => mediaRoutes({ method: 'GET' }, {}, new URL(path, 'http://fixture'), ctx);
  await Promise.all(['/api/public/media', '/api/public/media/picks'].map(path => withDisplayReads(() => run(path))));
  assert.equal(reads, 1);
  invalidateDisplayReads(['fixture-media']);
  await withDisplayReads(() => run('/api/public/media'));
  assert.equal(reads, 2);
  await run('/api/public/media');
  assert.equal(reads, 3);
  assert.equal(isDisplayRequest('GET', '/api/public/media/PHO-1/preview'), true);
  assert.equal(isDisplayRequest('POST', '/api/public/media/picks'), false);
});

test('thumbnail duplicate requests coalesce; transient failures retry and cancellation does not become a missing photo', async t => {
  clearThumbCache();
  t.after(clearThumbCache);
  const base = { listRows: async () => [{ 照片ID: 'PHO-THUMB', 上传人: 'owner', 文件路径: '/fixture/activity/activity-照片/fixture.jpg' }] };
  const ctx = { config: {}, tables: { media: 'fixture' }, getBase: async () => base, ownsBusinessRef: () => true };
  let downloads = 0;
  const download = async () => { downloads++; await new Promise(resolve => setTimeout(resolve, 20)); return Buffer.from('jpeg'); };
  const call = options => resolveThumb(ctx, {}, 'PHO-THUMB', options);
  await Promise.all([call({ download }), call({ download }), call({ download })]);
  assert.equal(downloads, 1);
  clearThumbCache();
  await assert.rejects(call({ download: async () => { throw Object.assign(Error('private'), { statusCode: 502 }); } }), { statusCode: 502 });
  await assert.rejects(withRequestBudget(() => call({ download }), { timeoutMs: 1 }), { code: 'external_request_timeout' });
  assert.equal((await call({ download })).status, 200);
  assert.equal(downloads, 2);
});
