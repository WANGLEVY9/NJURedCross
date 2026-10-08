import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJsonObject } from '../lib/http/json-body.js';

function request(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(value, 'utf8');

  return Readable.from([bytes]);
}

function invalidJson(error) {
  return error.statusCode === 400
    && error.code === 'invalid_json_body';
}

test('valid JSON objects preserve their fields', async () => {
  assert.deepEqual(
    await readJsonObject(request('{"name":"合成测试","enabled":true}')),
    { name: '合成测试', enabled: true },
  );
});

test('empty request bodies remain compatible', async () => {
  assert.deepEqual(await readJsonObject(request('')), {});
});

test('null and non-object JSON values are rejected', async () => {
  for (const value of ['null', '[]', '[{}]', '"text"', '123', 'true']) {
    await assert.rejects(readJsonObject(request(value)), invalidJson);
  }
});

test('malformed JSON is rejected without exposing its contents', async () => {
  await assert.rejects(
    readJsonObject(request('{"private-token":"synthetic-secret"')),
    error => {
      assert.equal(error.message.includes('synthetic-secret'), false);
      return invalidJson(error);
    },
  );
});

test('invalid UTF-8 cannot silently become replacement characters', async () => {
  const bytes = Buffer.concat([
    Buffer.from('{"name":"'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('"}'),
  ]);

  await assert.rejects(readJsonObject(request(bytes)), invalidJson);
});

test('a JSON object at exactly 64KB is accepted', async () => {
  const overhead = Buffer.byteLength('{"value":""}');
  const text = JSON.stringify({
    value: 'x'.repeat(64 * 1024 - overhead),
  });

  assert.equal(Buffer.byteLength(text), 64 * 1024);
  assert.equal(
    (await readJsonObject(request(text))).value.length,
    64 * 1024 - overhead,
  );
});

test('JSON larger than 64KB is rejected with 413', async () => {
  const text = JSON.stringify({ value: 'x'.repeat(64 * 1024) });

  await assert.rejects(
    readJsonObject(request(text)),
    error => error.statusCode === 413,
  );
});

test('invalid input prevents subsequent business writes', async () => {
  let writes = 0;

  async function handle(req) {
    const body = await readJsonObject(req);
    writes++;
    return body;
  }

  await assert.rejects(handle(request('null')), invalidJson);
  await assert.rejects(handle(request('{')), invalidJson);
  assert.equal(writes, 0);
});

test('multibyte UTF-8 counts toward the byte limit', async () => {
  const text = JSON.stringify({ value: '中'.repeat(22 * 1024) });

  assert.ok(text.length < 64 * 1024);
  assert.ok(Buffer.byteLength(text) > 64 * 1024);

  await assert.rejects(
    readJsonObject(request(text)),
    error => error.statusCode === 413,
  );
});