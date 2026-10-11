import { test } from 'node:test';
import assert from 'node:assert/strict';

test('a late route guard cannot redirect or replace the latest mobile navigation', async t => {
  const originals = Object.fromEntries(['window', 'document', 'location', 'history'].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  globalThis.location = { origin: 'http://fixture.local', pathname: '/', search: '' };
  globalThis.history = {
    state: null,
    pushState(state, _, path) { const url = new URL(path, globalThis.location.origin); globalThis.location.pathname = url.pathname; globalThis.location.search = url.search; this.state = state; },
    replaceState(state, _, path) { this.pushState(state, _, path); },
  };
  globalThis.window = { addEventListener() {} };
  globalThis.document = { addEventListener() {} };
  const router = await import('../public/app/core/router.js');
  let finishGuard;
  const rendered = [];
  router.defineRoutes([
    { path: '/', handler: 'home' },
    { path: '/slow', handler: 'slow', guard: () => new Promise(resolve => { finishGuard = resolve; }) },
    { path: '/latest', handler: 'latest' },
    { path: '/login', handler: 'login' },
  ]);
  await router.mountRouter({ target: {}, render: async ({ context }) => { rendered.push(context.path); } });
  for (const verdict of ['/login', true]) {
    const slow = router.navigate('/slow');
    await router.navigate('/latest');
    finishGuard(verdict);
    await slow;
    assert.equal(globalThis.location.pathname, '/latest');
    assert.equal(router.getCurrent().path, '/latest');
    assert.equal(rendered.at(-1), '/latest');
  }
  assert.equal(rendered.includes('/slow'), false);
  assert.equal(rendered.includes('/login'), false);
});

test('page swaps commit without waiting for an outgoing animation', async t => {
  const originalWindow = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const originalDocument = globalThis.document;
  globalThis.document = { documentElement: { dataset: {} } };
  t.after(() => { globalThis.window = originalWindow; globalThis.document = originalDocument; });
  const { swapView } = await import('../public/app/core/motion.js');
  const committed = [];
  const container = { replaceChildren(node) { committed.push(node.id); } };
  const node = id => ({ id, animate: () => ({ finished: new Promise(() => {}) }) });
  await swapView(container, node('first'));
  await swapView(container, node('latest'));
  assert.deepEqual(committed, ['first', 'latest']);
});
