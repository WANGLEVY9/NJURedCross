import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  normalizePermissions,
  hasPermission,
  scopeForConsolePath,
} from '../lib/permissions.js';

const source = (await readFile(
  new URL('../server.js', import.meta.url),
  'utf8',
)).replace(/\r\n/g, '\n');

const authStart = source.indexOf('function requireConsoleAccess(');
const authEnd = source.indexOf('\n}', authStart) + 2;
assert.ok(authStart >= 0 && authEnd > authStart, '未找到管理端认证函数');

const routeStart = source.indexOf(
  '    const requiredScope = scopeForConsolePath(url.pathname);',
);
const routeEnd = source.indexOf(
  '    const client = await getBase();',
  routeStart,
);
assert.ok(
  routeStart >= 0 &&
  routeEnd > routeStart &&
  source.slice(routeStart, routeEnd).includes('/api/console/search'),
  '未找到认证后的搜索入口',
);

function fixture({
  session = { username: 'synthetic-admin', role: 'platform_admin' },
  permissions = ['materials'],
} = {}) {
  const responses = [];
  const searches = [];
  const accounts = new Map([[
    'synthetic-admin',
    { username: 'synthetic-admin', role: 'platform_admin', permissions },
  ]]);

  const box = {
    getSession: () => session,
    accountsByUsername: accounts,
    consoleRoles: new Set(['platform_admin', 'super_admin']),
    normalizePermissions,
    hasPermission,
    scopeForConsolePath,
    requireCsrf: () => true,
    json(_res, status, payload) {
      const response = { status, payload };
      responses.push(response);
      return response;
    },
    getConsoleSearch: async (query, grantedPermissions) => {
      searches.push({ query, permissions: [...grantedPermissions] });
      return { ok: true, items: [], unavailable: [], truncated: false };
    },
  };

  vm.createContext(box);
  vm.runInContext(source.slice(authStart, authEnd), box);
  vm.runInContext(`
    async function runRoute(req, res, url) {
      ${source.slice(routeStart, routeEnd)}
      throw new Error('搜索请求不应继续读取业务库');
    }
  `, box);

  return {
    searches,
    accounts,
    async request(method = 'GET', query = '?q=合成') {
      await box.runRoute(
        { method, headers: {}, body: { permissions: ['community'] } },
        {},
        new URL(`http://localhost/api/console/search${query}`),
      );
      return responses.at(-1);
    },
  };
}

test('unauthenticated searches return 401 without reading business data', async () => {
  const f = fixture({ session: null });
  const response = await f.request();
  assert.equal(response.status, 401);
  assert.equal(response.payload.code, 'login_required');
  assert.deepEqual(f.searches, []);
});

test('portal accounts cannot use console search', async () => {
  const f = fixture({
    session: { username: 'synthetic-member', role: 'member' },
  });
  const response = await f.request();
  assert.equal(response.status, 403);
  assert.deepEqual(f.searches, []);
});

test('searches use permissions from the server account', async () => {
  const f = fixture({ permissions: ['materials'] });
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.deepEqual(f.searches, [{
    query: '合成',
    permissions: ['materials'],
  }]);
});

test('query parameters cannot grant additional permissions', async () => {
  const f = fixture({ permissions: ['materials'] });
  await f.request('GET', '?q=合成&permissions=community&role=super_admin');
  assert.deepEqual(f.searches[0].permissions, ['materials']);
});

test('non-GET requests do not execute searches', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    const f = fixture();
    const response = await f.request(method);
    assert.equal(response.status, 405);
    assert.deepEqual(f.searches, []);
  }
});

test('permission changes are applied to the next search', async () => {
  const f = fixture({ permissions: ['materials'] });
  await f.request();

  f.accounts.set('synthetic-admin', {
    username: 'synthetic-admin',
    role: 'platform_admin',
    permissions: ['outreach'],
  });
  await f.request();

  assert.deepEqual(f.searches.map((call) => call.permissions), [
    ['materials'],
    ['outreach'],
  ]);
});