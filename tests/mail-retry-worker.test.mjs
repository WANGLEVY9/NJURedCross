import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailIntent } from '../lib/mail/intent.js';
import { sealMailPayload } from '../lib/mail/payload.js';
import { openMailRetryStore } from '../lib/mail/retry-store.js';
import { runMailRetryBatch } from '../lib/mail/retry-worker.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

const secret = 'synthetic-mail-retry-worker-secret-123456789';
const message = {
  idempotencyKey: 'CHANGE:synthetic-worker-1',
  to: 'student@example.test',
  subject: '模拟安全通知',
  text: '模拟正文：密码已修改。',
  kind: 'security',
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mail-worker-test-'));
  const store = await openMailRetryStore(
    join(directory, 'queue.sqlite'),
  );

  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  const intent = createMailIntent(message, { secret });

  store.enqueue({
    intent,
    envelope: sealMailPayload(message, { secret }),
    expiresAt: 86_400_000,
    nextAttemptAt: 1_000,
  });

  let time = 1_000;
  let state = 'pending';
  let sends = 0;

  return {
    store,
    key: intent.key,
    setTime(value) { time = value; },
    setState(value) { state = value; },
    get sends() { return sends; },

    run(deliver = async () => ({ ok: true }), options = {}) {
      return runMailRetryBatch({
        store,
        secret,
        now: () => time,
        getDelivery: () => state === null ? null : { state },
        deliver: async recovered => {
          sends++;
          assert.deepEqual(recovered, message);
          return deliver();
        },
        ...options,
      });
    },
  };
}

test('successful delivery completes the queued job', async t => {
  const f = await fixture(t);

  const result = await f.run();

  assert.equal(result.completed, 1);
  assert.equal(f.sends, 1);
  assert.equal(f.store.get(f.key).status, 'completed');
  assert.equal(f.store.get(f.key).attempts, 1);

  await f.run();
  assert.equal(f.sends, 1);
});

test('safe pre-send failure schedules the next attempt', async t => {
  const f = await fixture(t);

  const result = await f.run(async () => ({
    ok: false,
    retryable: true,
  }));

  assert.equal(result.rescheduled, 1);
  const saved = f.store.get(f.key);
  assert.equal(saved.attempts, 1);
  assert.equal(saved.status, 'queued');
  assert.equal(saved.nextAttemptAt, 301_000);

  await f.run();
  assert.equal(f.sends, 1);
});

test('uncertain delivery stops automatic retries', async t => {
  const f = await fixture(t);

  const result = await f.run(async () => {
    f.setState('unknown');
    return { ok: false, retryable: true };
  });

  assert.equal(result.stopped, 1);
  assert.equal(f.store.get(f.key).status, 'stopped');

  f.setTime(500_000);
  await f.run();
  assert.equal(f.sends, 1);
});

test('already sent and in-progress jobs do not invoke delivery', async t => {
  const f = await fixture(t);
  f.setState('sent');

  assert.equal((await f.run()).completed, 1);
  assert.equal(f.sends, 0);

  const other = await fixture(t);
  other.setState('sending');

  assert.equal((await other.run()).stopped, 1);
  assert.equal(other.sends, 0);
});

test('expired jobs and undecryptable content stop without sending', async t => {
  const f = await fixture(t);
  f.setTime(86_400_000);

  assert.equal((await f.run()).stopped, 1);
  assert.equal(f.sends, 0);

  const other = await fixture(t);

  const result = await other.run(undefined, {
    secret: 'different-synthetic-secret-123456789012345',
  });

  assert.equal(result.stopped, 1);
  assert.equal(other.sends, 0);
});

test('interrupted delivery preserves the reserved attempt', async t => {
  const f = await fixture(t);

  await assert.rejects(
    f.run(async () => {
      f.setState('sending');
      throw new Error('synthetic-private-detail');
    }),
    error => (
      error.code === 'mail_retry_interrupted'
      && !error.message.includes('synthetic-private-detail')
    ),
  );

  const saved = f.store.get(f.key);
  assert.equal(saved.attempts, 1);
  assert.equal(saved.status, 'queued');

  f.setTime(saved.nextAttemptAt);

  assert.equal((await f.run()).stopped, 1);
  assert.equal(f.sends, 1);
});

