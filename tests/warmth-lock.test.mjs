import { deleteRows } from '../lib/http/batch-write.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';
import { readCommunityRows } from '../lib/community/scoped-rows.js';

const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');

function createHarness() {
  const state = { rows: [], nextId: 0, nextLock: 0, failLockReads: 0, lockReads: 0 };
  const snapshot = () => state.rows.map((row) => ({ ...row }));
  const client = {
    async appendRow(table, row) {
      assert.equal(table, '温暖连接操作锁表');
      const _id = `row-${++state.nextId}`;
      state.rows.push({ _id, ...row });
      return { _id };
    },
    async updateRow(table, id, patch) {
      assert.equal(table, '温暖连接操作锁表');
      const row = state.rows.find((item) => item._id === id);
      if (!row) throw new Error(`row not found: ${id}`);
      Object.assign(row, patch);
      return row;
    },
    async deleteRow(table, id) {
      assert.equal(table, '温暖连接操作锁表');
      const index = state.rows.findIndex((item) => item._id === id);
      if (index >= 0) state.rows.splice(index, 1);
      return true;
    },
  };
  const readLocks = async (_client, table) => {
    assert.equal(table, '温暖连接操作锁表');
    state.lockReads++;
    if (state.failLockReads > 0) {
      state.failLockReads--;
      throw new Error('synthetic lock table outage');
    }
    return snapshot();
  };
  const context = vm.createContext({
    deleteRows,
    scopedWarmthRows: (base, table, filter) => readCommunityRows(base, table, filter, readLocks),
    warmthLockTable: '温暖连接操作锁表',
    WARMTH_LOCK_ACTIVE: '锁定',
    WARMTH_LOCK_RELEASED: '已释放',
    stateRows: async (_client, table) => {
      assert.equal(table, '温暖连接操作锁表');
      return snapshot();
    },
    warmthRows: async (_client, table) => {
      assert.equal(table, '温暖连接操作锁表');
      state.lockReads += 1;
      if (state.failLockReads > 0) {
        state.failLockReads -= 1;
        throw new Error('synthetic lock table outage');
      }
      return snapshot();
    },
    withKeyedLock: async (_key, task) => task(),
    randomBytes,
    process,
    isProduction: process.env.NODE_ENV === 'production',
    setTimeout,
    setInterval,
    clearInterval,
    Date,
    console,
    eventIdentifier: (prefix) => `${prefix}-${++state.nextLock}`,
    httpError: (status, message) => Object.assign(new Error(message), { statusCode: status }),
  });
  const start = server.indexOf('async function delay');
  const end = server.indexOf('function assertPublicEmail');
  assert.ok(start >= 0 && end > start, 'warmth lock helper block missing');
  vm.runInContext(`${server.slice(start, end)}\nglobalThis.withWarmthLock = withWarmthLock;`, context);
  return { context, client, state };
}

test('生日祝福租约锁跨任务互斥并在完成后释放', async () => {
  const { context, client, state } = createHarness();
  let active = 0;
  let maxActive = 0;
  const task = () => context.withWarmthLock(client, 'warmth-submit:test', async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 35));
    active -= 1;
  });
  await Promise.all([task(), task()]);
  assert.equal(maxActive, 1, 'two birthday tasks entered the same critical section');
  assert.equal(active, 0, 'critical section did not finish');
  assert.equal(state.rows.filter((row) => row['状态'] === '锁定').length, 0, 'lock lease was not released');
  assert.equal(state.rows.length, 2, 'one lease row per successful claim expected');
});

test('生日租约条件查询只读取当前锁键，并在临界区前重新读取', async () => {
  const { context, client, state } = createHarness();
  state.rows.push({ _id: 'unrelated', 锁键: 'other', 状态: '锁定', 过期时间: '2099-01-01' });
  const queries = [];
  client.query = async sql => {
    queries.push(sql);
    assert.match(sql, /FROM `温暖连接操作锁表` WHERE \(`锁键` IN \('warmth-submit:target'\)\)/);
    return state.rows.filter(row => row['锁键'] === 'warmth-submit:target').map(row => ({ ...row }));
  };
  let entered = false;
  await context.withWarmthLock(client, 'warmth-submit:target', async () => { entered = true; });
  assert.equal(entered, true);
  assert.ok(queries.length >= 3);
  assert.equal(state.lockReads, 0, 'SQL-capable client must not use the complete-table fallback');
  assert.equal(state.rows.find(row => row._id === 'unrelated')['状态'], '锁定');
  assert.equal(state.rows.find(row => row['锁键'] === 'warmth-submit:target')['状态'], '已释放');
});

test('锁表短暂不可用后按重试间隔恢复跨进程锁', async () => {
  const previousRetry = process.env.WARMTH_LOCK_RETRY_MS;
  process.env.WARMTH_LOCK_RETRY_MS = '1';
  try {
    const { context, client, state } = createHarness();
    state.failLockReads = 1;
    let firstTask = 0;
    await context.withWarmthLock(client, 'warmth-submit:retry', async () => { firstTask += 1; });
    assert.equal(firstTask, 1, 'fallback task should still run once');
    assert.equal(state.rows.length, 0, 'failed lock-table read must not create a lease');

    await new Promise((resolve) => setTimeout(resolve, 5));
    let secondTask = 0;
    await context.withWarmthLock(client, 'warmth-submit:retry', async () => { secondTask += 1; });
    assert.equal(secondTask, 1, 'retry should execute the task');
    assert.equal(state.lockReads >= 3, true, 'lock table should be retried after the retry interval');
  } finally {
    if (previousRetry === undefined) delete process.env.WARMTH_LOCK_RETRY_MS;
    else process.env.WARMTH_LOCK_RETRY_MS = previousRetry;
  }
});

test('生产要求锁表可用时拒绝静默降级', async () => {
  const previousRequired = process.env.WARMTH_LOCK_REQUIRED;
  process.env.WARMTH_LOCK_REQUIRED = 'true';
  try {
    const { context, client, state } = createHarness();
    state.failLockReads = 1;
    await assert.rejects(
      context.withWarmthLock(client, 'warmth-submit:required', async () => {}),
      /温暖连接操作锁表不可用/,
    );
    assert.equal(state.rows.length, 0, 'required lock failure must not execute the task');
  } finally {
    if (previousRequired === undefined) delete process.env.WARMTH_LOCK_REQUIRED;
    else process.env.WARMTH_LOCK_REQUIRED = previousRequired;
  }
});
