import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { acceptsGzip, encodePublicText } from '../lib/http/compression.js';

const req = encoding => ({ headers: { 'accept-encoding': encoding } });

test('an explicit gzip offer is accepted', () => {
  assert.equal(acceptsGzip(req('gzip')), true);
  assert.equal(acceptsGzip(req('gzip, deflate, br')), true);
  assert.equal(acceptsGzip(req('GZIP')), true);
  assert.equal(acceptsGzip(req('gzip;q=0.5')), true);
});

test('a wildcard offer is accepted', () => {
  assert.equal(acceptsGzip(req('*')), true);
});

test('gzip with zero quality is refused', () => {
  assert.equal(acceptsGzip(req('gzip;q=0')), false);
  assert.equal(acceptsGzip(req('gzip;q=0, *;q=0')), false);
});

test('other encodings and missing headers are refused', () => {
  assert.equal(acceptsGzip(req('br, deflate')), false);
  assert.equal(acceptsGzip(req('identity')), false);
  assert.equal(acceptsGzip(req('')), false);
  assert.equal(acceptsGzip(undefined), false);
  assert.equal(acceptsGzip({}), false);
});

test('public text always advertises Vary', async () => {
  const small = await encodePublicText(req('gzip'), 'short');
  assert.equal(small.headers.Vary, 'Accept-Encoding');
  assert.equal(small.headers['Content-Encoding'], undefined);
  assert.equal(small.body.toString('utf8'), 'short');
});

test('large compressible text is gzipped and round-trips', async () => {
  const text = 'synthetic-public-payload '.repeat(100);
  const result = await encodePublicText(req('gzip'), text);
  assert.equal(result.headers['Content-Encoding'], 'gzip');
  assert.equal(result.headers.Vary, 'Accept-Encoding');
  assert.ok(result.body.length < Buffer.byteLength(text));
  assert.equal(gunzipSync(result.body).toString('utf8'), text);
});

test('incompressible content is returned as-is with no encoding header', async () => {
  const random = randomBytes(4096);
  const result = await encodePublicText(req('gzip'), random);
  assert.equal(result.headers['Content-Encoding'], undefined);
  assert.ok(result.body.equals(random));
});

test('buffer input is handled like string input', async () => {
  const text = 'x'.repeat(2048);
  const result = await encodePublicText(req('gzip'), Buffer.from(text));
  assert.equal(result.headers['Content-Encoding'], 'gzip');
  assert.equal(gunzipSync(result.body).toString('utf8'), text);
});
