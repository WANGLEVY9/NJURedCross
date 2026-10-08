import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import vm from 'node:vm';
import { json } from '../lib/http/response.js';
import { timingSafeEqual } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAuditReconciliationStore } from '../lib/audit/reconciliation-store.js';
import {
  persistAuditRecord,
  reconcileAuditRecord,
} from '../lib/audit/reconciliation.js';
import {
  hasPermission,
  scopeForConsolePath,
} from '../lib/permissions.js';
import { createAuditWriteHealth } from '../lib/audit/write-health.js';

const source = (
  await readFile(new URL('../server.js', import.meta.url), 'utf8')
).replace(/\r\n/g, '\n');

const guardStart = source.indexOf('function requireConsoleAccess(');
const guardEnd = source.indexOf('/** Portal guard.', guardStart);
assert.ok(guardStart >= 0 && guardEnd > guardStart);
const guard = source.slice(guardStart, guardEnd);
const csrfStart = source.indexOf('function requireCsrf(');
const csrfEnd = source.indexOf(
  '/** Combined guard for student-surface writes:',
  csrfStart,
);
assert.ok(csrfStart >= 0 && csrfEnd > csrfStart);
const csrfGuard = source.slice(csrfStart, csrfEnd);

const dispatchStart = source.indexOf('async function dispatchApi(');
const routeStart = source.indexOf(
  'const requiredScope = scopeForConsolePath(url.pathname);',
  dispatchStart,
);
const routeEnd = source.indexOf(
  'const client = await getBase();',
  routeStart,
);
assert.ok(routeStart > dispatchStart && routeEnd > routeStart);
const route = source.slice(routeStart, routeEnd);

