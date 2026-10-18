import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app/portal/pages/home.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  // Each source updates');
const end = source.indexOf('  return {\n    title:', start);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const events = deferred(), overview = deferred();
  const slot = () => ({ children: [], attrs: {}, updates: 0,
    replaceChildren(...children) { this.children = children; this.updates++; },
    setAttribute(key, value) { this.attrs[key] = value; } });
  const figuresSlot = slot(), railSlot = slot();
  const context = vm.createContext({
    publicApi: { events: () => events.promise, overview: () => overview.promise },
    figuresSlot, railSlot,
    figure: (value, label, options) => ({ value, label, options }),
    activityPresentation: items => ({ blood: items.filter(x => x.blood), ordinary: items.filter(x => !x.blood) }),
    bloodEntry: items => ({ blood: items.length }), eventRow: event => event,
    h: (tag, attrs, ...children) => ({ tag, attrs, children }),
    emptyState: options => ({ empty: true, ...options }),
    errorState: options => ({ failed: true, ...options }), button: options => options,
    navigate() {},
  });
  vm.runInContext(block, context);
  return { events, overview, figuresSlot, railSlot,
    dispose: () => vm.runInContext('disposed = true', context) };
}
const stats = { openSeats: 7, totalRegistrations: 20, inventoryCategories: 3 };
const open = { status: '报名中', name: '合成活动' };

test('events and their count appear while overview is still pending', async () => {
  const f = fixture(); f.events.resolve({ events: [open] }); await tick();
  assert.equal(f.figuresSlot.children[0].value, 1);
  assert.equal(f.railSlot.updates, 1);
  assert.equal(f.figuresSlot.attrs['aria-busy'], 'true');
  f.overview.resolve({ stats }); await tick();
  assert.equal(f.figuresSlot.attrs['aria-busy'], 'false');
});
test('overview statistics appear while events are still pending', async () => {
  const f = fixture(); f.overview.resolve({ stats }); await tick();
  assert.equal(f.figuresSlot.children[1].value, 7);
  assert.equal(f.figuresSlot.children[0].value, null);
  f.events.resolve({ events: [] }); await tick();
});
test('overview failure preserves an empty activity list instead of replacing it with an error', async () => {
  const f = fixture(); f.events.resolve({ events: [] }); await tick();
  f.overview.reject(new Error('synthetic failure')); await tick();
  assert.equal(f.railSlot.children[0].empty, true);
  assert.equal(f.figuresSlot.children[0].value, 0);
  assert.equal(f.figuresSlot.children[1].options.suffix, '暂未更新');
});
test('events failure preserves independently loaded overview statistics', async () => {
  const f = fixture(); f.overview.resolve({ stats }); f.events.reject(new Error('synthetic failure')); await tick();
  assert.equal(f.railSlot.children[0].failed, true);
  assert.equal(f.figuresSlot.children[1].value, 7);
  assert.equal(f.figuresSlot.attrs['aria-busy'], 'false');
});
test('both failures finish loading and keep missing values distinct from zero', async () => {
  const f = fixture(); f.events.reject(new Error('synthetic')); f.overview.reject(new Error('synthetic')); await tick();
  assert.equal(f.figuresSlot.children[0].value, null);
  assert.equal(f.figuresSlot.children[1].value, undefined);
  assert.equal(f.figuresSlot.attrs['aria-busy'], 'false');
});
test('blood sessions still count as one public activity', async () => {
  const f = fixture(); f.events.resolve({ events: [open, { ...open, blood: true }, { ...open, blood: true }, { status: '已结束' }] });
  f.overview.resolve({ stats }); await tick();
  assert.equal(f.figuresSlot.children[0].value, 2);
});
test('late responses after leaving the page do not update its regions', async () => {
  const f = fixture(); f.dispose(); f.events.resolve({ events: [open] }); f.overview.resolve({ stats }); await tick();
  assert.equal(f.figuresSlot.updates, 0);
  assert.equal(f.railSlot.updates, 0);
});
test('malformed overview does not erase a successfully loaded activity list', async () => {
  const f = fixture(); f.events.resolve({ events: [open] }); f.overview.resolve({}); await tick();
  assert.equal(f.railSlot.children[0].failed, undefined);
  assert.equal(f.figuresSlot.children[0].value, 1);
  assert.equal(f.figuresSlot.children[1].options.suffix, '暂未更新');
});
