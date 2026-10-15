import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../public/app/console/pages/outreach.js', import.meta.url),
  'utf8',
);
const marker = source.indexOf("context.query.has('campaign')");
const start = source.lastIndexOf('      if (', marker);
const end = source.indexOf("\n      const stageOf =", marker);
assert.ok(marker >= 0 && start >= 0 && end > marker, '未找到看板定位代码');

function fixture(query, options = {}) {
  const opened = [];
  const warnings = [];
  const box = {
    context: { query: new URLSearchParams(query) },
    tab: options.tab || 'board',
    disposed: options.disposed || false,
    campaignTargetHandled: false,
    payload: { campaigns: [] },
    showInspector(item) {
      opened.push(item.id);
    },
    notify: {
      warning(title) {
        warnings.push(title);
      },
    },
  };

  vm.createContext(box);

  return {
    opened,
    warnings,
    run(campaigns) {
      box.payload = { campaigns };
      vm.runInContext(source.slice(start, end), box);
    },
  };
}

const rows = [
  { id: 'planning:synthetic-1' },
  { id: 'creative:synthetic-2' },
];

test('opens the matching campaign detail', () => {
  const f = fixture('campaign=creative%3Asynthetic-2');
  f.run(rows);
  assert.deepEqual(f.opened, ['creative:synthetic-2']);
});

test('refresh does not reopen the detail', () => {
  const f = fixture('campaign=planning%3Asynthetic-1');
  f.run(rows);
  f.run(rows);
  assert.deepEqual(f.opened, ['planning:synthetic-1']);
});

test('ordinary visits do not open details', () => {
  const f = fixture('tab=board');
  f.run(rows);
  assert.deepEqual(f.opened, []);
  assert.deepEqual(f.warnings, []);
});

test('missing and blank targets warn without opening another item', () => {
  for (const query of ['campaign=missing', 'campaign=', 'campaign=%20%20']) {
    const f = fixture(query);
    f.run(rows);
    assert.deepEqual(f.opened, []);
    assert.equal(f.warnings.length, 1);
  }
});

test('an empty board explains the missing target', () => {
  const f = fixture('campaign=planning%3Asynthetic-1');
  f.run([]);
  assert.deepEqual(f.opened, []);
  assert.equal(f.warnings.length, 1);
});

test('inactive and disposed pages do not open details', () => {
  for (const options of [{ tab: 'public' }, { disposed: true }]) {
    const f = fixture('campaign=planning%3Asynthetic-1', options);
    f.run(rows);
    assert.deepEqual(f.opened, []);
    assert.deepEqual(f.warnings, []);
  }
});
