import test from 'node:test';
import assert from 'node:assert/strict';
import { listIdentityRows } from '../lib/identity/store.js';

function fixture(count) {
  const rows = Array.from({ length: count }, (_, index) => ({
    _id: `synthetic-${index}`,
  }));
  const calls = [];
  const client = {
    async listRows(table, view, order, convert, start, limit) {
      calls.push({ table, start, limit });
      return rows.slice(start, start + limit);
    },
  };
  return { client, calls };
}

test('identity reads include records beyond the first page', async () => {
  const f = fixture(201);
  const rows = await listIdentityRows(f.client, 'synthetic-identity');

  assert.equal(rows.length, 201);
  assert.equal(rows[200]._id, 'synthetic-200');
  assert.deepEqual(f.calls.map(call => call.start), [0, 100, 200]);
});

test('successful empty identity reads return an empty array', async () => {
  const f = fixture(0);
  const rows = await listIdentityRows(f.client, 'synthetic-identity');

  assert.equal(rows.length, 0);
  assert.equal(rows.readMeta.truncated, false);
});

test('upstream truncation cannot authorize an identity decision', async () => {
  const client = {
    async listRows() {
      const rows = [{ _id: 'synthetic-account' }];
      Object.defineProperty(rows, 'readMeta', {
        value: { truncated: true },
      });
      return rows;
    },
  };

  await assert.rejects(
    listIdentityRows(client, 'synthetic-identity'),
    { code: 'incomplete_operational_data', statusCode: 503 },
  );
});

test('repeated identity row IDs across pages are rejected', async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({
    _id: `synthetic-${index}`,
  }));
  const client = {
    async listRows(table, view, order, convert, start) {
      return start === 0 ? first : [{ _id: 'synthetic-0' }];
    },
  };

  await assert.rejects(
    listIdentityRows(client, 'synthetic-identity'),
    { code: 'paged_read_unavailable', statusCode: 503 },
  );
});

test('malformed identity responses are rejected', async () => {
  for (const value of [null, {}, [null]]) {
    const client = { listRows: async () => value };

    await assert.rejects(
      listIdentityRows(client, 'synthetic-identity'),
      { code: 'paged_read_unavailable', statusCode: 503 },
    );
  }
});

test('identity transport errors do not expose upstream details', async () => {
  const client = {
    async listRows() {
      throw new Error('synthetic-private-upstream-detail');
    },
  };

  await assert.rejects(
    listIdentityRows(client, 'synthetic-identity'),
    error => error.code === 'paged_read_unavailable'
      && error.statusCode === 503
      && !error.message.includes('synthetic-private-upstream-detail'),
  );
});

test('exactly reaching the identity cap is complete after an empty probe', async () => {
  const f = fixture(100000);
  const rows = await listIdentityRows(f.client, 'synthetic-identity');

  assert.equal(rows.length, 100000);
  assert.equal(rows.readMeta.truncated, false);
  assert.deepEqual(f.calls.at(-1), {
    table: 'synthetic-identity',
    start: 100000,
    limit: 1,
  });
});

test('identity overflow is rejected after the extra-row probe', async () => {
  const f = fixture(100001);

  await assert.rejects(
    listIdentityRows(f.client, 'synthetic-identity'),
    { code: 'incomplete_operational_data', statusCode: 503 },
  );
  assert.deepEqual(f.calls.at(-1), {
    table: 'synthetic-identity',
    start: 100000,
    limit: 1,
  });
});