async function fixture(t) {
  const accounts = new Map([
    ['member', {
      username: 'member',
      role: 'member',
      permissions: [],
    }],
    ['events-admin', {
      username: 'events-admin',
      role: 'platform_admin',
      permissions: ['events'],
    }],
    ['settings-admin', {
      username: 'settings-admin',
      role: 'platform_admin',
      permissions: ['settings'],
    }],
    ['super-admin', {
      username: 'super-admin',
      role: 'super_admin',
      permissions: [],
    }],
  ]);

  const health = createAuditWriteHealth({ log: () => {} });
  await health.write(async () => {
    throw new Error('synthetic-private-error-detail');
  });

  let statusReads = 0;
  let businessReads = 0;
  const box = {
    auditReconciliationStore: null,
    json,
    hasPermission,
    scopeForConsolePath,
    accountsByUsername: accounts,
    consoleRoles: new Set(['platform_admin', 'super_admin']),
    getSession: req => {
      const account = accounts.get(req.headers['x-synthetic-account']);
      return account
        ? { ...account, csrf: 'synthetic-csrf-token' }
        : null;
    },
    safeEqual: (left, right) => {
      if (typeof left !== 'string' || typeof right !== 'string') {
        return false;
      }
      const a = Buffer.from(left);
      const b = Buffer.from(right);
      return a.length === b.length && timingSafeEqual(a, b);
    },
    auditWriteHealth: {
      snapshot: () => {
        statusReads++;
        return health.snapshot();
      },
    },
    getBase: async () => {
      businessReads++;
      throw new Error('Business Base must not be read');
    },
  };

  vm.createContext(box);
  vm.runInContext(
    guard + csrfGuard + `
      globalThis.handle = async function(req, res, url) {
        ${route}
        await getBase();
      };
    `,
    box,
  );

  const server = http.createServer((req, res) => {
    box.handle(
      req,
      res,
      new URL(req.url, 'http://localhost'),
    ).catch(() => {
      if (!res.headersSent) json(res, 500, { ok: false });
      else res.destroy();
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));

  return {
    box,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    url: `http://127.0.0.1:${server.address().port}/api/audit/status`,
    counts: () => ({ statusReads, businessReads }),
  };
}

test('HTTP rejects anonymous, member and unauthorized administrator requests', async t => {
  const f = await fixture(t);

  for (const [account, status, code] of [
    [null, 401, 'login_required'],
    ['member', 403, 'console_forbidden'],
    ['events-admin', 403, 'permission_denied'],
  ]) {
    const response = await fetch(f.url, {
      headers: account ? { 'x-synthetic-account': account } : {},
    });
    const body = await response.json();

    assert.equal(response.status, status);
    assert.equal(body.code, code);
    assert.equal(body.audit, undefined);
  }

  assert.deepEqual(f.counts(), {
    statusReads: 0,
    businessReads: 0,
  });
});

test('HTTP permits settings administrators and super administrators', async t => {
  const f = await fixture(t);

  for (const account of ['settings-admin', 'super-admin']) {
    const response = await fetch(f.url, {
      headers: { 'x-synthetic-account': account },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.ok, true);
    assert.equal(body.audit.unconfirmed, 1);
    assert.equal(body.audit.persistent, false);
    assert.equal(
      JSON.stringify(body).includes('synthetic-private-error-detail'),
      false,
    );
  }

  assert.deepEqual(f.counts(), {
    statusReads: 2,
    businessReads: 0,
  });
});

test('HTTP reconciliation rejects unauthorized accounts before reading receipts', async t => {
  const f = await fixture(t);
  let reads = 0;
  let reconciliations = 0;

  f.box.auditReconciliationStore = {
    get: () => { reads++; return {}; },
  };
  f.box.reconcileAuditRecord = async () => {
    reconciliations++;
    return {};
  };

  for (const [account, status, code] of [
    [null, 401, 'login_required'],
    ['member', 403, 'console_forbidden'],
    ['events-admin', 403, 'permission_denied'],
  ]) {
    const headers = { 'x-csrf-token': 'synthetic-csrf-token' };
    if (account) headers['x-synthetic-account'] = account;

    const response = await fetch(
      `${f.baseUrl}/api/audit/receipts/AUD-001/reconcile`,
      { method: 'POST', headers },
    );
    const body = await response.json();

    assert.equal(response.status, status);
    assert.equal(body.code, code);
  }

  assert.equal(reads, 0);
  assert.equal(reconciliations, 0);
  assert.equal(f.counts().businessReads, 0);
});

test('HTTP reconciliation rejects missing or incorrect CSRF before reading receipts', async t => {
  const f = await fixture(t);
  let reads = 0;
  let reconciliations = 0;

  f.box.auditReconciliationStore = {
    get: () => { reads++; return {}; },
  };
  f.box.reconcileAuditRecord = async () => {
    reconciliations++;
    return {};
  };

  for (const account of ['settings-admin', 'super-admin']) {
    for (const token of [null, 'synthetic-wrong-token']) {
      const headers = { 'x-synthetic-account': account };
      if (token !== null) headers['x-csrf-token'] = token;

      const response = await fetch(
        `${f.baseUrl}/api/audit/receipts/AUD-001/reconcile`,
        { method: 'POST', headers },
      );
      const body = await response.json();

      assert.equal(response.status, 403);
      assert.equal(body.code, 'csrf_failed');
    }
  }

  assert.equal(reads, 0);
  assert.equal(reconciliations, 0);
  assert.equal(f.counts().businessReads, 0);
});

test('HTTP reconciliation permits authorized accounts with valid CSRF', async t => {
  const f = await fixture(t);
  let reads = 0;
  let reconciliations = 0;
  const store = {
    get: id => {
      reads++;
      assert.equal(id, 'AUD-001');
      return { auditId: id, state: 'unconfirmed' };
    },
  };

  f.box.auditReconciliationStore = store;
  f.box.auditBaseUuid = '00000000-0000-4000-8000-000000000001';
  f.box.reconcileAuditRecord = async options => {
    reconciliations++;
    assert.equal(options.store, store);
    assert.equal(options.auditId, 'AUD-001');
    assert.equal(options.baseUuid, f.box.auditBaseUuid);
    return {
      state: 'confirmed',
      remoteFound: true,
      requiresManualReview: false,
    };
  };

  for (const account of ['settings-admin', 'super-admin']) {
    const response = await fetch(
      `${f.baseUrl}/api/audit/receipts/AUD-001/reconcile`,
      {
        method: 'POST',
        headers: {
          'x-synthetic-account': account,
          'x-csrf-token': 'synthetic-csrf-token',
        },
      },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.ok, true);
    assert.equal(body.auditId, 'AUD-001');
    assert.equal(body.state, 'confirmed');
    assert.equal(body.requiresManualReview, false);
    assert.equal(body.row, undefined);
  }

  assert.equal(reads, 2);
  assert.equal(reconciliations, 2);
  assert.equal(f.counts().businessReads, 0);
});

test('HTTP reconciliation preserves the requirement for manual review', async t => {
  const f = await fixture(t);

  f.box.auditReconciliationStore = {
    get: () => ({ auditId: 'AUD-001', state: 'unconfirmed' }),
  };
  f.box.auditBaseUuid = '00000000-0000-4000-8000-000000000001';
  f.box.reconcileAuditRecord = async () => ({
    state: 'unconfirmed',
    remoteFound: false,
    requiresManualReview: true,
  });

  const response = await fetch(
    `${f.baseUrl}/api/audit/receipts/AUD-001/reconcile`,
    {
      method: 'POST',
      headers: {
        'x-synthetic-account': 'settings-admin',
        'x-csrf-token': 'synthetic-csrf-token',
      },
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.state, 'unconfirmed');
  assert.equal(body.remoteFound, false);
  assert.equal(body.requiresManualReview, true);
  assert.equal(f.counts().businessReads, 0);
});

test('HTTP reconciliation confirms a persisted lost acknowledgement without resending', async t => {
  const f = await fixture(t);
  const directory = await mkdtemp(join(tmpdir(), 'audit-http-'));
  const baseUuid = '00000000-0000-4000-8000-000000000001';
  const store = await openAuditReconciliationStore(
    join(directory, 'receipts.sqlite'),
    {
      secret: 'synthetic-audit-http-secret-at-least-32-characters',
      baseUuid,
    },
  );

  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  const row = {
    审计ID: 'AUD-http-001',
    时间: '2026-01-01T00:00:00.000Z',
    操作人: 'synthetic-private-actor',
    角色: 'platform_admin',
    动作: 'materials.synthetic',
    对象: 'synthetic-private-target',
    结果: 'success',
    IP: 'synthetic-private-address',
    备注: '',
  };

  const remoteRows = [];
  let writes = 0;
  let queries = 0;

  const base = {
    dtableUuid: baseUuid,
    appendRow: async (table, value) => {
      assert.equal(table, '操作审计表');
      writes++;
      remoteRows.push({ _id: 'synthetic-remote-row', ...value });
      throw new Error('synthetic-lost-acknowledgement');
    },
    query: async sql => {
      queries++;
      assert.ok(sql.includes("WHERE `审计ID` = 'AUD-http-001'"));
      return remoteRows;
    },
  };

  await assert.rejects(
    persistAuditRecord({
      store,
      getBase: async () => base,
      baseUuid,
      row,
    }),
    { code: 'audit_write_unconfirmed' },
  );

  assert.equal(store.get(row['审计ID']).state, 'unconfirmed');
  assert.equal(writes, 1);

  f.box.auditReconciliationStore = store;
  f.box.auditBaseUuid = baseUuid;
  f.box.getBase = async () => base;
  f.box.reconcileAuditRecord = reconcileAuditRecord;

  const response = await fetch(
    `${f.baseUrl}/api/audit/receipts/AUD-http-001/reconcile`,
    {
      method: 'POST',
      headers: {
        'x-synthetic-account': 'settings-admin',
        'x-csrf-token': 'synthetic-csrf-token',
      },
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.state, 'confirmed');
  assert.equal(body.remoteFound, true);
  assert.equal(body.requiresManualReview, false);
  assert.equal(store.get(row['审计ID']).state, 'confirmed');
  assert.equal(writes, 1);
  assert.equal(queries, 1);
  assert.equal(JSON.stringify(body).includes('synthetic-private'), false);
});