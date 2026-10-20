import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdleGate } from '../lib/background/idle-gate.js';

test('background work waits while a user is interacting', () => {
  let now = 1_000;
  const gate = createIdleGate({ minIdleMs: 1_000, maxDelayMs: 10_000, now: () => now });
  assert.equal(gate.allow(), true, '首次运行不受让路规则限制');

  now = 2_000;
  gate.mark();
  now = 2_500;
  assert.equal(gate.allow(), false, '用户刚刚发起请求时后台让路');

  now = 4_000;
  assert.equal(gate.allow(), true, '空闲窗口结束后恢复运行');
});

test('a long queue is never starved by continuous traffic', () => {
  let now = 1_000;
  const gate = createIdleGate({ minIdleMs: 5_000, maxDelayMs: 10_000, now: () => now });
  gate.allow();
  for (let step = 0; step < 12; step += 1) {
    now += 1_000;
    gate.mark();
  }
  assert.equal(gate.allow(), true, '积压超过上限后强制执行');
});

test('invalid configuration is rejected instead of silently ignoring the gate', () => {
  assert.throws(() => createIdleGate({ minIdleMs: -1 }), TypeError);
  assert.throws(() => createIdleGate({ maxDelayMs: 0 }), TypeError);
});
