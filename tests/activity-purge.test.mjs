import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PURGE_TABLES,
  activityIdSet,
  collectActivityRecords,
  purgeActivityRecords,
} from '../lib/events/activity-purge.js';

const row = (id, extra = {}) => ({ _id: id, ...extra });

test('collect gathers registrations of the target activity only', () => {
  const plan = collectActivityRecords({
    activityIds: ['A-1'],
    registrations: [
      row('r1', { 活动ID: 'A-1' }),
      row('r2', { 活动ID: 'A-2' }),
      row('r3', { 活动ID: 'A-1' }),
    ],
  });
  assert.deepEqual(plan.registrations.map((item) => item._id), ['r1', 'r3']);
  assert.equal(plan.totals.registrations, 2);
});

test('checkins and ledger are caught by 报名行ID even when 活动ID is missing', () => {
  const plan = collectActivityRecords({
    activityIds: ['A-1'],
    registrations: [row('r1', { 活动ID: 'A-1' })],
    checkins: [
      row('c1', { 报名行ID: 'r1' }),
      row('c2', { 活动ID: 'A-1' }),
      row('c9', { 报名行ID: 'r-other', 活动ID: 'A-2' }),
    ],
    ledger: [
      row('l1', { 报名行ID: 'r1' }),
      row('l2', { 签到行ID: 'c1' }),
      row('l9', { 活动ID: 'A-2' }),
    ],
  });
  assert.deepEqual(plan.checkins.map((item) => item._id), ['c1', 'c2']);
  assert.deepEqual(plan.ledger.map((item) => item._id), ['l1', 'l2']);
});

test('ledger hours count approved rows only and are rounded to cents', () => {
  const plan = collectActivityRecords({
    activityIds: ['A-1'],
    registrations: [row('r1', { 活动ID: 'A-1' })],
    ledger: [
      row('l1', { 报名行ID: 'r1', 状态: '已入账', 服务时长: '2.5', 培训时长: '0.5' }),
      row('l2', { 报名行ID: 'r1', 状态: '已批准', 服务时长: '1', 交通时长: '0.25' }),
      row('l3', { 报名行ID: 'r1', 状态: '待核对', 服务时长: '9' }),
    ],
  });
  assert.equal(plan.totals.ledger, 3);
  assert.equal(plan.totals.hours, 4.25);
});

test('wishlist and notification tasks follow the activity id', () => {
  const plan = collectActivityRecords({
    activityIds: ['A-1'],
    wishlist: [row('w1', { 活动ID: 'A-1' }), row('w2', { 活动ID: 'A-2' })],
    notifications: [
      row('n1', { 活动ID: 'A-1' }),
      row('n2', { 活动ID: '' }),
    ],
  });
  assert.deepEqual(plan.notifications.map((item) => item._id), ['n1']);
  assert.deepEqual(plan.wishlist.map((item) => item._id), ['w1']);
});

test('an empty activity set never matches anything', () => {
  const plan = collectActivityRecords({
    activityIds: [],
    registrations: [row('r1', { 活动ID: 'A-1' })],
    ledger: [row('l1', { 活动ID: 'A-1' })],
  });
  assert.equal(plan.registrations.length, 0);
  assert.equal(plan.ledger.length, 0);
  assert.deepEqual(plan.totals, { ledger: 0, checkins: 0, registrations: 0, wishlist: 0, notifications: 0, hours: 0 });
});

test('activityIdSet keeps extra source mapping ids and drops blanks', () => {
  const ids = activityIdSet([{ 活动ID: 'A-1' }, { 活动ID: '' }, {}], ['A-2', ' ', null]);
  assert.deepEqual([...ids].sort(), ['A-1', 'A-2']);
});

test('purge deletes leaf tables first and reports per-table counts', async () => {
  const calls = [];
  const plan = collectActivityRecords({
    activityIds: ['A-1'],
    registrations: [row('r1', { 活动ID: 'A-1' })],
    checkins: [row('c1', { 报名行ID: 'r1' })],
    ledger: [row('l1', { 报名行ID: 'r1', 账号ID: 'acc-1', 状态: '已入账', 服务时长: '3' })],
    notifications: [row('n1', { 活动ID: 'A-1' })],
  });
  const counts = await purgeActivityRecords({
    client: {},
    plan,
    deleteRows: async (client, table, ids) => { calls.push([table, ids]); },
  });
  assert.deepEqual(calls.map(([table]) => table), [
    PURGE_TABLES.ledger, PURGE_TABLES.checkins, PURGE_TABLES.registrations, PURGE_TABLES.notifications,
  ]);
  // accounts 用于事后重算汇总表；顺序按出现顺序，去重后返回。
  assert.deepEqual(counts, { ledger: 1, checkins: 1, registrations: 1, wishlist: 0, notifications: 1, hours: 3, accounts: ['acc-1'] });
});

test('purge reports every account whose hours were removed, without duplicates', async () => {
  const plan = collectActivityRecords({
    activityIds: ['A-1'],
    registrations: [row('r1', { 活动ID: 'A-1' })],
    ledger: [
      row('l1', { 报名行ID: 'r1', 账号ID: 'acc-1', 状态: '已入账', 服务时长: '1' }),
      row('l2', { 报名行ID: 'r1', 账号ID: 'acc-2', 状态: '已批准', 服务时长: '2' }),
      row('l3', { 报名行ID: 'r1', 账号ID: 'acc-1', 状态: '待核对', 服务时长: '9' }),
      row('l4', { 报名行ID: 'r1', 账号ID: '', 状态: '已入账', 服务时长: '5' }),
    ],
  });
  const counts = await purgeActivityRecords({ client: {}, plan, deleteRows: async () => {} });
  assert.deepEqual(counts.accounts, ['acc-1', 'acc-2']);
  // 空账号同样计时长（1+2+5），只是无法回传重算目标。
  assert.equal(counts.hours, 8);
});

test('purge skips empty tables instead of issuing no-op deletes', async () => {
  const calls = [];
  await purgeActivityRecords({
    client: {},
    plan: collectActivityRecords({ activityIds: ['A-1'] }),
    deleteRows: async (client, table) => { calls.push(table); },
  });
  assert.deepEqual(calls, []);
});

test('purge refuses to run without a data source', async () => {
  await assert.rejects(
    purgeActivityRecords({ client: null, plan: collectActivityRecords({ activityIds: ['A-1'] }) }),
    { statusCode: 503 },
  );
});
