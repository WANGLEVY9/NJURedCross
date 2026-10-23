import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow, WF } from '../lib/events/workflow.js';
import { createOrdinaryPlaces, PLACE_TABLE } from '../lib/events/ordinary-places.js';

const person = i => ({accountId: `person-${i}`, studentId: `99999000${i}`, email: `99999000${i}@smail.nju.edu.cn`, realName: `合成${i}`, emailVerified: true});

/**
 * 内存 Base：默认提供批量接口，便于断言"整批一次提交"；
 * 关掉批量或让批量抛错时，应自动退回逐行写入且结果不变。
 */
function base({batched = true, failBatch = false} = {}) {
  const rows = Object.fromEntries(Object.values(WF).map(table => [table, []]));
  rows[PLACE_TABLE] = [];
  const calls = {updateRow: 0, appendRow: 0, batchUpdateRows: 0, batchAppendRows: 0};
  const store = {
    rows,
    calls,
    async listRows(table, _view, _order, _direction, start = 0, limit = 500) {
      return (rows[table] || []).slice(start, start + limit);
    },
    async getRow(table, id) {
      return (rows[table] || []).find(row => row._id === id) || null;
    },
    async updateRow(table, id, values) {
      calls.updateRow += 1;
      const row = (rows[table] || []).find(item => item._id === id);
      if (row) Object.assign(row, values);
      return row || {_id: id};
    },
    async appendRow(table, values) {
      calls.appendRow += 1;
      const row = {_id: `${table}-${calls.appendRow}`, ...values};
      (rows[table] ||= []).push(row);
      return row;
    },
  };
  // 批量接口内部直接落库，不计入"逐行写入"次数，便于断言真正的逐行回退。
  const writeRow = async (table, id, values) => {
    const row = (rows[table] || []).find(item => item._id === id);
    if (row) Object.assign(row, values);
    return row || {_id: id};
  };
  if (batched) {
    store.batchUpdateRows = async (table, updates) => {
      calls.batchUpdateRows += 1;
      if (failBatch) throw new Error('synthetic batch interruption');
      for (const update of updates) {
        if (!update.row_id) throw new Error('missing row id');
        await writeRow(table, update.row_id, update.row);
      }
      return {success: updates.map(update => update.row_id), failed: []};
    };
    store.batchAppendRows = async (table, list) => {
      calls.batchAppendRows += 1;
      if (failBatch) throw new Error('synthetic batch interruption');
      for (const values of list) await store.appendRow(table, values);
      return {inserted_row_count: list.length};
    };
  }
  return store;
}

async function published(workflow, extra = {}) {
  const draft = {name: '10.12 合成活动', date: '2026-10-12', slot: '09:00-12:00', capacity: 5, registrationLimit: 5, serviceHours: 3, location: '南京合成场地', work: '志愿者引导', content: '内容', center: '生命中心', ...extra};
  const created = await workflow.create(draft, 'owner');
  await workflow.approve(created._id, 'reviewer');
  await workflow.publish(created._id);
  return created;
}

test('roster decisions submit one batch update instead of one request per person', async () => {
  const store = base();
  const workflow = createWorkflow(store, {now: () => Date.parse('2026-10-06T00:00:00+08:00')});
  const event = await published(workflow);
  const people = [1, 2, 3].map(i => person(i));
  const registrations = [];
  for (const p of people) registrations.push(await workflow.register(event._id, p));

  const result = await workflow.batchDecide(event._id, registrations.map(r => r._id), 'confirm');
  assert.equal(result.completed.length, 3);
  assert.equal(store.calls.batchUpdateRows, 1);
  // 审批/发布各有一次活动行写入；名单本身不再逐行提交。
  assert.equal(store.calls.updateRow, 2);
  assert.equal(store.rows[WF.registrations].filter(row => row['报名状态'] === '已确认').length, 3);
});

test('a failed batch update falls back to row writes and still reports progress', async () => {
  const store = base({failBatch: true});
  const workflow = createWorkflow(store, {now: () => Date.parse('2026-10-06T00:00:00+08:00')});
  const event = await published(workflow);
  const registrations = [await workflow.register(event._id, person(1)), await workflow.register(event._id, person(2))];

  await workflow.batchDecide(event._id, registrations.map(r => r._id), 'confirm');
  assert.equal(store.calls.batchUpdateRows, 1);
  assert.ok(store.calls.updateRow >= 2, 'row writes must take over');
  assert.equal(store.rows[WF.registrations].filter(row => row['报名状态'] === '已确认').length, 2);
});

test('seat reconciliation writes in batches and reads back only the touched seats', async () => {
  const store = base();
  store.query = async sql => {
    const ids = [...sql.matchAll(/'([^']+)'/g)].map(match => match[1]);
    return store.rows[PLACE_TABLE].filter(row => ids.includes(String(row['名额ID'])));
  };
  const places = createOrdinaryPlaces(store, {now: () => Date.parse('2026-10-06T00:00:00+08:00')});
  const events = [{_id: 'e1', 活动ID: 'WF-1', 活动名称: '合成多班次', 容量: '3', 报名日期: '2026-10-12', 地点: '仙林', 报名时段: '09:00-12:00', 岗位: '默认服务岗', 报名页配置: JSON.stringify({ordinary: {groupId: 'g1', start: '2026-10-12T09:00:00+08:00', end: '2026-10-12T12:00:00+08:00'}})}];
  const registrations = [{_id: 'r1', 报名ID: 'B1', 活动ID: 'WF-1', 报名状态: '待筛选'}];

  const first = await places.reconcile(events, registrations);
  assert.equal(first.changed, 3);
  assert.equal(store.calls.batchAppendRows, 1);
  assert.equal(store.calls.appendRow, 3);
  assert.equal(store.rows[PLACE_TABLE].length, 3);
  assert.equal(first.remaining, 0);

  // Idempotent: a second pass changes nothing and does not re-read the whole table.
  const second = await places.reconcile(events, registrations);
  assert.equal(second.changed, 0);
  assert.equal(store.rows[PLACE_TABLE].length, 3);
});
