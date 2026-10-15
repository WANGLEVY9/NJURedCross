import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../public/app/console/pages/volunteers.js', import.meta.url),
  'utf8',
);
const start = source.indexOf('  function openHoursTaskTarget(payload) {');
const end = source.indexOf('\n  const load =', start);
assert.ok(start >= 0 && end > start, '未找到时长定位函数');

function fixture(query, { disposed = false } = {}) {
  const calls = [];
  const box = {
    context: { query: new URLSearchParams(query) },
    disposed,
    hoursTargetHandled: false,
    notify: {
      warning(title, description) {
        calls.push(['warning', title, description]);
      },
    },
    openHoursPreview(row) {
      calls.push(['preview', row.id]);
    },
  };

  vm.createContext(box);
  vm.runInContext(source.slice(start, end), box);

  return {
    calls,
    run(rows) {
      box.openHoursTaskTarget({ hoursQueue: rows });
    },
  };
}

const rows = [{ id: 'hours-1' }, { id: 'hours-2' }];

test('opens the preview for the matching record', () => {
  const f = fixture('hours=hours-2');
  f.run(rows);
  assert.deepEqual(f.calls, [['preview', 'hours-2']]);
});

test('refresh does not reopen the preview', () => {
  const f = fixture('hours=hours-1');
  f.run(rows);
  f.run(rows);
  assert.deepEqual(f.calls, [['preview', 'hours-1']]);
});

test('ordinary visits do not open a preview', () => {
  const f = fixture('');
  f.run(rows);
  assert.deepEqual(f.calls, []);
});

test('missing and blank targets warn without opening another record', () => {
  for (const query of ['hours=missing', 'hours=', 'hours=%20%20']) {
    const f = fixture(query);
    f.run(rows);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][0], 'warning');
    assert.match(f.calls[0][2], /当前展示范围/);
  }
});

test('an empty queue explains the missing record', () => {
  const f = fixture('hours=hours-1');
  f.run([]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], 'warning');
});

test('a disposed page does not open a preview', () => {
  const f = fixture('hours=hours-1', { disposed: true });
  f.run(rows);
  assert.deepEqual(f.calls, []);
});