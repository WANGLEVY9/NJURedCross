import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { scopeForConsolePath } from '../lib/permissions.js';
import { createAuditWriteHealth } from '../lib/audit/write-health.js';

const source = (
  await readFile(new URL('../server.js', import.meta.url), 'utf8')
).replace(/\r\n/g, '\n');

const dispatchStart = source.indexOf('async function dispatchApi(');
const start = source.indexOf(
  'const requiredScope = scopeForConsolePath(url.pathname);',
  dispatchStart,
);
const end = source.indexOf('const client = await getBase();', start);
assert.ok(dispatchStart >= 0 && start > dispatchStart && end > start);
const block = source.slice(start, end);

function fixture({ allowed = true, csrf = true } = {}) {
  const health = createAuditWriteHealth({ log: () => {} });
  let statusReads = 0;
  let businessReads = 0;
  const checkedScopes = [];

  const box = {
    auditReconciliationStore: null,
    scopeForConsolePath,
    requireConsoleAccess: (req, res, scope) => {
      checkedScopes.push(scope);
      return allowed ? { username: 'synthetic-admin' } : null;
    },
    requireCsrf: () => csrf,
    auditWriteHealth: {
      snapshot: () => {
        statusReads++;
        return health.snapshot();
      },
    },
    json: (res, status, body) => ({ status, body }),
    getBase: async () => { businessReads++; },
  };

  vm.createContext(box);
  vm.runInContext(
    `globalThis.load = async function(req, res, url) {
      ${block}
      await getBase();
    };`,
    box,
  );

  return {
    box,
    health,
    checkedScopes,
    counts: () => ({ statusReads, businessReads }),
    reconcile: (encodedId = 'AUD-001') => box.load(
      { method: 'POST' },
      {},
      new URL(
        `http://localhost/api/audit/receipts/${encodedId}/reconcile`,
      ),
    ),
    loadReceipts: (query = '') => box.load(
      { method: 'GET' },
      {},
      new URL(`http://localhost/api/audit/receipts${query}`),
    ),
    load: (method = 'GET') => box.load(
      { method },
      {},
      { pathname: '/api/audit/status' },
    ),
  };
}

test('denied console access stops before reading audit status', async () => {
  const f = fixture({ allowed: false });

  assert.equal(await f.load(), undefined);
  assert.deepEqual(f.checkedScopes, ['settings']);
  assert.deepEqual(f.counts(), { statusReads: 0, businessReads: 0 });
});

test('authorized status reads expose counters without reading the business Base', async () => {
  const f = fixture();
  await f.health.write(async () => {
    throw new Error('synthetic-private-event-detail');
  });

  const result = await f.load();

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.audit.unconfirmed, 1);
  assert.equal(result.body.audit.persistent, false);
  assert.deepEqual(f.checkedScopes, ['settings']);
  assert.deepEqual(f.counts(), { statusReads: 1, businessReads: 0 });
  assert.equal(
    JSON.stringify(result.body).includes('synthetic-private-event-detail'),
    false,
  );
});

test('write requests with rejected CSRF cannot read status or reach the Base', async () => {
  const f = fixture({ csrf: false });

  assert.equal(await f.load('POST'), undefined);
  assert.deepEqual(f.counts(), { statusReads: 0, businessReads: 0 });
});
test('enabled receipt status exposes counts without reading the business Base', async () => {
  const f = fixture();
  let receiptReads = 0;
  const states = {
    prepared: 1,
    attempted: 2,
    unconfirmed: 3,
    confirmed: 4,
  };

  f.box.auditReconciliationStore = {
    summary: () => {
      receiptReads++;
      return states;
    },
  };

  const result = await f.load();

  assert.equal(result.status, 200);
  assert.equal(result.body.auditReceipts.enabled, true);
  assert.equal(result.body.auditReceipts.persistent, true);
  assert.deepEqual(result.body.auditReceipts.states, states);
  assert.equal(receiptReads, 1);
  assert.equal(f.counts().businessReads, 0);
});

test('denied access stops before reading persistent receipt counts', async () => {
  const f = fixture({ allowed: false });
  let receiptReads = 0;

  f.box.auditReconciliationStore = {
    summary: () => {
      receiptReads++;
      return {};
    },
  };

  assert.equal(await f.load(), undefined);
  assert.equal(receiptReads, 0);
  assert.equal(f.counts().businessReads, 0);
});

test('disabled receipt listing returns 503 without reading the business Base', async () => {
  const f = fixture();
  const result = await f.loadReceipts();

  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'audit_reconciliation_disabled');
  assert.equal(f.counts().businessReads, 0);
});

