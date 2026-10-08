import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { readPagedRows } from '../lib/http/paged-rows.js';

const source = (
  await readFile(new URL('../server.js', import.meta.url), 'utf8')
).replace(/\r\n/g, '\n');

const marker = "if (req.method === 'GET' && url.pathname === '/api/rows')";
const start = source.indexOf(marker);
const end = source.indexOf(
  "if (url.pathname === '/api/rows' && req.method === 'POST')",
  start,
);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);

function fixture(count) {
  const rows = Array.from({ length: count }, (_, index) => ({
    _id: `synthetic-${index}`,
  }));
  const calls = [];
  const box = {
    readPagedRows,
    tableFrom: () => 'synthetic-table',
    client: {
      async listRows(table, view, order, convert, offset, limit) {
        calls.push({ offset, limit });
        return rows.slice(offset, offset + limit);
      },
    },
    json: (res, status, payload) => ({
      status,
      payload: JSON.parse(JSON.stringify(payload)),
    }),
  };

  vm.createContext(box);
  vm.runInContext(
    `globalThis.load = async function(req, res, url) {
      ${block}
    };`,
    box,
  );

  return {
    box,
    calls,
    load: () => box.load(
      { method: 'GET' },
      {},
      { pathname: '/api/rows' },
    ),
  };
}

test('empty table previews include explicit completeness metadata', async () => {
  const f = fixture(0);
  const result = await f.load();

  assert.equal(result.status, 200);
  assert.equal(result.payload.previewOnly, true);
  assert.equal(result.payload.rows.length, 0);
  assert.equal(result.payload.readMeta.total, 0);
  assert.equal(result.payload.readMeta.truncated, false);
});

test('exactly 100 rows remain complete after an empty probe', async () => {
  const f = fixture(100);
  const result = await f.load();

  assert.equal(result.payload.rows.length, 100);
  assert.equal(result.payload.readMeta.truncated, false);
  assert.deepEqual(f.calls, [
    { offset: 0, limit: 100 },
    { offset: 100, limit: 1 },
  ]);
});

test('larger tables return only 100 rows and mark the preview truncated', async () => {
  const f = fixture(101);
  const result = await f.load();

  assert.equal(result.payload.previewOnly, true);
  assert.equal(result.payload.rows.length, 100);
  assert.equal(result.payload.readMeta.total, 100);
  assert.equal(result.payload.readMeta.maxRows, 100);
  assert.equal(result.payload.readMeta.truncated, true);
});

test('upstream truncation is preserved even for a short preview', async () => {
  const f = fixture(0);
  f.box.client.listRows = async () => {
    const rows = [{ _id: 'synthetic-row' }];
    Object.defineProperty(rows, 'readMeta', {
      value: { truncated: true },
    });
    return rows;
  };

  const result = await f.load();
  assert.equal(result.payload.rows.length, 1);
  assert.equal(result.payload.readMeta.truncated, true);
});

test('malformed preview responses are rejected', async () => {
  const f = fixture(0);
  f.box.client.listRows = async () => ({ rows: [] });

  await assert.rejects(
    f.load(),
    { code: 'paged_read_unavailable', statusCode: 503 },
  );
});

test('preview transport errors cannot become an empty successful response', async () => {
  const f = fixture(0);
  f.box.client.listRows = async () => {
    throw new Error('synthetic-private-upstream-detail');
  };

  await assert.rejects(
    f.load(),
    error => error.code === 'paged_read_unavailable'
      && !error.message.includes('synthetic-private-upstream-detail'),
  );
});