import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAuditReconciliationStore } from '../lib/audit/reconciliation-store.js';

const options = {
  secret: 'synthetic-audit-secret-at-least-32-characters',
  baseUuid: '00000000-0000-4000-8000-000000000001',
};

function row(id = 'AUD-synthetic-001') {
  return {
    审计ID: id,
    时间: '2026-01-01T00:00:00.000Z',
    操作人: 'synthetic-private-actor',
    角色: 'platform_admin',
    动作: 'materials.synthetic',
    对象: 'synthetic-private-target',
    结果: 'success',
    IP: 'synthetic-private-address',
    备注: '{"quantity":2}',
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'audit-store-'));
  const file = join(directory, 'receipts.sqlite');
  const stores = new Set();

  t.after(async () => {
    for (const store of stores) store.close();
    await rm(directory, { recursive: true, force: true });
  });

  return {
    file,
    async open(overrides = {}) {
      const store = await openAuditReconciliationStore(file, {
        ...options,
        ...overrides,
      });
      stores.add(store);
      return store;
    },
    close(store) {
      store.close();
      stores.delete(store);
    },
  };
}

test('prepared records recover their complete encrypted audit fields', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const input = row();

  const saved = store.prepare(input);

  assert.equal(saved.state, 'prepared');
  assert.deepEqual(saved.row, input);
  assert.deepEqual(store.get(input['审计ID']).row, input);
});

test('unconfirmed state survives closing and reopening', async t => {
  const f = await fixture(t);
  const first = await f.open();
  const input = row();

  first.prepare(input);
  first.transition(input['审计ID'], 'attempted');
  first.transition(input['审计ID'], 'unconfirmed');
  f.close(first);

  const reopened = await f.open();

  assert.equal(reopened.get(input['审计ID']).state, 'unconfirmed');
  assert.deepEqual(reopened.get(input['审计ID']).row, input);
});

test('an existing audit ID cannot be reused for different content', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const input = row();

  const saved = store.prepare(input);
  assert.equal(store.prepare(input).fingerprint, saved.fingerprint);

  assert.throws(
    () => store.prepare({ ...input, 对象: 'synthetic-other-target' }),
    { code: 'audit_reconciliation_conflict' },
  );
  assert.deepEqual(store.get(input['审计ID']).row, input);
});

test('invalid transitions cannot roll state backwards', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const id = row()['审计ID'];
  store.prepare(row());

  assert.throws(
    () => store.transition(id, 'confirmed'),
    { code: 'audit_reconciliation_conflict' },
  );

  store.transition(id, 'attempted');
  store.transition(id, 'confirmed');

  for (const next of ['prepared', 'attempted', 'unconfirmed', 'invalid']) {
    assert.throws(
      () => store.transition(id, next),
      { code: 'audit_reconciliation_conflict' },
    );
  }
  assert.equal(store.transition(id, 'confirmed').state, 'confirmed');
  assert.throws(
    () => store.transition('AUD-missing', 'attempted'),
    { code: 'audit_reconciliation_conflict' },
  );
});

test('two connections share the same immutable audit ID and current state', async t => {
  const f = await fixture(t);
  const first = await f.open();
  const second = await f.open();
  const input = row();

  first.prepare(input);
  second.prepare(input);
  first.transition(input['审计ID'], 'attempted');

  assert.equal(second.get(input['审计ID']).state, 'attempted');
  second.transition(input['审计ID'], 'unconfirmed');
  assert.equal(first.get(input['审计ID']).state, 'unconfirmed');

  assert.throws(
    () => first.transition(input['审计ID'], 'attempted'),
    { code: 'audit_reconciliation_conflict' },
  );
});

test('a different Base or encryption secret cannot open the store', async t => {
  const f = await fixture(t);
  const store = await f.open();
  store.prepare(row());
  f.close(store);

  await assert.rejects(
    f.open({ baseUuid: '00000000-0000-4000-8000-000000000002' }),
    { code: 'audit_reconciliation_conflict' },
  );
  await assert.rejects(
    f.open({ secret: 'another-synthetic-secret-at-least-32-characters' }),
    { code: 'audit_reconciliation_conflict' },
  );
});

test('closed database bytes do not contain plaintext audit identity fields', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const input = row();
  store.prepare(input);
  f.close(store);

  const bytes = await readFile(f.file);
  for (const field of ['操作人', '对象', 'IP', '备注']) {
    assert.equal(bytes.includes(Buffer.from(input[field], 'utf8')), false);
  }
});

test('summary exposes state counts without audit event contents', async t => {
  const f = await fixture(t);
  const store = await f.open();
  store.prepare(row('AUD-first'));
  store.prepare(row('AUD-second'));
  store.transition('AUD-second', 'attempted');

  assert.deepEqual(store.summary(), {
    prepared: 1,
    attempted: 1,
    unconfirmed: 0,
    confirmed: 0,
  });
  assert.equal(
    JSON.stringify(store.summary()).includes('synthetic-private'),
    false,
  );
});

test('attention listing paginates and excludes confirmed receipts', async t => {
  const f = await fixture(t);
  const store = await f.open();

  for (const id of ['AUD-003', 'AUD-001', 'AUD-002', 'AUD-004']) {
    store.prepare(row(id));
  }

  store.transition('AUD-002', 'attempted');
  store.transition('AUD-002', 'confirmed');
  store.transition('AUD-003', 'attempted');
  store.transition('AUD-003', 'unconfirmed');

  const first = store.listAttention({ limit: 2 });
  assert.deepEqual(
    first.items.map(item => item.auditId),
    ['AUD-001', 'AUD-003'],
  );
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, 'AUD-003');
  assert.equal(first.items[1].state, 'unconfirmed');
  assert.deepEqual(
    Object.keys(first.items[0]).sort(),
    ['auditId', 'state', 'updatedAt'],
  );
  assert.equal(JSON.stringify(first).includes('synthetic-private'), false);

  const second = store.listAttention({
    limit: 2,
    after: first.nextCursor,
  });
  assert.deepEqual(second.items.map(item => item.auditId), ['AUD-004']);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
});

test('attention listing rejects invalid pagination', async t => {
  const f = await fixture(t);
  const store = await f.open();

  for (const limit of [0, -1, 101, 1.5, '20']) {
    assert.throws(() => store.listAttention({ limit }));
  }

  assert.throws(() => store.listAttention({ after: null }));
  assert.throws(() => store.listAttention({ after: 'x'.repeat(201) }));
});