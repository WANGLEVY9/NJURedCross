import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  summarizeRosterDraftResult,
} from '../public/app/console/batch-result.js';

const source = await readFile(
  new URL('../public/app/console/pages/activity-management.js', import.meta.url),
  'utf8',
);
const start = source.indexOf('async function apply(ids,');
const end = source.indexOf('let approve,reject;', start);
assert.ok(start >= 0 && end > start, '未找到新版批量处理函数');

function fixture(request, refresh = async () => true) {
  const selected = new Set(['a', 'b']);
  const drawers = [];
  const calls = [];
  const control = {};
  const box = {
    applying: false,
    root: '/synthetic',
    event: { _id: 'event', rosterToken: 'synthetic-token' },
    rows: [
      { _id: 'a', 姓名: '合成甲' },
      { _id: 'b', 姓名: '合成乙' },
    ],
    selected,
    summarizeRosterDraftResult,
    request: async (...args) => {
      calls.push(args);
      return request(...args);
    },
    refresh,
    runWithLoading: async (_control, task) => task(),
    notify: { info() {} },
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
    run: () => box.apply(['a', 'b'], 'confirm', '', control),
  };
}

test('saved drafts are deselected while unreported records remain selected', async () => {
  const f = fixture(async () => ({
    ok: true,
    result: { completed: ['a'] },
  }));
  await f.run();

  assert.deepEqual([...f.selected], ['b']);
  assert.equal(f.drawers[0].title, '报名处理结果');
  assert.ok(f.drawers[0].body.some(
    item => item.message?.includes('录取已保存'),
  ));
  assert.equal(f.calls[0][1].body.token, 'synthetic-token');
});

test('lost responses preserve selection and show unknown outcomes', async () => {
  const f = fixture(async () => { throw new Error('synthetic outage'); });
  await f.run();

  assert.deepEqual([...f.selected], ['a', 'b']);
  assert.equal(
    f.drawers[0].body[0].rows.find(row => row[0] === '待核对')[1],
    '2 人',
  );
});

test('refresh failure preserves saved acknowledgements', async () => {
  const f = fixture(
    async () => ({ ok: true, result: { completed: ['a', 'b'] } }),
    async () => { throw new Error('synthetic refresh failure'); },
  );
  await f.run();

  assert.equal(f.selected.size, 0);
  assert.ok(f.drawers[0].body.some(
    item => item.message?.includes('名单刷新失败'),
  ));
});

test('overlapping actions do not send a second request', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));

  const first = f.run();
  await f.run();
  assert.equal(f.calls.length, 1);

  finish({ ok: true, result: { completed: ['a', 'b'] } });
  await first;
  assert.equal(f.drawers.length, 1);
});
