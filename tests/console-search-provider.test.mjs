import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { taskRoute } from '../public/app/console/task-route.js';

const source = await readFile(
  new URL('../public/app/console/shell.js', import.meta.url),
  'utf8',
);
const start = source.indexOf('registerSearchProvider(async (query) => {');
const end = source.indexOf('  registerCommands(', start);
assert.ok(start >= 0 && end > start, '未找到管理端搜索提供器');

function fixture(payload, scopes = ['materials', 'events', 'outreach', 'community']) {
  let provider;
  let user = { username: 'synthetic-admin', permissions: scopes };
  const allowed = new Set(scopes);
  const queries = [];
  const navigations = [];
  const box = {
    registerSearchProvider(value) {
      provider = value;
    },
    getSessionState: () => ({ user }),
    consoleApi: {
      search: async (query) => {
        queries.push(query);
        return typeof payload === 'function' ? payload() : payload;
      },
    },
    hasPermission: (scope) => allowed.has(scope),
    taskRoute,
    navigate: (href) => navigations.push(href),
  };

  vm.createContext(box);
  vm.runInContext(source.slice(start, end), box);

  return {
    queries,
    navigations,
    search: (query) => provider(query),
    changeUser(value) {
      user = value;
    },
  };
}

test('passes the search text to the business API', async () => {
  const f = fixture({ items: [] });
  await f.search('合成关键词');
  assert.deepEqual(f.queries, ['合成关键词']);
});

test('results use the existing detail routes', async () => {
  const records = [
    {
      id: 'inventory:a', title: '合成物资', view: 'materials',
      target: { kind: 'inventory', id: 'asset-a' },
    },
    {
      id: 'event:a', title: '合成活动', view: 'activities',
      target: { kind: 'event', id: 'event-a' },
    },
    {
      id: 'submission:a', title: '合成投稿', view: 'outreach',
      target: { kind: 'submission', id: 'submission-a' },
    },
    {
      id: 'interest:a', title: '合成登记', view: 'community',
      target: { kind: 'interest', id: 'interest-a', program: 'morning' },
    },
  ];
  const f = fixture({ items: records });
  const result = await f.search('合成');
  assert.equal(result.items.length, records.length);

  for (let index = 0; index < records.length; index++) {
    result.items[index].run();
    assert.equal(f.navigations[index], taskRoute(records[index]));
    assert.equal(result.items[index].group, '业务记录');
  }
});

test('records from modules without current permission are hidden', async () => {
  const f = fixture({
    items: [
      { id: 'allowed', title: '合成物资', view: 'materials' },
      { id: 'denied', title: '合成内建记录', view: 'community' },
      { id: 'unknown', title: '合成未知记录', view: 'unknown' },
    ],
  }, ['materials']);
  const result = await f.search('合成');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, '合成物资');
});

test('partial results retain unavailable and coverage guidance', async () => {
  const f = fixture({
    items: [{ id: 'visible', title: '合成物资', view: 'materials' }],
    unavailable: ['outreach'],
    truncated: true,
  });
  const result = await f.search('合成');
  assert.equal(result.items.length, 1);
  assert.match(result.message, /部分模块暂时无法读取/);
  assert.match(result.message, /当前可检索范围/);
});

test('responses from an earlier account are discarded', async () => {
  let resolveResponse;
  const response = new Promise((resolve) => { resolveResponse = resolve; });
  const f = fixture(() => response);
  const pending = f.search('合成');

  f.changeUser({ username: 'another-admin', permissions: [] });
  resolveResponse({
    items: [{ id: 'old', title: '旧账号合成记录', view: 'materials' }],
  });

  const result = await pending;
  assert.equal(result.items.length, 0);
  assert.match(result.message, /账号或权限已变化/);
});

test('permission changes during a search discard its response', async () => {
  let resolveResponse;
  const response = new Promise((resolve) => { resolveResponse = resolve; });
  const f = fixture(() => response);
  const pending = f.search('合成');

  f.changeUser({
    username: 'synthetic-admin',
    permissions: ['outreach'],
  });
  resolveResponse({
    items: [{ id: 'old', title: '旧权限合成记录', view: 'materials' }],
  });

  const result = await pending;
  assert.equal(result.items.length, 0);
  assert.match(result.message, /账号或权限已变化/);
});