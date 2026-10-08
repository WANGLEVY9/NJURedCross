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
    health,
    checkedScopes,
    counts: () => ({ statusReads, businessReads }),
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