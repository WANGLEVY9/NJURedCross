import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('async function renderer(');
const end = source.indexOf('/* --------------------------------------------------------------------------', start);
const renderer = source.slice(start, end);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const shellReady = deferred(), pageReady = deferred();
  let active = true;
  const calls = { shell: 0, module: 0, page: 0, shown: 0, errors: 0, ended: 0 };
  const shell = { beginNavigation() {}, endNavigation() { calls.ended++; },
    async showPage() { calls.shown++; } };
  const module = { default: async () => { calls.page++; return { title: '合成页面' }; } };
  const context = vm.createContext({
    ensurePageStyles: async () => {},
    ensureShell: () => { calls.shell++; return shellReady.promise; },
    notify: { error() { calls.errors++; } }, console: { error() {} },
    document: { getElementById: () => null, title: '' }, window: {},
    args: { context: { path: '/', popped: true }, token: () => active,
      handler: { surface: 'portal', load: () => { calls.module++; return pageReady.promise; } } },
  });
  const done = vm.runInContext(`let currentDispose = null;\n${renderer}\nrenderer(args)`, context);
  return { shellReady, pageReady, shell, module, calls, done, cancel: () => { active = false; } };
}

test('shell and page downloads start before either is ready', async () => {
  const f = fixture();
  await tick();
  assert.equal(f.calls.shell, 1);
  assert.equal(f.calls.module, 1);
  assert.equal(f.calls.page, 0);
  f.pageReady.resolve(f.module);
  await tick();
  assert.equal(f.calls.page, 0);
  f.shellReady.resolve(f.shell);
  await f.done;
  assert.equal(f.calls.page, 1);
  assert.equal(f.calls.shown, 1);
});

test('a ready shell still waits for the page module', async () => {
  const f = fixture();
  f.shellReady.resolve(f.shell);
  await tick();
  assert.equal(f.calls.shown, 0);
  f.pageReady.resolve(f.module);
  await f.done;
  assert.equal(f.calls.shown, 1);
});

test('early module failure is handled and retains the error notification', async () => {
  const f = fixture();
  f.pageReady.reject(new Error('synthetic module failure'));
  await tick();
  f.shellReady.resolve(f.shell);
  await f.done;
  assert.equal(f.calls.errors, 1);
  assert.equal(f.calls.ended, 1);
  assert.equal(f.calls.shown, 0);
});

test('cancelled navigation does not render a late module', async () => {
  const f = fixture();
  f.shellReady.resolve(f.shell);
  await tick();
  f.cancel();
  f.pageReady.resolve(f.module);
  await f.done;
  assert.equal(f.calls.page, 0);
  assert.equal(f.calls.shown, 0);
});

test('cancelled navigation does not show a stale module error', async () => {
  const f = fixture();
  f.shellReady.resolve(f.shell);
  await tick();
  f.cancel();
  f.pageReady.reject(new Error('synthetic late failure'));
  await f.done;
  assert.equal(f.calls.errors, 0);
});

test('shell failure does not leave a later module rejection unhandled', async () => {
  const f = fixture();
  f.shellReady.reject(new Error('synthetic shell failure'));
  await assert.rejects(f.done, /synthetic shell failure/);
  f.pageReady.reject(new Error('synthetic late module failure'));
  await tick();
  assert.equal(f.calls.shown, 0);
});
