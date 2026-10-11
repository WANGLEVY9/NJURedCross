import test from 'node:test';
import assert from 'node:assert/strict';
import { readPagedRows } from '../lib/http/paged-rows.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

function fixture(count) {
  const rows = Array.from({ length: count }, (_, index) => ({
    _id: `synthetic-${index}`,
  }));
  const calls = [];

  return {
    rows,
    calls,
    client: {
      listRows: async (_table, _view, _order, _direction, start, limit) => {
        calls.push({ start, limit });
        return rows.slice(start, start + limit);
      },
    },
  };
}

const unavailable = error => (
  error.code === 'paged_read_unavailable'
  && error.statusCode === 503
);

test('pagination reads all pages and preserves array metadata', async () => {
  const f = fixture(5);
  const rows = await readPagedRows(f.client, 'synthetic', {
    pageSize: 2,
    maxRows: 10,
  });

  assert.deepEqual(rows, f.rows);
  assert.deepEqual(rows.readMeta, {
    total: 5,
    truncated: false,
    maxRows: 10,
  });
  assert.deepEqual(f.calls, [
    { start: 0, limit: 2 },
    { start: 2, limit: 2 },
    { start: 4, limit: 2 },
  ]);
  assert.ok(!JSON.stringify(rows).includes('readMeta'));
});

test('exactly reaching the cap is complete after an empty probe', async () => {
  const f = fixture(5);
  const rows = await readPagedRows(f.client, 'synthetic', {
    pageSize: 2,
    maxRows: 5,
    requireComplete: true,
  });

  assert.equal(rows.length, 5);
  assert.equal(rows.readMeta.truncated, false);
  assert.deepEqual(f.calls.at(-1), { start: 5, limit: 1 });
});

test('overflow is marked and complete-only reads are rejected', async () => {
  const f = fixture(6);
  const rows = await readPagedRows(f.client, 'synthetic', {
    pageSize: 2,
    maxRows: 5,
  });

  assert.equal(rows.length, 5);
  assert.equal(rows.readMeta.truncated, true);

  await assert.rejects(
    readPagedRows(f.client, 'synthetic', {
      pageSize: 2,
      maxRows: 5,
      requireComplete: true,
    }),
    error => (
      error.code === 'incomplete_operational_data'
      && error.statusCode === 503
    ),
  );
});

test('explicit upstream truncation cannot be treated as a complete page', async () => {
  const batch = [{ _id: 'synthetic' }];
  Object.defineProperty(batch, 'readMeta', {
    value: { truncated: true },
  });

  const client = { listRows: async () => batch };

  const rows = await readPagedRows(client, 'synthetic');
  assert.equal(rows.readMeta.truncated, true);

  await assert.rejects(
    readPagedRows(client, 'synthetic', { requireComplete: true }),
    error => error.code === 'incomplete_operational_data',
  );
});

test('malformed and oversized pages fail safely', async () => {
  for (const batch of [
    null,
    {},
    [null],
    [[]],
    [{ _id: '' }],
    [{ _id: 123 }],
    [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }],
  ]) {
    await assert.rejects(
      readPagedRows({ listRows: async () => batch }, 'synthetic', {
        pageSize: 2,
      }),
      unavailable,
    );
  }
});

test('repeated row identifiers across pages stop the read', async () => {
  let calls = 0;

  const client = {
    listRows: async () => {
      calls++;
      return calls === 1
        ? [{ _id: 'a' }, { _id: 'b' }]
        : [{ _id: 'a' }];
    },
  };

  await assert.rejects(
    readPagedRows(client, 'synthetic', { pageSize: 2 }),
    unavailable,
  );
});

test('transport failures do not expose raw upstream details', async () => {
  await assert.rejects(
    readPagedRows({
      listRows: async () => {
        throw new Error('synthetic-private-token');
      },
    }, 'synthetic'),
    error => (
      unavailable(error)
      && !error.message.includes('synthetic-private')
    ),
  );
});

test('invalid limits are rejected before reading', async () => {
  const f = fixture(0);

  for (const options of [
    { pageSize: 0 },
    { pageSize: 1001 },
    { pageSize: 0.5 },
    { maxRows: 0 },
    { maxRows: 100001 },
    { maxRows: NaN },
    { requireComplete: 'yes' },
  ]) {
    await assert.rejects(
      readPagedRows(f.client, 'synthetic', options),
      TypeError,
    );
  }

  assert.equal(f.calls.length, 0);
});

test('already cancelled requests never start a page read', async () => {
  const f = fixture(1);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    withRequestBudget(
      () => readPagedRows(f.client, 'synthetic'),
      { signal: controller.signal },
    ),
    error => error.code === 'external_request_cancelled',
  );

  assert.equal(f.calls.length, 0);
});