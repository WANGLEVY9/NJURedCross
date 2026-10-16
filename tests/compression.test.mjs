import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { acceptsGzip, encodePublicText, preferredEncoding } from '../lib/http/compression.js';

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

test('brotli is preferred when the client offers it', () => {
  assert.equal(preferredEncoding(req('br')), 'br');
  assert.equal(preferredEncoding(req('br, gzip')), 'br');
  assert.equal(preferredEncoding(req('gzip, deflate, br')), 'br');
  assert.equal(preferredEncoding(req('br;q=1.0, gzip;q=0.8')), 'br');
  // A lower-quality brotli offer loses to an explicit higher-quality gzip.
  assert.equal(preferredEncoding(req('br;q=0.5, gzip;q=1')), 'gzip');
  assert.equal(preferredEncoding(req('br;q=0')), 'identity');
  assert.equal(preferredEncoding(req('deflate')), 'identity');
  assert.equal(preferredEncoding(req('')), 'identity');
});

test('brotli beats gzip on size and round-trips', async () => {
  const text = 'synthetic-public-payload 中文负载 '.repeat(100);
  const brotli = await encodePublicText(req('br, gzip'), text);
  const gzip = await encodePublicText(req('gzip'), text);
  assert.equal(brotli.headers['Content-Encoding'], 'br');
  assert.equal(brotli.headers.Vary, 'Accept-Encoding');
  assert.equal(brotliDecompressSync(brotli.body).toString('utf8'), text);
  assert.equal(gzip.headers['Content-Encoding'], 'gzip');
  assert.ok(brotli.body.length < gzip.body.length, 'brotli must not be larger than gzip');
});

test('gzip remains the fallback when brotli is refused', async () => {
  const text = 'fallback-payload '.repeat(200);
  const result = await encodePublicText(req('br;q=0, gzip'), text);
  assert.equal(result.headers['Content-Encoding'], 'gzip');
  assert.equal(gunzipSync(result.body).toString('utf8'), text);
});
