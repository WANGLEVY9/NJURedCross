import test from 'node:test';
import assert from 'node:assert/strict';
import { updateRows, deleteRows } from '../lib/http/batch-write.js';

function fakeClient(overrides = {}) {
  const calls = [];
  const client = {
    calls,
    async updateRow(table, rowId, fields) {
      calls.push(['updateRow', table, rowId, fields]);
    },
    async deleteRow(table, rowId) {
      calls.push(['deleteRow', table, rowId]);
    },
    async batchUpdateRows(table, rows) {
      calls.push(['batchUpdateRows', table, rows]);
    },
    async batchDeleteRows(table, ids) {
      calls.push(['batchDeleteRows', table, ids]);
    },
    ...overrides,
  };
  return client;
}

test('an empty update list touches nothing', async () => {
  const client = fakeClient();
  await updateRows(client, '投稿附件表', []);
  assert.equal(client.calls.length, 0);
});

test('a single update keeps the single-row call', async () => {
  const client = fakeClient();
  await updateRows(client, '投稿附件表', [{ rowId: 'r1', fields: { 投稿ID: 'S1' } }]);
  assert.deepEqual(client.calls, [['updateRow', '投稿附件表', 'r1', { 投稿ID: 'S1' }]]);
});

test('several updates collapse into one round trip', async () => {
  const client = fakeClient();
  await updateRows(client, '投稿附件表', [
    { rowId: 'r1', fields: { 投稿ID: 'S1' } },
    { rowId: 'r2', fields: { 投稿ID: 'S1' } },
    { rowId: 'r3', fields: { 投稿ID: 'S1' } },
  ]);
  assert.equal(client.calls.length, 1, 'three rows must cost one call');
  const [method, table, rows] = client.calls[0];
  assert.equal(method, 'batchUpdateRows');
  assert.equal(table, '投稿附件表');
  assert.deepEqual(rows, [
    { row_id: 'r1', 投稿ID: 'S1' },
    { row_id: 'r2', 投稿ID: 'S1' },
    { row_id: 'r3', 投稿ID: 'S1' },
  ]);
});

test('deletes collapse the same way', async () => {
  const client = fakeClient();
  await deleteRows(client, '锁表', ['a', 'b']);
  assert.deepEqual(client.calls, [['batchDeleteRows', '锁表', ['a', 'b']]]);
});

test('a client without batch support falls back to one call per row', async () => {
  const client = fakeClient({ batchUpdateRows: undefined, batchDeleteRows: undefined });
  await updateRows(client, '投稿附件表', [
    { rowId: 'r1', fields: { 投稿ID: 'S1' } },
    { rowId: 'r2', fields: { 投稿ID: 'S1' } },
  ]);
  await deleteRows(client, '锁表', ['a', 'b']);
  assert.deepEqual(client.calls.map((c) => c[0]), ['updateRow', 'updateRow', 'deleteRow', 'deleteRow']);
});

test('failures are not swallowed', async () => {
  const client = fakeClient({
    async batchUpdateRows() {
      throw Object.assign(new Error('upstream failed'), { statusCode: 502 });
    },
  });
  await assert.rejects(
    () => updateRows(client, '投稿附件表', [
      { rowId: 'r1', fields: {} },
      { rowId: 'r2', fields: {} },
    ]),
    /upstream failed/,
  );
});

test('large batches are chunked below the upstream limit', async () => {
  const client = fakeClient();
  const updates = Array.from({ length: 450 }, (_, i) => ({ rowId: `r${i}`, fields: { 投稿ID: 'S1' } }));
  await updateRows(client, '投稿附件表', updates);
  assert.equal(client.calls.length, 3, '450 rows split into three batches');
  const total = client.calls.reduce((sum, [, , rows]) => sum + rows.length, 0);
  assert.equal(total, 450);
  for (const [, , rows] of client.calls) assert.ok(rows.length <= 200);
});
