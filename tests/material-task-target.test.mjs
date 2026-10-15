import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../public/app/console/pages/materials.js', import.meta.url),
  'utf8',
);
const start = source.indexOf('  function openTaskTarget(reload) {');
const end = source.indexOf('  function switchTab(value) {', start);
assert.ok(start >= 0 && end > start, '未找到待办定位函数');

function fixture(query, snapshot) {
  const calls = [];
  const reload = () => {};
  const box = {
    context: { query: new URLSearchParams(query) },
    snapshot,
    taskTargetHandled: false,
    tab: 'tasks',
    tabControl: {
      setValue(value) { calls.push(['tab', value]); },
    },
    renderBody(value) {
      assert.equal(value, reload);
      calls.push(['render']);
    },
    showApplicationInspector(row, value) {
      assert.equal(value, reload);
      calls.push(['application', row.id]);
    },
    showInventoryInspector(row, value) {
      assert.equal(value, reload);
      calls.push(['inventory', row.id]);
    },
    notify: {
      warning(title) { calls.push(['warning', title]); },
    },
  };
  vm.createContext(box);
  vm.runInContext(source.slice(start, end), box);
  return { calls, run: () => box.openTaskTarget(reload) };
}

const snapshot = {
  applications: [{ id: 'application-1' }],
  inventory: [{ id: 'inventory-1' }],
};

test('application target opens its detail and does not reopen on refresh', () => {
  const f = fixture('application=application-1', snapshot);
  f.run();
  f.run();
  assert.deepEqual(f.calls, [
    ['tab', 'applications'],
    ['render'],
    ['application', 'application-1'],
  ]);
});

test('inventory target opens the matching inventory detail', () => {
  const f = fixture('inventory=inventory-1', snapshot);
  f.run();
  assert.deepEqual(f.calls, [
    ['tab', 'inventory'],
    ['render'],
    ['inventory', 'inventory-1'],
  ]);
});

test('ordinary page visits do not open a detail', () => {
  const f = fixture('tab=tasks', snapshot);
  f.run();
  assert.deepEqual(f.calls, []);
});

test('ambiguous or empty targets only show a warning', () => {
  for (const query of [
    'application=application-1&inventory=inventory-1',
    'application=',
    'inventory=%20%20',
  ]) {
    const f = fixture(query, snapshot);
    f.run();
    assert.deepEqual(f.calls, [['warning', '无法定位待办']]);
  }
});

test('missing records do not open another record', () => {
  const f = fixture('application=missing', snapshot);
  f.run();
  assert.deepEqual(f.calls, [['warning', '当前列表未找到对应记录']]);
});