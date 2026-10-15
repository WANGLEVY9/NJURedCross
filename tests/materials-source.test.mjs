import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createMaterialsSourceReader, MATERIAL_TEST_BASE } from '../lib/materials/source-reader.js';
import { createMaterialsSourceServer } from '../scripts/preview-materials-source.mjs';

function fakeReader(replies, calls = []) {
  return createMaterialsSourceReader({ server: 'https://table.nju.edu.cn', token: 'private-test-credential',
    fetcher: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify(replies.shift()), { headers: { 'content-type': 'application/json' } });
    } });
}
const auth = { dtable_uuid: MATERIAL_TEST_BASE, access_token: 'private-access-credential', use_api_gateway: true };

test('source reader verifies Base before accessing tables and forbids unrelated tables', async () => {
  const calls = [];
  const reader = fakeReader([{ ...auth, dtable_uuid: 'other-base' }], calls);
  await assert.rejects(reader.metadata(), { code: 'base_mismatch' });
  assert.equal(calls.length, 1);
  await assert.rejects(reader.rows('敏感信息'), { code: 'table_forbidden' });
  assert.equal(calls.length, 1);
});

test('source reader reads only GET requests, filters metadata, pages rows and keeps credentials private', async () => {
  const calls = [];
  const reader = fakeReader([auth, { metadata: { tables: [{ name: '工位物资表', columns: [{ name: '物资名称' }] },
    { name: '无关表', columns: [] }] } }, { rows: [{ 物资名称: '示例' }] }], calls);
  const tables = await reader.metadata();
  assert.equal(tables.length, 4); assert.equal(tables[0].exists, true); assert.equal(tables[1].exists, false);
  const data = await reader.rows('工位物资表', 100);
  assert.equal(data.rows[0].物资名称, '示例');
  assert.ok(calls.every(call => call.options.method === 'GET'));
  assert.equal(calls.length, 3, 'authentication is reused');
  const url = new URL(calls[2].url);
  assert.equal(url.searchParams.get('start'), '100'); assert.equal(url.searchParams.get('limit'), '100');
  assert.equal(url.searchParams.get('convert_keys'), 'true');
  assert.doesNotMatch(JSON.stringify({ tables, data }), /private-.*credential/);
  await assert.rejects(reader.rows('工位物资表', -1), { code: 'invalid_page' });
});

test('untrusted upstream endpoint is rejected before credentials are sent to it', async () => {
  const calls = [];
  const reader = fakeReader([{ ...auth, use_api_gateway: false, dtable_server: 'https://other.example/' }], calls);
  await assert.rejects(reader.metadata(), { code: 'invalid_endpoint' });
  assert.equal(calls.length, 1);
});

test('upstream 500 is reported without forwarding HTML or credentials', async () => {
  const reader = createMaterialsSourceReader({ server: 'https://table.nju.edu.cn', token: 'private-test-credential',
    fetcher: async () => new Response('<html>private-test-credential</html>', { status: 500 }) });
  await assert.rejects(reader.metadata(), error => error.code === 'upstream_failed'
    && error.phase === 'authentication' && error.upstreamStatus === 500 && !error.message.includes('credential'));
});

test('local server forbids writes and external hosts and never forwards unexpected error details', async t => {
  let reads = 0;
  const server = createMaterialsSourceServer({ metadata: async () => { reads++; throw new Error('private-test-credential'); } });
  assert.throws(() => server.listen(0, '0.0.0.0'), /127\.0\.0\.1/);
  server.listen(0); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const result = await fetch(`${origin}/api/materials-source/rows`, { method });
    assert.equal(result.status, 405);
  }
  assert.equal(reads, 0);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(`${origin}/api/materials-source/schema`, { headers: { Host: 'other.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(`${origin}/api/materials-source/schema`, { headers: { Origin: 'https://other.example' } })).status, 403);
  const result = await fetch(`${origin}/api/materials-source/schema`);
  assert.equal(result.status, 502); assert.doesNotMatch(await result.text(), /private-test-credential/);
  assert.equal((await fetch(`${origin}/.env.materials-local`)).status, 404);
});