test('retryable failures cannot exceed four background attempts', async t => {
  const f = await fixture(t);

  for (let attempt = 0; attempt < 4; attempt++) {
    const saved = f.store.get(f.key);
    f.setTime(saved.nextAttemptAt);

    await f.run(async () => ({
      ok: false,
      retryable: true,
    }));
  }

  assert.equal(f.sends, 4);
  assert.equal(f.store.get(f.key).attempts, 4);
  assert.equal(f.store.get(f.key).status, 'stopped');

  f.setTime(10_000_000);
  await f.run();
  assert.equal(f.sends, 4);
});
test('a backlog is processed in bounded batches rather than all at once', async t => {
  const f = await fixture(t);

  for (let index = 0; index < 11; index++) {
    const item = {
      ...message,
      idempotencyKey: `BACKLOG:${String(index).padStart(3, '0')}`,
    };
    f.store.enqueue({
      intent: createMailIntent(item, { secret }),
      envelope: sealMailPayload(item, { secret }),
      expiresAt: 86_400_000,
      nextAttemptAt: 1000,
    });
  }

  let deliveries = 0;
  const run = () => runMailRetryBatch({
    store: f.store,
    secret,
    now: () => 1000,
    limit: 5,
    getDelivery: () => ({ state: 'pending' }),
    deliver: async () => {
      deliveries++;
      return { ok: true };
    },
  });

  assert.equal((await run()).selected, 5);
  assert.equal(deliveries, 5);
  assert.equal(f.store.due({ now: 1000, limit: 100 }).length, 7);

  assert.equal((await run()).selected, 5);
  assert.equal(deliveries, 10);
  assert.equal(f.store.due({ now: 1000, limit: 100 }).length, 2);
});

test('cancelled batches retain untouched jobs and do not resend confirmed delivery', async t => {
  const f = await fixture(t);

  for (let index = 0; index < 3; index++) {
    const item = {
      ...message,
      idempotencyKey: `CANCEL:${index}`,
    };
    f.store.enqueue({
      intent: createMailIntent(item, { secret }),
      envelope: sealMailPayload(item, { secret }),
      expiresAt: 86_400_000,
      nextAttemptAt: 1000,
    });
  }

  const controller = new AbortController();
  const states = new Map();
  const deliveries = new Map();
  let firstKey;

  await assert.rejects(
    withRequestBudget(() => runMailRetryBatch({
      store: f.store,
      secret,
      now: () => 1000,
      limit: 5,
      getDelivery: key => ({ state: states.get(key) || 'pending' }),
      deliver: async recovered => {
        firstKey = recovered.idempotencyKey;
        deliveries.set(firstKey, 1);
        states.set(firstKey, 'sent');
        controller.abort();
        return { ok: true };
      },
    }), { signal: controller.signal }),
    { code: 'external_request_cancelled' },
  );

  assert.equal(deliveries.size, 1);
  assert.equal(f.store.get(firstKey).attempts, 1);
  assert.equal(f.store.get(firstKey).status, 'queued');

  const untouched = f.store.due({ now: 1000, limit: 100 });
  assert.equal(untouched.length, 3);
  assert.ok(untouched.every(job => job.attempts === 0));

  await runMailRetryBatch({
    store: f.store,
    secret,
    now: () => 301000,
    limit: 5,
    getDelivery: key => ({ state: states.get(key) || 'pending' }),
    deliver: async recovered => {
      const key = recovered.idempotencyKey;
      deliveries.set(key, (deliveries.get(key) || 0) + 1);
      states.set(key, 'sent');
      return { ok: true };
    },
  });

  assert.equal(deliveries.get(firstKey), 1);
  assert.equal(deliveries.size, 4);
  assert.equal(f.store.get(firstKey).status, 'completed');
});
