import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { json } from '../lib/http/response.js';
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
    getSession: req => accounts.get(req.headers['x-synthetic-account']) || null,
    requireCsrf: () => true,
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
    guard + `
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