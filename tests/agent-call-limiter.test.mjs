import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentCallLimiter,
} from '../lib/agent/call-limiter.js';

test('accounts have independent call allowances', () => {
  const limiter = createAgentCallLimiter({ maximumCalls: 1 });

  limiter.acquire('synthetic-a')();

  assert.throws(
    () => limiter.acquire('synthetic-a'),
    { statusCode: 429, code: 'agent_call_limit' },
  );

  limiter.acquire('synthetic-b')();
});

test('expired windows restore the call allowance', () => {
  let timestamp = 0;
  const limiter = createAgentCallLimiter({
    maximumCalls: 1,
    windowMs: 100,
    now: () => timestamp,
  });

  limiter.acquire('synthetic-a')();
  timestamp = 99;
  assert.throws(() => limiter.acquire('synthetic-a'));

  timestamp = 100;
  limiter.acquire('synthetic-a')();
});

test('one account cannot exceed its concurrent limit', () => {
  const limiter = createAgentCallLimiter();
  const release = limiter.acquire('synthetic-a');

  assert.throws(
    () => limiter.acquire('synthetic-a'),
    { statusCode: 429, code: 'agent_account_busy' },
  );

  release();
  limiter.acquire('synthetic-a')();
});

test('global concurrency is released only once', () => {
  const limiter = createAgentCallLimiter({
    maximumConcurrent: 1,
  });
  const release = limiter.acquire('synthetic-a');

  assert.throws(
    () => limiter.acquire('synthetic-b'),
    { statusCode: 429, code: 'agent_service_busy' },
  );

  release();
  release();

  const releaseB = limiter.acquire('synthetic-b');
  assert.throws(() => limiter.acquire('synthetic-c'));
  releaseB();
  limiter.acquire('synthetic-c')();
});

test('rejected concurrent requests do not consume allowance', () => {
  const limiter = createAgentCallLimiter({ maximumCalls: 2 });
  const release = limiter.acquire('synthetic-a');

  assert.throws(() => limiter.acquire('synthetic-a'));
  release();

  limiter.acquire('synthetic-a')();
  assert.throws(
    () => limiter.acquire('synthetic-a'),
    { code: 'agent_call_limit' },
  );
});

test('window resets do not release an active call', () => {
  let timestamp = 0;
  const limiter = createAgentCallLimiter({
    windowMs: 100,
    now: () => timestamp,
  });
  const release = limiter.acquire('synthetic-a');

  timestamp = 100;
  assert.throws(
    () => limiter.acquire('synthetic-a'),
    { code: 'agent_account_busy' },
  );

  release();
  limiter.acquire('synthetic-a')();
});

test('invalid configuration and accounts are rejected', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => createAgentCallLimiter({
      maximumCalls: value,
    }));
  }

  const limiter = createAgentCallLimiter();
  assert.throws(() => limiter.acquire(''));
  assert.throws(() => limiter.acquire(null));
});