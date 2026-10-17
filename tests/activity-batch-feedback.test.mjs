import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { summarizeBatchResult } from '../public/app/console/batch-result.js';
import { activityProjectKey, projectEvents } from '../public/app/shared/activity-projects.js';

const source = await readFile(
  new URL('../public/app/console/pages/activity-center.js', import.meta.url),
  'utf8',
);
const start = source.indexOf('async function batchRecords(e)');
const end = source.indexOf('function focusService(', start);
assert.ok(start >= 0 && end > start, '未找到批量确认函数');
const helpersStart = source.indexOf('function legacyRosterState(e)');
const helpersEnd = source.indexOf('function showRecords(', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, '未找到报名筛选函数');

function fixture(request, refreshed = true) {
  const event = { _id: 'event', 活动ID: 'event', 活动名称: '合成活动', 报名日期: '2030-10-17', 报名时段: '09:00-12:00', 岗位: '引导', 报名页配置: '{"ordinary":{"groupId":"synthetic-group"}}' };
  const drawers = [];
  const calls = [];
  const box = {
    batchConfirming: false,
    root: '/synthetic',
    serviceStates: new Map(),
    activityProjectKey,
    data: {
      events: [event, { ...event, _id: 'second', 活动ID: 'second', 报名日期: '2030-10-18', 岗位: '后勤' }],
      registrations: [
        { _id: 'a', 活动ID: 'event', 报名状态: '待筛选', 姓名: '合成甲', 学号: 'TEST-A' },
        { _id: 'b', 活动ID: 'second', 报名状态: '待筛选', 姓名: '合成乙', 学号: 'TEST-B' },
      ],
    },
    scopedRows: (rows, event) => {
      const ids = new Set(projectEvents(box.data.events, event).map(row => row['活动ID']));
      return rows.filter(row => ids.has(row['活动ID']));
    },
    summarizeBatchResult,
    request: async (...args) => {
      calls.push(args);
      return request(...args);
    },
    refreshAfterWrite: async () => refreshed,
    renderDetail: async () => {},
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
  vm.runInContext(source.slice(helpersStart, helpersEnd), box);
  vm.runInContext(source.slice(start, end), box);
  const state = box.legacyRosterState(event), selected = state.selected;
  selected.add('a'); selected.add('b');

  return {
    state,
    data: box.data,
    selected,
    drawers,
    calls,
    run: () => box.batchRecords(event),
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
    JSON.parse(JSON.stringify(f.drawers[0].body.find(item => item.rows).rows)),
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
  const rows = f.drawers[0].body.find(item => item.rows).rows;
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

test('batch uses actual date, position, session, status and search predicates before sending', async () => {
  for (const filters of [{ date: '2030-10-17' }, { position: '引导' }, { session: 'event' }, { search: 'test-a' }, { search: '合成甲' }, { date: '2030-10-17', position: '引导', session: 'event', status: '待筛选' }]) {
    const f = fixture(async () => ({ results: [{ id: 'a', ok: true }] }));
    Object.assign(f.state, filters);
    await f.run();
    assert.deepEqual([...f.calls[0][1].body.ids], ['a']);
    assert.deepEqual([...f.selected], ['b']);
  }
});

test('ineligible, hidden and other-project selections never enter a batch', async () => {
  for (const excluded of [{ 报名状态: '已确认' }, { 请假状态: '待审批' }, { 活动ID: 'outside-project' }]) {
    const f = fixture(async () => ({ results: [{ id: 'a', ok: true }] }));
    Object.assign(f.data.registrations[1], excluded);
    await f.run();
    assert.deepEqual([...f.calls[0][1].body.ids], ['a']);
  }
  for (const filters of [{ status: '已确认' }, { status: 'leave' }, { search: '不存在' }]) {
    const f = fixture(async () => assert.fail('empty filter must not write'));
    Object.assign(f.state, filters);
    await f.run();
    assert.equal(f.calls.length, 0);
    assert.equal(f.drawers.length, 0);
  }
});

test('retry after partial failure sends only the remaining eligible selected registration', async () => {
  let attempt = 0;
  const f = fixture(async () => ++attempt === 1
    ? { results: [{ id: 'a', ok: true }, { id: 'b', ok: false, message: '合成冲突' }] }
    : { results: [{ id: 'b', ok: true }] });
  await f.run();
  assert.deepEqual([...f.selected], ['b']);
  await f.run();
  assert.deepEqual([...f.calls[1][1].body.ids], ['b']);
  assert.equal(f.selected.size, 0);
  assert.equal(f.drawers.length, 2);
});
