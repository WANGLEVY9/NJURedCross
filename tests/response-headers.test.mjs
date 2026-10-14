import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { securityHeaders, json } from '../lib/http/response.js';

function fakeRes(url = '/api/public/events', acceptEncoding = 'gzip') {
  const calls = { status: 0, headers: null, body: null };
  return {
    req: { url, headers: { 'accept-encoding': acceptEncoding } },
    writeHead(status, headers) { calls.status = status; calls.headers = headers; },
    end(body) { calls.body = body; },
    calls,
  };
}

test('every API response carries the security header set', () => {
  const headers = securityHeaders();
  assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.equal(headers['Permissions-Policy'], 'camera=(self), microphone=(), geolocation=()');
});

test('json responses are never cached and always labelled as JSON', () => {
  const res = fakeRes('/api/materials/overview');
  json(res, 200, { ok: true });
  assert.equal(res.calls.status, 200);
  assert.equal(res.calls.headers['Cache-Control'], 'no-store');
  assert.equal(res.calls.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(res.calls.headers['X-Frame-Options'], 'DENY');
});

test('only the public listing endpoints are eligible for gzip', () => {
  const compressed = fakeRes('/api/public/events');
  json(compressed, 200, { items: 'x'.repeat(2000) });
  assert.equal(compressed.calls.headers['Content-Encoding'], 'gzip');
  assert.equal(compressed.calls.headers.Vary, 'Accept-Encoding');

  const plain = fakeRes('/api/materials/overview');
  json(plain, 200, { items: 'x'.repeat(2000) });
  assert.equal(plain.calls.headers['Content-Encoding'], undefined);
  assert.equal(plain.calls.headers.Vary, undefined);
});

test('a compressed body round-trips to the original payload', () => {
  const payload = { items: Array.from({ length: 200 }, (_, index) => `synthetic-${index}`) };
  const res = fakeRes('/api/public/overview');
  json(res, 200, payload);
  assert.equal(res.calls.headers['Content-Encoding'], 'gzip');
  assert.deepEqual(JSON.parse(gunzipSync(res.calls.body).toString('utf8')), payload);
});

test('small payloads stay uncompressed even on public endpoints', () => {
  const res = fakeRes('/api/public/events');
  json(res, 200, { ok: true });
  assert.equal(res.calls.headers['Content-Encoding'], undefined);
  assert.equal(res.calls.headers.Vary, 'Accept-Encoding');
  assert.deepEqual(JSON.parse(res.calls.body.toString('utf8')), { ok: true });
});

test('a client that refuses gzip receives plain JSON', () => {
  const res = fakeRes('/api/public/events', 'gzip;q=0');
  json(res, 200, { items: 'x'.repeat(2000) });
  assert.equal(res.calls.headers['Content-Encoding'], undefined);
  assert.deepEqual(JSON.parse(res.calls.body.toString('utf8')).items.length, 2000);
});

test('caller-supplied headers win over the defaults', () => {
  const res = fakeRes('/api/public/events');
  json(res, 302, { ok: true }, { Location: '/login', 'Cache-Control': 'no-cache' });
  assert.equal(res.calls.headers.Location, '/login');
  assert.equal(res.calls.headers['Cache-Control'], 'no-cache');
});

test('explicit management GET projections compress losslessly without enabling shared caching',()=>{
 const payload={events:Array.from({length:600},(_,i)=>({_id:`synthetic-${i}`,name:'合成活动'}))};
 for(const path of ['/api/volunteer/workflow','/api/volunteer/workflow/sources','/api/volunteer/workflow/directory']){
  const res=fakeRes(path);res.req.method='GET';json(res,200,payload);
  assert.equal(res.calls.headers['Content-Encoding'],'gzip');
  assert.equal(res.calls.headers['Cache-Control'],'no-store');
  assert.deepEqual(JSON.parse(gunzipSync(res.calls.body)),payload);
  assert.ok(res.calls.body.length<Buffer.byteLength(JSON.stringify(payload))/4);
 }
 for(const [path,method,status] of [['/api/auth/session','GET',200],['/api/volunteer/workflow','POST',200],['/api/volunteer/workflow','GET',401]]){
  const res=fakeRes(path);res.req.method=method;json(res,status,payload);assert.equal(res.calls.headers['Content-Encoding'],undefined);
 }
});
