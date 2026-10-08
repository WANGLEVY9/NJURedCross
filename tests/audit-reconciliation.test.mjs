import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAuditReconciliationStore } from '../lib/audit/reconciliation-store.js';
import {
  persistAuditRecord,
  reconcileAuditRecord,
} from '../lib/audit/reconciliation.js';

const options = {
  secret: 'synthetic-audit-secret-at-least-32-characters',
  baseUuid: '00000000-0000-4000-8000-000000000001',
};

function row() {
  return {
    审计ID: 'AUD-synthetic-001',
    时间: '2026-01-01T00:00:00.000Z',
    操作人: 'synthetic-actor',
    角色: 'platform_admin',
    动作: 'materials.synthetic',
    对象: 'synthetic-target',
    结果: 'success',
    IP: 'synthetic-address',
    备注: '{"quantity":2}',
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'audit-reconciliation-'));
  const file = join(directory, 'receipts.sqlite');
  const stores = new Set();
  const rows = [];
  let writes = 0;

  t.after(async () => {
    for (const store of stores) store.close();
    await rm(directory, { recursive: true, force: true });
  });

  const base = {
    dtableUuid: options.baseUuid,
    async appendRow(table, value) {
      assert.equal(table, '操作审计表');
      writes++;
      rows.push({ ...value, _id: `synthetic-row-${writes}` });
      return { _id: `synthetic-row-${writes}` };
    },
    async listRows(table, view, order, convert, start, limit) {
      assert.equal(table, '操作审计表');
      return rows.slice(start, start + limit);
    },
  };

  async function openStore() {
    const store = await openAuditReconciliationStore(file, options);
    stores.add(store);
    return store;
  }

  const store = await openStore();
  return {
    store,
    base,
    rows,
    openStore,
    writes: () => writes,
    close(storeToClose) {
      storeToClose.close();
      stores.delete(storeToClose);
    },
    writeArgs(storeToUse = store) {
      return {
        store: storeToUse,
        getBase: async () => base,
        baseUuid: options.baseUuid,
        row: row(),
      };
    },
    reconcileArgs(storeToUse = store) {
      return {
        store: storeToUse,
        getBase: async () => base,
        baseUuid: options.baseUuid,
        auditId: row()['审计ID'],
      };
    },
  };
}

test('a write is confirmed only after matching remote evidence is read', async t => {
  const f = await fixture(t);

  assert.deepEqual(await persistAuditRecord(f.writeArgs()), {
    confirmed: true,
  });
  assert.equal(f.store.get(row()['审计ID']).state, 'confirmed');
  assert.equal(f.writes(), 1);

  await persistAuditRecord(f.writeArgs());
  assert.equal(f.writes(), 1);
});

test('lost acknowledgement survives reopening and reconciles without replay', async t => {
  const f = await fixture(t);
  const append = f.base.appendRow;
  f.base.appendRow = async (...args) => {
    await append(...args);
    throw new Error('synthetic-response-lost');
  };

  await assert.rejects(
    persistAuditRecord(f.writeArgs()),
    { code: 'audit_write_unconfirmed' },
  );
  assert.equal(f.store.get(row()['审计ID']).state, 'unconfirmed');

  f.close(f.store);
  const reopened = await f.openStore();

  assert.deepEqual(
    await reconcileAuditRecord(f.reconcileArgs(reopened)),
    {
      state: 'confirmed',
      remoteFound: true,
      requiresManualReview: false,
    },
  );
  assert.equal(f.writes(), 1);
});

test('absence after an uncertain attempt does not authorize another append', async t => {
  const f = await fixture(t);
  f.base.appendRow = async () => {
    throw new Error('synthetic-request-failure');
  };

  await assert.rejects(
    persistAuditRecord(f.writeArgs()),
    { code: 'audit_write_unconfirmed' },
  );

  assert.deepEqual(await reconcileAuditRecord(f.reconcileArgs()), {
    state: 'unconfirmed',
    remoteFound: false,
    requiresManualReview: true,
  });

  await assert.rejects(
    persistAuditRecord(f.writeArgs()),
    { code: 'audit_write_unconfirmed' },
  );
  assert.equal(f.rows.length, 0);
});

test('store binding and authenticated Base must both match the target', async t => {
  const f = await fixture(t);
  const other = '00000000-0000-4000-8000-000000000002';
  f.base.dtableUuid = other;

  await assert.rejects(
    persistAuditRecord({ ...f.writeArgs(), baseUuid: other }),
    { code: 'audit_write_unconfirmed' },
  );
  assert.equal(f.store.get(row()['审计ID']), null);

  await assert.rejects(
    persistAuditRecord(f.writeArgs()),
    { code: 'audit_write_unconfirmed' },
  );
  assert.equal(f.store.get(row()['审计ID']).state, 'prepared');
  assert.equal(f.writes(), 0);
});

