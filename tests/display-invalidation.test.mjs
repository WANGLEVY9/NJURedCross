import test from 'node:test';
import assert from 'node:assert/strict';
import { withDisplayReads, displayRead, clearDisplayReads, invalidateDisplayReads } from '../lib/http/display-reads.js';
import { createWriteJournal, withWriteJournal, writtenTables, trackClient } from '../lib/cache/write-tracker.js';

test('a write only drops the projections that depend on the written table', async () => {
  clearDisplayReads();
  const base = {};
  const read = (table, value) => withDisplayReads(() => displayRead(
    base,
    `rows:${table}`,
    async () => value,
    5_000,
    [table],
  ));

  assert.equal(await read('网站活动流程表', 'events-v1'), 'events-v1');
  assert.equal(await read('网站服务时长明细表', 'ledger-v1'), 'ledger-v1');

  invalidateDisplayReads(['网站活动流程表']);

  assert.equal(await read('网站活动流程表', 'events-v2'), 'events-v2');
  assert.equal(await read('网站服务时长明细表', 'ledger-v2'), 'ledger-v1');
});

test('writes recorded outside a request journal are ignored', () => {
  const journal = createWriteJournal();
  const client = trackClient({ updateRow: async () => ({ _id: 'x' }) });

  return withWriteJournal(journal, async () => {
    await client.updateRow('网站活动报名总表', 'row', { 状态: '已确认' });
    assert.deepEqual(writtenTables(journal), ['网站活动报名总表']);
  });
});

test('tracked writes never change the SDK return value and drop duplicates', async () => {
  const calls = [];
  const client = trackClient({
    appendRow: async (table, row) => { calls.push([table, row]); return { _id: 'new' }; },
    listRows: async () => ['rows'],
  });
  const journal = createWriteJournal();

  await withWriteJournal(journal, async () => {
    assert.deepEqual(await client.appendRow('网站活动签到表', { a: 1 }), { _id: 'new' });
    await client.appendRow('网站活动签到表', { a: 2 });
    assert.deepEqual(await client.listRows('网站活动签到表'), ['rows']);
  });

  assert.deepEqual(calls, [['网站活动签到表', { a: 1 }], ['网站活动签到表', { a: 2 }]]);
  assert.deepEqual(writtenTables(journal), ['网站活动签到表']);
});

test('write tracking keeps the original this binding and records nothing outside a journal', async () => {
  let received = null;
  const target = {
    updateRow(table, id, patch) {
      received = { self: this, table, id, patch };
      return Promise.resolve({ ok: true });
    },
  };
  const client = trackClient(target);

  assert.deepEqual(await client.updateRow('表', 'id', { a: 1 }), { ok: true });
  assert.equal(received.self, target);
  assert.equal(received.table, '表');
  assert.equal(writtenTables(undefined).length, 0);
});
