import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../public/app/console/pages/materials.js', import.meta.url),
  'utf8',
);
const start = source.indexOf('  function tableStateOptions(');
const end = source.indexOf('  function renderInventory(', start);
assert.ok(start >= 0 && end > start, '未找到表格状态函数');

function fixture(search = '') {
  const location = { search };
  const box = {
    location,
    URLSearchParams,
    patchQuery(patch) {
      const query = new URLSearchParams(location.search);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === '') {
          query.delete(key);
        } else {
          query.set(key, String(value));
        }
      }
      location.search = `?${query.toString()}`;
    },
  };
  vm.createContext(box);
  vm.runInContext(source.slice(start, end), box);
  return {
    options: (kind, fallback) => box.tableStateOptions(kind, fallback),
    query: () => new URLSearchParams(location.search),
  };
}

test('saved search and valid sort are restored', () => {
  const f = fixture('?inventoryQuery=纸&inventorySort=name&inventoryDirection=desc');
  const state = f.options('inventory');
  assert.equal(state.initialQuery, '纸');
  assert.equal(state.initialSort.key, 'name');
  assert.equal(state.initialSort.direction, 'desc');
});

test('invalid or nonsortable keys fall back to the default', () => {
  const fallback = { key: 'quantity', direction: 'asc' };
  for (const search of [
    '?inventorySort=health&inventoryDirection=asc',
    '?inventorySort=name&inventoryDirection=invalid',
    '?inventorySort=unknown&inventoryDirection=desc',
  ]) {
    assert.equal(fixture(search).options('inventory', fallback).initialSort, fallback);
  }
});

test('each list preserves the other lists and active tab', () => {
  const f = fixture('?tab=inventory&applicationsQuery=申请人');
  f.options('inventory').onStateChange({
    query: '纸',
    sort: { key: 'name', direction: 'asc' },
  });
  assert.equal(f.query().get('inventoryQuery'), '纸');
  assert.equal(f.query().get('applicationsQuery'), '申请人');
  assert.equal(f.query().get('tab'), 'inventory');
  assert.equal(f.options('applications').initialQuery, '申请人');
});

test('clearing search removes the saved value', () => {
  const f = fixture('?inventoryQuery=纸');
  f.options('inventory').onStateChange({ query: '', sort: null });
  assert.equal(f.query().has('inventoryQuery'), false);
  assert.equal(f.options('inventory').initialQuery, '');
});

test('special characters round-trip without adding query parameters', () => {
  const f = fixture('?tab=flows');
  const text = '物资 A&tab=tasks#备注';
  f.options('flows').onStateChange({
    query: text,
    sort: { key: 'date', direction: 'desc' },
  });
  assert.equal(f.options('flows').initialQuery, text);
  assert.equal(f.query().get('tab'), 'flows');
  assert.equal(f.query().get('flowsSort'), 'date');
});

test('manual filtering clears old detail targets', () => {
  const f = fixture('?application=row-a&inventory=row-b');
  f.options('applications').onStateChange({
    query: '测试',
    sort: { key: 'plannedReturnDate', direction: 'asc' },
  });
  assert.equal(f.query().has('application'), false);
  assert.equal(f.query().has('inventory'), false);
});