import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../public/app/console/pages/activity-center.js', import.meta.url),
  'utf8',
);
const start = source.indexOf(' function resolveSourceTaskTarget() {');
const end = source.indexOf('\n let sessionDetail=', start);
assert.ok(start >= 0 && end > start, '未找到活动来源定位函数');

function fixture(query = 'source=managed%3Asynthetic-1') {
  const warnings = [];
  const box = {
    context: { query: new URLSearchParams(query) },
    sourceTargetHandled: false,
    sessionDetail: false,
    data: { events: [], sources: [], sourcesLoading: false },
    selected: '',
    mode: 'sources',
    tab: 'overview',
    area: 'suzhou',
    category: '旧类别',
    search: '旧搜索',
    config: (row) => row.config || {},
    patchQuery() {},
    notify: {
      warning(title) {
        warnings.push(title);
      },
    },
    modeControl: { setValue() {} },
    areaControl: { control: { value: 'suzhou' } },
    categoryControl: { control: { value: '旧类别' } },
    searchInput: { setValue() {} },
  };

  vm.createContext(box);
  vm.runInContext(source.slice(start, end), box);

  return {
    box,
    warnings,
    run(data) {
      box.data = data;
      box.resolveSourceTaskTarget();
    },
  };
}

const event = {
  _id: 'workflow-1',
  状态: '草稿',
  config: { source: { key: 'managed:synthetic-1' } },
};
const sourceRow = { key: 'managed:synthetic-1' };

test('configured activities open the matching publication view', () => {
  const f = fixture();
  f.run({ events: [event], sources: [], sourcesLoading: true });
  assert.equal(f.box.selected, 'workflow-1');
  assert.equal(f.box.mode, 'all');
  assert.equal(f.box.tab, 'publish');
  assert.equal(f.box.area, 'all');
  assert.equal(f.box.category, '');
  assert.equal(f.box.search, '');
});

test('unconfigured sources open their configuration entry', () => {
  const f = fixture();
  f.run({ events: [], sources: [sourceRow], sourcesLoading: false });
  assert.equal(f.box.selected, sourceRow.key);
  assert.equal(f.box.mode, 'sources');
  assert.equal(f.box.tab, 'overview');
});

test('slow sources remain pending and resolve after loading', () => {
  const f = fixture();
  f.run({ events: [], sources: [], sourcesLoading: true });
  assert.equal(f.box.sourceTargetHandled, false);
  assert.deepEqual(f.warnings, []);

  f.run({ events: [], sources: [sourceRow], sourcesLoading: false });
  assert.equal(f.box.selected, sourceRow.key);
});

test('failed source reads remain pending for a successful refresh', () => {
  const f = fixture();
  f.run({
    events: [],
    sources: [],
    sourcesLoading: false,
    sourceError: true,
  });
  assert.equal(f.box.sourceTargetHandled, false);

  f.run({ events: [event], sources: [sourceRow], sourcesLoading: false });
  assert.equal(f.box.selected, 'workflow-1');
  assert.deepEqual(f.warnings, []);
});

test('archived activities open in the recycle bin overview', () => {
  const f = fixture();
  f.run({
    events: [{ ...event, 状态: '已归档' }],
    sources: [],
    sourcesLoading: false,
  });
  assert.equal(f.box.mode, 'trash');
  assert.equal(f.box.tab, 'overview');
});

test('missing and invalid targets warn without selecting another activity', () => {
  for (const query of [
    'source=',
    'source=managed%3A',
    'source=wrong%3Asynthetic-1',
    'source=managed%3Amissing',
  ]) {
    const f = fixture(query);
    f.run({ events: [event], sources: [sourceRow], sourcesLoading: false });
    assert.equal(f.box.selected, '');
    assert.equal(f.warnings.length, 1);
  }
});

test('resolved targets do not override a later manual selection', () => {
  const f = fixture();
  const data = { events: [event], sources: [], sourcesLoading: false };
  f.run(data);
  f.box.selected = 'manually-selected';
  f.run(data);
  assert.equal(f.box.selected, 'manually-selected');
});

test('ordinary visits do not change the current selection', () => {
  const f = fixture('');
  f.box.selected = 'existing-selection';
  f.run({ events: [event], sources: [], sourcesLoading: false });
  assert.equal(f.box.selected, 'existing-selection');
  assert.deepEqual(f.warnings, []);
});