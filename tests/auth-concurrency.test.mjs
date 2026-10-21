import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createWriteCoordinator } from '../lib/materials/write-coordinator.js';
import { identityRoutes, BINDING_TABLE, withIdentityAccountLock } from '../lib/identity/api.js';
import { ACCOUNT_TABLE, CODE_TABLE } from '../lib/identity/store.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('auth enters while a business write is blocked, and business writes still serialize', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'auth-business-gate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const withSharedWriteLock = await createWriteCoordinator(join(directory, 'business.sqlite'));
  const withIdentityAccess = await createWriteCoordinator(join(directory, 'identity.sqlite'), { mode: 'shared' });
  const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = source.indexOf('async function api(req, res, url)');
  const end = source.indexOf('async function dispatchApi(', start);
  const entered = deferred(), release = deferred();
  t.after(() => release.resolve());
  const seen = [];
  const box = vm.createContext({ withSharedWriteLock, withIdentityAccess,
    withEventMutation: task => task(),
    dispatchApi: async req => {
      seen.push(req.id);
      if (req.id === 'slow-business') { entered.resolve(); await release.promise; }
      return req.id;
    },
  });
  vm.runInContext(source.slice(start, end) + ';globalThis.invoke=api;', box);
  const invoke = (id, path) => box.invoke({ method: 'POST', id }, {}, new URL(path, 'https://fixture.test'));
  const business = invoke('slow-business', '/api/events');
  await entered.promise;
  let secondEntered = false;
  const second = invoke('second-business', '/api/events').then(() => { secondEntered = true; });
  // This exercises the actual server dispatcher, not a duplicate routing helper.
  for (const path of ['/api/auth/login', '/api/auth/register', '/api/auth/verify-email']) {
    assert.equal(await withRequestBudget(() => invoke(path, path), { timeoutMs: 2000 }), path);
  }
  assert.equal(secondEntered, false);
  release.resolve();
  await Promise.all([business, second]);
  assert.equal(secondEntered, true);
});

test('identity requests share access, but maintenance excludes them until completion', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'auth-maintenance-gate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'identity.sqlite');
  const access = await createWriteCoordinator(file, { mode: 'shared' });
  const maintenance = await createWriteCoordinator(file, { mode: 'exclusive' });
  const release = deferred(), entered = deferred();
  t.after(() => release.resolve());
  const first = access(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  assert.equal(await access(async () => 'parallel auth'), 'parallel auth');
  let maintenanceEntered = false;
  const edit = maintenance(async () => { maintenanceEntered = true; });
  await delay(50);
  assert.equal(maintenanceEntered, false);
  release.resolve();
  await Promise.all([first, edit]);
  assert.equal(maintenanceEntered, true);
  const end = deferred(), maintenanceReady = deferred();
  t.after(() => end.resolve());
  const editing = maintenance(async () => { maintenanceReady.resolve(); await end.promise; });
  await maintenanceReady.promise;
  let authEntered = false;
  const auth = access(async () => { authEntered = true; });
  await delay(50);
  assert.equal(authEntered, false);
  end.resolve();
  await Promise.all([editing, auth]);
  assert.equal(authEntered, true);
});

test('slow signup mail cannot block another student; same student across campus domains stays unique', async t => {
  const tables = new Map([[ACCOUNT_TABLE, []], [CODE_TABLE, []], [BINDING_TABLE, []]]);
  const client = {
    async listRows(table, _v, _o, _c, start = 0, limit = 500) {
      return structuredClone(tables.get(table).slice(start, start + limit));
    },
    async appendRow(table, row) { const _id = randomUUID(); tables.get(table).push({ ...row, _id }); return { _id }; },
    async updateRow(table, id, patch) { Object.assign(tables.get(table).find(row => row._id === id), patch); },
  };
  const mailEntered = deferred(), releaseMail = deferred();
  t.after(() => releaseMail.resolve());
  const ctx = {
    config: { registrationAvailable: true, privateIdentity: true, codeSecret: 'synthetic-secret', smailDomains: ['nju.edu.cn', 'smail.nju.edu.cn'] },
    getBase: async () => client, readJson: async req => req.body, clientIp: () => 'synthetic-ip',
    identifier: () => randomUUID(), recordAudit: async () => {},
    json: (_res, status, body) => ({ status, body }),
    sendMail: async mail => {
      if (mail.to === '231000991@smail.nju.edu.cn') { mailEntered.resolve(); await releaseMail.promise; }
      return { ok: true };
    },
  };
  const register = (studentId, domain = 'smail.nju.edu.cn') => identityRoutes({ method: 'POST', headers: {}, body: {
    studentId, emailDomain: domain, realName: '合成测试用户', password: 'Synthetic1!',
  } }, {}, new URL('https://fixture.test/api/auth/register'), ctx);
  const first = register('231000991');
  await mailEntered.promise;
  const duplicate = register('231000991', 'nju.edu.cn');
  // A real request budget fails this test if a global registration lock returns.
  const other = await withRequestBudget(() => register('231000992'), { timeoutMs: 2000 });
  assert.equal(other.status, 201);
  releaseMail.resolve();
  assert.equal((await first).status, 201);
  assert.equal((await duplicate).body.code, 'student_id_in_use');
  assert.equal(tables.get(ACCOUNT_TABLE).filter(row => row['学号'] === '231000991').length, 1);
});

test('login waits for its own credential mutation, but other mailboxes still log in', async t => {
  const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = source.indexOf('async function authApi(');
  const end = source.indexOf('const publicPrograms =', start);
  const a = { username: 'one@nju.edu.cn', email: 'one@nju.edu.cn', passwordHash: 'synthetic' };
  const b = { username: 'two@nju.edu.cn', email: 'two@nju.edu.cn', passwordHash: 'synthetic' };
  const box = vm.createContext({ withIdentityAccountLock, accountsByUsername: new Map([[a.username, a], [b.username, b]]),
    accountLoad: { source: 'file' }, clientIp: req => req.body.username, loginStatus: () => ({ allowed: true }),
    recordFailedLogin: () => {}, readJson: async req => req.body, verifyPassword: async () => true,
    canAuthenticate: () => true, recordAudit: async () => {}, loginAttempts: new Map(),
    makeSession: () => 'synthetic-token', getSession: () => ({}), eventSessionPayload: async () => ({ ok: true }),
    sessionCookie: token => token, json: (_res, status, body) => ({ status, body }),
  });
  vm.runInContext(source.slice(start, end) + ';globalThis.login=authApi;', box);
  const held = deferred(), release = deferred();
  t.after(() => release.resolve());
  const mutation = withIdentityAccountLock(a.email, async () => { held.resolve(); await release.promise; });
  await held.promise;
  const login = account => box.login({ method: 'POST', body: { username: account.username, password: 'Synthetic1!' } }, {}, new URL('https://fixture.test/api/auth/login'));
  let firstDone = false;
  const first = login(a).then(result => { firstDone = true; return result; });
  assert.equal((await login(b)).status, 200);
  assert.equal(firstDone, false);
  release.resolve();
  await mutation;
  assert.equal((await first).status, 200);
});