test('duplicate remote audit IDs cannot confirm a receipt', async t => {
  const f = await fixture(t);
  f.store.prepare(row());
  f.store.claimAttempt(row()['审计ID']);
  f.rows.push(
    { ...row(), _id: 'synthetic-first' },
    { ...row(), _id: 'synthetic-second' },
  );

  await assert.rejects(
    reconcileAuditRecord(f.reconcileArgs()),
    { code: 'audit_reconciliation_conflict' },
  );
  assert.equal(f.store.get(row()['审计ID']).state, 'attempted');
  assert.equal(f.writes(), 0);
});

test('conflicting remote contents cannot confirm a receipt', async t => {
  const f = await fixture(t);
  f.store.prepare(row());
  f.store.claimAttempt(row()['审计ID']);
  f.rows.push({
    ...row(),
    _id: 'synthetic-row',
    对象: 'synthetic-other-target',
  });

  await assert.rejects(
    reconcileAuditRecord(f.reconcileArgs()),
    { code: 'audit_reconciliation_conflict' },
  );
  assert.equal(f.store.get(row()['审计ID']).state, 'attempted');
});

test('two connections competing for one receipt append at most once', async t => {
  const f = await fixture(t);
  const second = await f.openStore();

  const results = await Promise.allSettled([
    persistAuditRecord(f.writeArgs()),
    persistAuditRecord(f.writeArgs(second)),
  ]);

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.writes(), 1);
  assert.equal(f.rows.length, 1);
  assert.equal(f.store.get(row()['审计ID']).state, 'confirmed');
});

test('local confirmation failure leaves a receipt available for reconciliation', async t => {
  const f = await fixture(t);
  const failure = new Error('synthetic-local-confirmation-failure');
  const store = {
    ...f.store,
    transition(id, state) {
      if (state === 'confirmed') throw failure;
      return f.store.transition(id, state);
    },
  };

  await assert.rejects(
    persistAuditRecord(f.writeArgs(store)),
    error => error === failure,
  );
  assert.equal(f.store.get(row()['审计ID']).state, 'attempted');

  const result = await reconcileAuditRecord(f.reconcileArgs());
  assert.equal(result.state, 'confirmed');
  assert.equal(f.writes(), 1);
});

test('a prepared receipt survives reopening and may start its first append', async t => {
  const f = await fixture(t);
  f.store.prepare(row());
  f.close(f.store);

  const reopened = await f.openStore();
  const result = await persistAuditRecord(f.writeArgs(reopened));

  assert.equal(result.confirmed, true);
  assert.equal(f.writes(), 1);
  assert.equal(reopened.get(row()['审计ID']).state, 'confirmed');
});

test('an interrupted attempted receipt cannot automatically replay after reopening', async t => {
  const f = await fixture(t);
  f.store.prepare(row());
  f.store.claimAttempt(row()['审计ID']);
  f.close(f.store);

  const reopened = await f.openStore();

  await assert.rejects(
    persistAuditRecord(f.writeArgs(reopened)),
    { code: 'audit_write_unconfirmed' },
  );

  const result = await reconcileAuditRecord(f.reconcileArgs(reopened));
  assert.equal(result.remoteFound, false);
  assert.equal(result.requiresManualReview, true);
  assert.equal(reopened.get(row()['审计ID']).state, 'attempted');
  assert.equal(f.writes(), 0);
});

test('local preparation failure stops before authentication or remote writes', async t => {
  const f = await fixture(t);
  const failure = new Error('synthetic-local-storage-failure');
  let authentications = 0;
  const store = {
    ...f.store,
    prepare() {
      throw failure;
    },
  };

  await assert.rejects(
    persistAuditRecord({
      ...f.writeArgs(store),
      getBase: async () => {
        authentications++;
        return f.base;
      },
    }),
    error => error === failure,
  );

  assert.equal(authentications, 0);
  assert.equal(f.writes(), 0);
});

test('temporary read-back absence remains unconfirmed until later reconciliation', async t => {
  const f = await fixture(t);
  const listRows = f.base.listRows;
  f.base.listRows = async () => [];

  await assert.rejects(
    persistAuditRecord(f.writeArgs()),
    { code: 'audit_write_unconfirmed' },
  );

  assert.equal(f.writes(), 1);
  assert.equal(f.store.get(row()['审计ID']).state, 'unconfirmed');

  f.base.listRows = listRows;
  const result = await reconcileAuditRecord(f.reconcileArgs());

  assert.equal(result.state, 'confirmed');
  assert.equal(f.writes(), 1);
});