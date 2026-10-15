import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConfiguredAgentCallLimiter,
} from '../lib/agent/call-limit-config.js';

test('default configuration limits concurrent calls per account', () => {
  const limiter = createConfiguredAgentCallLimiter({ env: {} });
  const release = limiter.acquire('synthetic-a');

  assert.throws(
    () => limiter.acquire('synthetic-a'),
    { code: 'agent_account_busy' },
  );

  release();
  limiter.acquire('synthetic-a')();
});

test('configured allowance resets after the configured window', () => {
  let timestamp = 0;
  const limiter = createConfiguredAgentCallLimiter({
    env: {
      AGENT_CALL_MAXIMUM: '1',
      AGENT_CALL_WINDOW_MS: '100',
    },
    now: () => timestamp,
  });

  limiter.acquire('synthetic-a')();
  assert.throws(
    () => limiter.acquire('synthetic-a'),
    { code: 'agent_call_limit' },
  );

  timestamp = 100;
  limiter.acquire('synthetic-a')();
});

test('configured account and global concurrency limits are applied', () => {
  const limiter = createConfiguredAgentCallLimiter({
    env: {
      AGENT_ACCOUNT_CONCURRENT: '2',
      AGENT_GLOBAL_CONCURRENT: '2',
    },
  });

  const first = limiter.acquire('synthetic-a');
  const second = limiter.acquire('synthetic-a');

  assert.throws(
    () => limiter.acquire('synthetic-b'),
    { code: 'agent_service_busy' },
  );

  first();
  second();
  limiter.acquire('synthetic-b')();
});

test('invalid environment values fail with the configuration name', () => {
  for (const name of [
    'AGENT_CALL_MAXIMUM',
    'AGENT_CALL_WINDOW_MS',
    'AGENT_ACCOUNT_CONCURRENT',
    'AGENT_GLOBAL_CONCURRENT',
  ]) {
    for (const value of ['0', '-1', '1.5', 'abc', ' ', 'Infinity']) {
      assert.throws(
        () => createConfiguredAgentCallLimiter({
          env: { [name]: value },
        }),
        error => error.message.includes(name),
      );
    }
  }
});