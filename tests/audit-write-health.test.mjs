import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditWriteHealth } from '../lib/audit/write-health.js';

test('initial state does not claim persistence or successful writes', () => {
  const health = createAuditWriteHealth();

  assert.deepEqual(health.snapshot(), {
    scope: 'current-process',
    persistent: false,
    status: 'no-unconfirmed-writes',
    attempts: 0,
    confirmed: 0,
    unconfirmed: 0,
    lastConfirmedAt: null,
    lastUnconfirmedAt: null,
  });
});

test('successful writes update confirmation counters and timestamps', async () => {
  const health = createAuditWriteHealth({ now: () => 1000 });
  let calls = 0;

  const result = await health.write(async () => { calls++; });

  assert.equal(calls, 1);
  assert.deepEqual(result, { confirmed: true });
  assert.equal(health.snapshot().attempts, 1);
  assert.equal(health.snapshot().confirmed, 1);
  assert.equal(health.snapshot().unconfirmed, 0);
  assert.equal(
    health.snapshot().lastConfirmedAt,
    '1970-01-01T00:00:01.000Z',
  );
});

test('unconfirmed writes emit a fixed message without upstream details', async () => {
  const messages = [];
  const health = createAuditWriteHealth({
    now: () => 2000,
    log: message => messages.push(message),
  });

  const result = await health.write(async () => {
    throw new Error('synthetic-secret-upstream-detail');
  });

  assert.deepEqual(result, { confirmed: false });
  assert.deepEqual(messages, [
    'Audit write acknowledgement failed; reconciliation required.',
  ]);
  assert.equal(JSON.stringify(messages).includes('synthetic-secret'), false);
  assert.equal(health.snapshot().status, 'degraded');
  assert.equal(health.snapshot().unconfirmed, 1);
  assert.equal(
    health.snapshot().lastUnconfirmedAt,
    '1970-01-01T00:00:02.000Z',
  );
});

test('later success does not erase earlier unconfirmed writes', async () => {
  const health = createAuditWriteHealth({ log: () => {} });

  await health.write(async () => { throw new Error('synthetic-failure'); });
  await health.write(async () => {});

  const state = health.snapshot();
  assert.equal(state.attempts, 2);
  assert.equal(state.confirmed, 1);
  assert.equal(state.unconfirmed, 1);
  assert.equal(state.status, 'degraded');
});

test('logging failure does not propagate into the business action', async () => {
  const health = createAuditWriteHealth({
    log: () => { throw new Error('synthetic-log-failure'); },
  });

  assert.deepEqual(
    await health.write(async () => { throw new Error('synthetic-write-failure'); }),
    { confirmed: false },
  );
  assert.equal(health.snapshot().unconfirmed, 1);
});

test('overlapping writes remain visible until acknowledgement completes', async () => {
  const health = createAuditWriteHealth({ log: () => {} });
  let finish;
  const pending = health.write(
    () => new Promise(resolve => { finish = resolve; }),
  );

  await health.write(async () => { throw new Error('synthetic-failure'); });

  assert.equal(health.snapshot().attempts, 2);
  assert.equal(health.snapshot().confirmed, 0);
  assert.equal(health.snapshot().unconfirmed, 1);

  finish();
  await pending;

  assert.equal(health.snapshot().confirmed, 1);
  assert.equal(health.snapshot().unconfirmed, 1);
});

test('invalid operations are rejected without increasing counters', async () => {
  const health = createAuditWriteHealth();

  await assert.rejects(health.write(null), TypeError);
  assert.equal(health.snapshot().attempts, 0);
});