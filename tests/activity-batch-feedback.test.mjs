import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { summarizeBatchResult } from '../public/app/console/batch-result.js';

const source = await readFile(
  new URL('../public/app/console/pages/activity-center.js', import.meta.url),
  'utf8',
);
const start = source.indexOf('async function batchRecords(e)');
const end = source.indexOf('function focusService(', start);
assert.ok(start >= 0 && end > start, '未找到批量确认函数');

function fixture(request, refreshed = true) {
  const selected = new Set(['a', 'b']);
  const drawers = [];
  const calls = [];
  const box = {
    batchConfirming: false,
    root: '/synthetic',
    data: {
      registrations: [
        { _id: 'a', 活动ID: 'event', 报名状态: '待筛选', 姓名: '合成甲' },
        { _id: 'b', 活动ID: 'event', 报名状态: '待筛选', 姓名: '合成乙' },
      ],
    },
    selectedRegistrations: selected,
    summarizeBatchResult,
    request: async (...args) => {
      calls.push(args);
      return request(...args);
    },
    refreshAfterWrite: async () => refreshed,
    notify: { info() {}, warning() {} },
    reportError(error) { throw error; },
    definitionList: rows => ({ rows }),
    notice: (message, options) => ({ message, options }),
    h: (...args) => ({ args }),
    panel: options => ({ options }),
    badge: (text, options) => ({ text, options }),
    button: options => ({ options }),
    openDrawer(options) {
      drawers.push(options);
      return { close() {} };
    },
  };
  vm.createContext(box);
  vm.runInContext(source.slice(start, end), box);

  return {
    selected,
    drawers,
    calls,
    run: () => box.batchRecords({
      活动ID: 'event',
      活动名称: '合成活动',
    }),
  };
}

test('only successful records are deselected and a result drawer is shown', async () => {
  const f = fixture(async () => ({
    results: [
      { id: 'a', ok: true },
      { id: 'b', ok: false, message: '名额不足' },
    ],
  }));
  await f.run();

  assert.deepEqual([...f.selected], ['b']);
  assert.equal(f.drawers.length, 1);
  assert.equal(f.drawers[0].title, '批量确认结果');
  assert.deepEqual(
    JSON.parse(JSON.stringify(f.drawers[0].body[0].rows)),
    [
      ['本次提交', '2 条'],
      ['已成功', '1 条'],
      ['未完成', '1 条'],
      ['待核对', '0 条'],
    ],
  );
});

test('lost responses preserve selections and report unknown outcomes', async () => {
  const f = fixture(async () => { throw new Error('synthetic outage'); });
  await f.run();

  assert.deepEqual([...f.selected], ['a', 'b']);
  const rows = f.drawers[0].body[0].rows;
  assert.equal(rows.find(row => row[0] === '待核对')[1], '2 条');
});

test('refresh failure does not undo confirmed success', async () => {
  const f = fixture(async () => ({
    results: [{ id: 'a', ok: true }, { id: 'b', ok: true }],
  }), false);
  await f.run();

  assert.equal(f.selected.size, 0);
  assert.ok(f.drawers[0].body.some(
    item => item.message?.includes('名单刷新失败'),
  ));
});

test('overlapping clicks send only one request', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));

  const first = f.run();
  await f.run();
  assert.equal(f.calls.length, 1);

  finish({
    results: [{ id: 'a', ok: true }, { id: 'b', ok: true }],
  });
  await first;
  assert.equal(f.drawers.length, 1);
});