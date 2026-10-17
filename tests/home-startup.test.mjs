import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const guard = source.slice(source.indexOf('async function ensureSession()'), source.indexOf('/**\n * Console routes'));
const boot = source.slice(source.lastIndexOf('(async () => {'));

function fixture(path) {
  let resolve, reject;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  let calls = 0, mounts = 0, authenticated = false;
  const context = vm.createContext({
    location: { pathname: path },
    applySurface() {}, installResizeHandling() {}, installGlobalKeys() {},
    publicApi: { events: async () => ({}), overview: async () => ({}) },
    request: async () => ({}), root: {}, renderer() {},
    refreshSession() { calls++; return pending; },
    getSessionState: () => ({ authenticated }),
    mountRouter: async () => { mounts++; },
  });
  const done = vm.runInContext(`let startupSession = null;\n${guard}\n${boot}`, context);
  return { context, done, resolve, reject, calls: () => calls, mounts: () => mounts,
    authenticate: () => { authenticated = true; } };
}

test('homepage mounts while the session is still pending', async () => {
  const f = fixture('/');
  await f.done;
  assert.equal(f.mounts(), 1);
  assert.equal(f.calls(), 1);
  f.resolve({ authenticated: false });
});

for (const path of ['/console/overview', '/me', '/login', '/events']) {
  test(`${path} retains session-before-mount behavior`, async () => {
    const f = fixture(path);
    assert.equal(f.mounts(), 0);
    f.resolve({ authenticated: false });
    await f.done;
    assert.equal(f.mounts(), 1);
  });
}

test('a guard during homepage startup shares the pending session check', async () => {
  const f = fixture('/');
  const verdict = vm.runInContext('ensureSession()', f.context);
  assert.equal(f.calls(), 1);
  f.authenticate();
  f.resolve({ authenticated: true });
  assert.equal((await verdict).authenticated, true);
  await f.done;
});

test('session failure neither prevents homepage mounting nor authorizes a guard', async () => {
  const f = fixture('/');
  const verdict = vm.runInContext('ensureSession()', f.context);
  await f.done;
  f.reject(new Error('synthetic network failure'));
  assert.equal(await verdict, null);
  assert.equal(f.mounts(), 1);
});

test('settled startup does not prevent later session refreshes', async () => {
  const f = fixture('/');
  f.resolve({ authenticated: false });
  await f.done;
  await vm.runInContext('startupSession', f.context);
  await vm.runInContext('ensureSession()', f.context);
  assert.equal(f.calls(), 2);
});