test('authorized receipt listing passes bounded pagination to the store', async () => {
  const f = fixture();
  let calls = 0;

  f.box.auditReconciliationStore = {
    listAttention: options => {
      calls++;
      assert.equal(options.limit, 5);
      assert.equal(options.after, 'AUD-001');
      return {
        items: [{ auditId: 'AUD-002', state: 'unconfirmed' }],
        hasMore: false,
        nextCursor: null,
      };
    },
  };

  const result = await f.loadReceipts('?limit=5&after=AUD-001');

  assert.equal(result.status, 200);
  assert.equal(result.body.items[0].auditId, 'AUD-002');
  assert.equal(calls, 1);
  assert.equal(f.counts().businessReads, 0);
  assert.deepEqual(f.checkedScopes, ['settings']);
});

test('invalid receipt pagination stops before reading the store', async () => {
  const f = fixture();
  let calls = 0;

  f.box.auditReconciliationStore = {
    listAttention: () => { calls++; return {}; },
  };

  for (const query of [
    '?limit=0',
    '?limit=101',
    '?limit=1.5',
    '?limit=',
    '?limit=abc',
    `?after=${'x'.repeat(201)}`,
  ]) {
    const result = await f.loadReceipts(query);
    assert.equal(result.status, 400);
  }

  assert.equal(calls, 0);
  assert.equal(f.counts().businessReads, 0);
});

test('denied receipt listing stops before reading the store', async () => {
  const f = fixture({ allowed: false });
  let calls = 0;

  f.box.auditReconciliationStore = {
    listAttention: () => { calls++; return {}; },
  };

  assert.equal(await f.loadReceipts(), undefined);
  assert.equal(calls, 0);
  assert.equal(f.counts().businessReads, 0);
});

test('authorized reconciliation calls the controller with the bound Base', async () => {
  const f = fixture();
  let calls = 0;
  const store = {
    get: id => {
      assert.equal(id, 'AUD-001');
      return { auditId: id, state: 'unconfirmed' };
    },
  };

  f.box.auditReconciliationStore = store;
  f.box.auditBaseUuid = '00000000-0000-4000-8000-000000000001';
  f.box.reconcileAuditRecord = async options => {
    calls++;
    assert.equal(options.store, store);
    assert.equal(options.getBase, f.box.getBase);
    assert.equal(options.baseUuid, f.box.auditBaseUuid);
    assert.equal(options.auditId, 'AUD-001');
    return {
      state: 'confirmed',
      remoteFound: true,
      requiresManualReview: false,
    };
  };

  const result = await f.reconcile();

  assert.equal(result.status, 200);
  assert.equal(result.body.auditId, 'AUD-001');
  assert.equal(result.body.state, 'confirmed');
  assert.equal(calls, 1);
  assert.deepEqual(f.checkedScopes, ['settings']);
  assert.equal(f.counts().businessReads, 0);
});

test('reconciliation requires console permission and CSRF before reading receipts', async () => {
  for (const options of [{ allowed: false }, { csrf: false }]) {
    const f = fixture(options);
    let reads = 0;
    let calls = 0;

    f.box.auditReconciliationStore = {
      get: () => { reads++; return {}; },
    };
    f.box.reconcileAuditRecord = async () => { calls++; };

    assert.equal(await f.reconcile(), undefined);
    assert.equal(reads, 0);
    assert.equal(calls, 0);
    assert.equal(f.counts().businessReads, 0);
  }
});

test('disabled reconciliation stops before connecting to the business Base', async () => {
  const f = fixture();
  const result = await f.reconcile();

  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'audit_reconciliation_disabled');
  assert.equal(f.counts().businessReads, 0);
});

test('missing local receipts return 404 without invoking reconciliation', async () => {
  const f = fixture();
  let calls = 0;

  f.box.auditReconciliationStore = { get: () => null };
  f.box.reconcileAuditRecord = async () => { calls++; };

  const result = await f.reconcile();

  assert.equal(result.status, 404);
  assert.equal(result.body.code, 'audit_receipt_not_found');
  assert.equal(calls, 0);
  assert.equal(f.counts().businessReads, 0);
});

test('invalid audit identifiers stop before reading receipts', async () => {
  const f = fixture();
  let reads = 0;

  f.box.auditReconciliationStore = {
    get: () => { reads++; return {}; },
  };

  for (const id of ['%ZZ', '%00', '%0A', 'x'.repeat(201)]) {
    const result = await f.reconcile(id);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'invalid_audit_id');
  }

  assert.equal(reads, 0);
  assert.equal(f.counts().businessReads, 0);
});