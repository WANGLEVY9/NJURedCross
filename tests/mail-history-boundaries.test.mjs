import test from 'node:test';
import assert from 'node:assert/strict';
import { hasDeliveredMail } from '../lib/mail/delivery-history.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

function unrelated(id) {
  return { _id: id, 幂等键: 'unrelated', 状态: '已发送' };
}

function unavailable(error) {
  return error.code === 'mail_history_unavailable';
}

test('oversized pages cannot provide authoritative delivery evidence', async () => {
  await assert.rejects(
    hasDeliveredMail({
      listRows: async () => [
        { _id: 'one', 幂等键: 'target', 状态: '已发送' },
        unrelated('two'),
        unrelated('three'),
      ],
    }, 'target', { pageSize: 2 }),
    unavailable,
  );
});

test('array-shaped records cannot authorize a resend decision', async () => {
  await assert.rejects(
    hasDeliveredMail({ listRows: async () => [[]] }, 'target'),
    unavailable,
  );
});

test('repeated IDs within a page reject even a matching sent record', async () => {
  await assert.rejects(
    hasDeliveredMail({
      listRows: async () => [
        { _id: 'same', 幂等键: 'target', 状态: '已发送' },
        unrelated('same'),
      ],
    }, 'target'),
    unavailable,
  );
});

test('repeated IDs across pages cannot become a false negative', async () => {
  const offsets = [];

  await assert.rejects(
    hasDeliveredMail({
      async listRows(_table, _view, _order, _direction, offset) {
        offsets.push(offset);
        return offset === 0
          ? [unrelated('one'), unrelated('two')]
          : [unrelated('one')];
      },
    }, 'target', { pageSize: 2 }),
    unavailable,
  );

  assert.deepEqual(offsets, [0, 2]);
});

test('exactly reaching the cap is complete after an empty probe', async () => {
  const rows = [unrelated('one'), unrelated('two')];
  const reads = [];

  const result = await hasDeliveredMail({
    async listRows(_table, _view, _order, _direction, offset, limit) {
      reads.push({ offset, limit });
      return rows.slice(offset, offset + limit);
    },
  }, 'target', { pageSize: 2, maxRows: 2 });

  assert.equal(result, false);
  assert.deepEqual(reads, [
    { offset: 0, limit: 2 },
    { offset: 2, limit: 1 },
  ]);
});

test('a one-row overflow probe cannot authorize sending', async () => {
  const rows = [unrelated('one'), unrelated('two'), unrelated('three')];
  const reads = [];

  await assert.rejects(
    hasDeliveredMail({
      async listRows(_table, _view, _order, _direction, offset, limit) {
        reads.push({ offset, limit });
        return rows.slice(offset, offset + limit);
      },
    }, 'target', { pageSize: 2, maxRows: 2 }),
    unavailable,
  );

  assert.deepEqual(reads, [
    { offset: 0, limit: 2 },
    { offset: 2, limit: 1 },
  ]);
});

test('invalid supplied row IDs stop history inspection', async () => {
  for (const id of ['', '   ', null, 123]) {
    await assert.rejects(
      hasDeliveredMail({
        listRows: async () => [{ ...unrelated('synthetic'), _id: id }],
      }, 'target'),
      unavailable,
    );
  }
});

test('cancellation after a page prevents further reads', async () => {
  const controller = new AbortController();
  let reads = 0;

  await assert.rejects(
    withRequestBudget(
      () => hasDeliveredMail({
        async listRows() {
          reads++;
          controller.abort();
          return [unrelated('one'), unrelated('two')];
        },
      }, 'target', { pageSize: 2 }),
      { signal: controller.signal },
    ),
    error => error.code === 'external_request_cancelled',
  );

  assert.equal(reads, 1);
});

test('already cancelled requests never inspect history', async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;

  await assert.rejects(
    withRequestBudget(
      () => hasDeliveredMail({
        async listRows() {
          reads++;
          return [];
        },
      }, 'target'),
      { signal: controller.signal },
    ),
    error => error.code === 'external_request_cancelled',
  );

  assert.equal(reads, 0);
});

test('invalid bounds and expected intents fail before reading', async () => {
  let reads = 0;
  const client = {
    async listRows() {
      reads++;
      return [];
    },
  };

  for (const options of [
    { pageSize: 1001 },
    { maxRows: 100001 },
    { expectedIntent: null },
    { expectedIntent: {} },
    { expectedIntent: { to: 'member@example.test', subject: 123, kind: 'test' } },
  ]) {
    await assert.rejects(
      hasDeliveredMail(client, 'target', options),
      TypeError,
    );
  }

  assert.equal(reads, 0);
});