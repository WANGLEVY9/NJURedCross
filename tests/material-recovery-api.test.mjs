import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { scopeForConsolePath } from '../lib/permissions.js';

const source = (await readFile(
  new URL('../server.js', import.meta.url),
  'utf8',
)).replace(/\r\n/g, '\n');

function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, '接口代码片段必须存在');
  return source.slice(a, b);
}

const guards = section(
  '    const requiredScope = scopeForConsolePath(url.pathname);',
  "    if (req.method === 'GET' && url.pathname === '/api/materials/overview')",
);
const recovery = section(
  '    const recoveryAction = url.pathname.match(',
  '    const qrMatch =',
);

function fixture({
  session = { username: 'original', materials: true },
  csrf = true,
  exists = true,
} = {}) {
  const calls = [];
  const receipt = {
    identity: {
      key: 'operation-1',
      payload: {
        actor: 'original',
        applicationId: 'application-1',
        assetCode: 'asset-1',
      },
    },
  };
  const box = {
    URL,
    scopeForConsolePath,
    requireConsoleAccess: (_req, res, scope) => {
      calls.push(`permission:${scope}`);
      if (!session) {
        res.result = { status: 401 };
        return null;
      }
      if (scope !== 'materials' || !session.materials) {
        res.result = { status: 403 };
        return null;
      }
      return session;
    },
    requireCsrf: (_req, res) => {
      calls.push('csrf');
      if (!csrf) res.result = { status: 403 };
      return csrf;
    },
    getBase: async () => {
      calls.push('base');
      return {};
    },
    materialReceiptStore: {
      get: () => {
        calls.push('receipt');
        return exists ? receipt : null;
      },
      save: value => value,
    },
    withMaterialLock: async (_asset, task) => {
      calls.push('lock');
      return task();
    },
    executeMaterialRecovery: async options => {
      calls.push('recover');
      assert.equal(options.incoming, receipt.identity);
      assert.equal(options.receipt, receipt);
      return { flowId: 'flow-1' };
    },
    recordAudit: async () => { calls.push('audit'); },
    json: (_res, status, body) => ({ status, body }),
    // Recovery state reading is covered by the executor's own tests.
    listAllRows: async () => [],
    assertCompleteRows: () => {},
    materialsTable: 'applications',
  };

  vm.createContext(box);
  vm.runInContext(`
    async function route(req, res, url) {
      ${guards}
      ${recovery}
      return false;
    }
    globalThis.route = route;
  `, box);

  return {
    calls,
    async run() {
      const res = {};
      const result = await box.route(
        { method: 'POST' },
        res,
        new URL(
          'http://fixture/api/materials/operations/operation-1/recover',
        ),
      );
      return result ?? res.result;
    },
  };
}

test('anonymous recovery is rejected before reading receipts', async () => {
  const f = fixture({ session: null });
  assert.equal((await f.run()).status, 401);
  assert.deepEqual(f.calls, ['permission:materials']);
});

test('recovery requires materials permission', async () => {
  const f = fixture({
    session: { username: 'original', materials: false },
  });
  assert.equal((await f.run()).status, 403);
  assert.deepEqual(f.calls, ['permission:materials']);
});

test('invalid CSRF prevents recovery and receipt reads', async () => {
  const f = fixture({ csrf: false });
  assert.equal((await f.run()).status, 403);
  assert.deepEqual(f.calls, ['permission:materials', 'csrf']);
});

test('another operator cannot execute recovery', async () => {
  const f = fixture({
    session: { username: 'another', materials: true },
  });
  assert.equal((await f.run()).status, 403);
  assert.ok(!f.calls.includes('lock'));
  assert.ok(!f.calls.includes('recover'));
  assert.ok(!f.calls.includes('audit'));
});

test('missing receipt returns 404 without recovery', async () => {
  const f = fixture({ exists: false });
  assert.equal((await f.run()).status, 404);
  assert.ok(!f.calls.includes('recover'));
});

test('original operator recovers under the material lock', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.status, 200);
  assert.equal(result.body.result._id, 'flow-1');
  assert.deepEqual(f.calls, [
    'permission:materials',
    'csrf',
    'base',
    'receipt',
    'lock',
    'receipt',
    'recover',
    'audit',
  ]);
});

const materialWrites = section(
  '    const transactionAction = url.pathname.match(',
  "    if (req.method === 'GET' && url.pathname === '/api/events/schema-preview')",
);

function inventoryGuardFixture({ pending = true } = {}) {
  const calls = [];
  const body = {
    assetCode: 'asset-1',
    idempotencyKey: 'new-operation',
    quantity: 1,
  };
  const box = {
    URL,
    scopeForConsolePath,
    requireConsoleAccess: () => ({
      username: 'original',
      materials: true,
    }),
    requireCsrf: () => true,
    getBase: async () => ({
      appendRow: async () => {
        calls.push('write');
        return { _id: 'flow-1' };
      },
    }),
    readJson: async () => body,
    readMaterialAction: async () => ({ body, photo: null }),
    materialOperationIdentity: value => ({
      key: value.idempotencyKey,
      payload: value,
    }),
    materialReceiptStore: {
      get: () => null,
      pendingForAsset: () => pending ? [{}] : [],
      pendingForApplication: () => [],
    },
    withMaterialLock: async (_asset, task) => task(),
    materialBundle: async () => {
      calls.push('inventory-read');
      return {
        flows: [],
        summaryByCode: new Map([['asset-1', {}]]),
      };
    },
    transactionPayload: () => ({
      row: { 操作类型: '入库', 数量: 1 },
    }),
    recordAudit: async () => { calls.push('audit'); },
    httpError: (statusCode, message) =>
      Object.assign(new Error(message), { statusCode }),
    json: (_res, status, responseBody) => ({
      status,
      body: responseBody,
    }),
  };

  vm.createContext(box);
  vm.runInContext(`
    async function route(req, res, url) {
      ${guards}
      ${materialWrites}
      return false;
    }
    globalThis.route = route;
  `, box);

  return {
    calls,
    run: path => box.route(
      { method: 'POST' },
      {},
      new URL(`http://fixture${path}`),
    ),
  };
}

test('pending recovery blocks a new inventory transaction', async () => {
  const f = inventoryGuardFixture();
  await assert.rejects(
    f.run('/api/materials/transactions'),
    { statusCode: 409 },
  );
  assert.deepEqual(f.calls, []);
});

test('pending recovery blocks a new checkout before reading inventory', async () => {
  const f = inventoryGuardFixture();
  await assert.rejects(
    f.run('/api/materials/applications/application-1/checkout'),
    { statusCode: 409 },
  );
  assert.deepEqual(f.calls, []);
});

test('inventory transaction proceeds when no recovery is pending', async () => {
  const f = inventoryGuardFixture({ pending: false });
  const result = await f.run('/api/materials/transactions');
  assert.equal(result.status, 201);
  assert.deepEqual(f.calls, ['inventory-read', 'write', 'audit']);
});