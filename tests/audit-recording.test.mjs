import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createAuditWriteHealth } from '../lib/audit/write-health.js';

const source = (
  await readFile(new URL('../server.js', import.meta.url), 'utf8')
).replace(/\r\n/g, '\n');

const start = source.indexOf('const auditWriteHealth = createAuditWriteHealth();');
const end = source.indexOf('async function readRecentAudit(', start);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);

function fixture() {
  const rows = [];
  const logs = [];
  const box = {
    auditReconciliationStore: null,
    auditBaseUuid: '00000000-0000-0000-0000-000000000001',
    createAuditWriteHealth: () => createAuditWriteHealth({
      log: message => logs.push(message),
    }),
    getBase: async () => ({
      appendRow: async (table, row) => {
        assert.equal(table, 'synthetic-audit');
        rows.push(row);
      },
    }),
    auditTable: 'synthetic-audit',
    eventIdentifier: () => 'synthetic-audit-id',
    auditIdentityRef: () => 'synthetic-masked-reference',
    clientIp: () => 'synthetic-private-address',
  };

  vm.createContext(box);
  vm.runInContext(
    block + '\nglobalThis.record = recordAudit;'
      + '\nglobalThis.health = auditWriteHealth;',
    box,
  );

  return { box, rows, logs };
}

test('audit recording preserves the event fields and counts confirmation', async () => {
  const f = fixture();
  const result = await f.box.record(
    {},
    { username: 'synthetic-actor', role: 'platform_admin' },
    'materials.test',
    'synthetic-target',
    'success',
    { quantity: 2 },
  );

  assert.equal(result.confirmed, true);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0]['动作'], 'materials.test');
  assert.equal(f.rows[0]['对象'], 'synthetic-target');
  assert.equal(f.rows[0]['操作人'], 'synthetic-actor');
  assert.equal(f.rows[0]['备注'], '{"quantity":2}');
  assert.equal(f.box.health.snapshot().confirmed, 1);
  assert.equal(f.logs.length, 0);
});

test('identity audit records retain identity reference masking', async () => {
  const f = fixture();
  await f.box.record(
    {},
    { username: 'synthetic-private-user', role: 'member' },
    'identity.test',
    'synthetic-private-target',
  );

  assert.equal(f.rows[0]['操作人'], 'synthetic-masked-reference');
  assert.equal(f.rows[0]['对象'], 'synthetic-masked-reference');
  assert.equal(f.rows[0]['IP'], 'synthetic-masked-reference');
  assert.equal(JSON.stringify(f.rows).includes('synthetic-private-user'), false);
  assert.equal(JSON.stringify(f.rows).includes('synthetic-private-target'), false);
});

test('lost audit acknowledgement remains visible without exposing the error', async () => {
  const f = fixture();
  f.box.getBase = async () => ({
    appendRow: async (table, row) => {
      f.rows.push(row);
      throw new Error('synthetic-secret-upstream-detail');
    },
  });

  const result = await f.box.record(
    {},
    { username: 'synthetic-user' },
    'materials.test',
    'synthetic-target',
  );

  assert.equal(result.confirmed, false);
  assert.equal(f.rows.length, 1);
  assert.equal(f.box.health.snapshot().unconfirmed, 1);
  assert.equal(f.box.health.snapshot().status, 'degraded');
  assert.equal(JSON.stringify(f.logs).includes('synthetic-secret'), false);
});

test('audit connection failure is counted without propagating', async () => {
  const f = fixture();
  f.box.getBase = async () => {
    throw new Error('synthetic-connection-failure');
  };

  const result = await f.box.record(
    {},
    {},
    'materials.test',
    'synthetic-target',
  );

  assert.equal(result.confirmed, false);
  assert.equal(f.rows.length, 0);
  assert.equal(f.box.health.snapshot().attempts, 1);
  assert.equal(f.box.health.snapshot().unconfirmed, 1);
});

test('enabled audit reconciliation receives the masked event and skips direct append', async () => {
  const f = fixture();
  const store = {};
  let calls = 0;

  f.box.auditReconciliationStore = store;
  f.box.persistAuditRecord = async options => {
    calls++;
    assert.equal(options.store, store);
    assert.equal(options.getBase, f.box.getBase);
    assert.equal(options.baseUuid, f.box.auditBaseUuid);
    assert.equal(options.row['动作'], 'identity.test');
    assert.equal(options.row['操作人'], 'synthetic-masked-reference');
    assert.equal(options.row['对象'], 'synthetic-masked-reference');
    assert.equal(options.row['IP'], 'synthetic-masked-reference');
    return { confirmed: true };
  };

  const result = await f.box.record(
    {},
    { username: 'synthetic-private-user', role: 'member' },
    'identity.test',
    'synthetic-private-target',
  );

  assert.equal(result.confirmed, true);
  assert.equal(calls, 1);
  assert.equal(f.rows.length, 0);
  assert.equal(f.box.health.snapshot().confirmed, 1);
});

test('reconciliation failure stays unconfirmed without falling back to direct append', async () => {
  const f = fixture();
  let calls = 0;

  f.box.auditReconciliationStore = {};
  f.box.persistAuditRecord = async () => {
    calls++;
    throw new Error('synthetic-private-reconciliation-detail');
  };

  const result = await f.box.record(
    {},
    { username: 'synthetic-user', role: 'platform_admin' },
    'materials.test',
    'synthetic-target',
  );

  assert.equal(result.confirmed, false);
  assert.equal(calls, 1);
  assert.equal(f.rows.length, 0);
  assert.equal(f.box.health.snapshot().unconfirmed, 1);
  assert.equal(
    JSON.stringify(f.logs).includes('synthetic-private-reconciliation-detail'),
    false,
  );
});