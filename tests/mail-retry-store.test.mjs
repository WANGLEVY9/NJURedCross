import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailIntent } from '../lib/mail/intent.js';
import { sealMailPayload } from '../lib/mail/payload.js';
import { openMailRetryStore } from '../lib/mail/retry-store.js';

const secret = 'synthetic-mail-retry-store-secret-123456789';
const message = {
  idempotencyKey: 'CHANGE:synthetic-store-1',
  to: 'student@example.test',
  subject: '模拟安全通知',
  text: '模拟正文：密码已修改。',
  kind: 'security',
};

function job() {
  return {
    intent: createMailIntent(message, { secret }),
    envelope: sealMailPayload(message, { secret }),
    expiresAt: 100_000,
    nextAttemptAt: 1_000,
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mail-retry-test-'));
  const file = join(directory, 'queue.sqlite');
  const connections = new Set();

  t.after(async () => {
    for (const store of connections) store.close();
    await rm(directory, { recursive: true, force: true });
  });

  return {
    async open() {
      const store = await openMailRetryStore(file);
      connections.add(store);
      return store;
    },
    close(store) {
      store.close();
      connections.delete(store);
    },
  };
}

test('queued content and schedule survive reopening', async t => {
  const f = await fixture(t);
  const first = await f.open();
  const input = job();

  first.enqueue(input);
  f.close(first);

  const reopened = await f.open();
  const saved = reopened.get(input.intent.key);

  assert.deepEqual(saved.intent, input.intent);
  assert.deepEqual(saved.envelope, input.envelope);
  assert.equal(saved.expiresAt, input.expiresAt);
  assert.equal(saved.nextAttemptAt, input.nextAttemptAt);
  assert.equal(saved.attempts, 0);
  assert.equal(saved.status, 'queued');
});

test('duplicate enqueue preserves original encrypted content', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const input = job();

  const original = store.enqueue(input);
  const duplicate = store.enqueue({
    ...input,
    envelope: sealMailPayload(message, { secret }),
  });

  assert.deepEqual(duplicate, original);
  assert.equal(store.due({ now: 1_000 }).length, 1);

  assert.throws(() => store.enqueue({
    ...input,
    expiresAt: input.expiresAt + 1,
  }));
});

test('same key cannot be reused for different content', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const input = job();
  store.enqueue(input);

  const changed = { ...message, text: '另一份模拟正文' };

  assert.throws(() => store.enqueue({
    ...input,
    intent: createMailIntent(changed, { secret }),
    envelope: sealMailPayload(changed, { secret }),
  }));

  assert.deepEqual(
    store.get(input.intent.key).envelope,
    input.envelope,
  );
});

test('stale connections cannot overwrite a rescheduled job', async t => {
  const f = await fixture(t);
  const first = await f.open();
  const second = await f.open();
  const input = job();

  first.enqueue(input);
  assert.equal(second.get(input.intent.key).attempts, 0);

  first.update(input.intent.key, 0, {
    attempts: 1,
    status: 'queued',
    nextAttemptAt: 2_000,
  });

  assert.throws(() => second.update(input.intent.key, 0, {
    attempts: 1,
    status: 'queued',
    nextAttemptAt: 3_000,
  }));

  assert.equal(second.get(input.intent.key).nextAttemptAt, 2_000);
});

test('due jobs respect deadlines and bounded batch sizes', async t => {
  const f = await fixture(t);
  const store = await f.open();
  store.enqueue(job());

  assert.equal(store.due({ now: 999 }).length, 0);
  assert.equal(store.due({ now: 1_000, limit: 1 }).length, 1);

  for (const limit of [0, 101, 0.5]) {
    assert.throws(() => store.due({ now: 1_000, limit }));
  }

  assert.throws(() => store.enqueue({
    ...job(),
    nextAttemptAt: 100_000,
  }));
});

test('completed and stopped jobs cannot be requeued', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const input = job();

  store.enqueue(input);
  store.update(input.intent.key, 0, {
    attempts: 0,
    status: 'completed',
    nextAttemptAt: input.nextAttemptAt,
  });

  assert.equal(store.due({ now: 10_000 }).length, 0);

  assert.throws(() => store.update(input.intent.key, 0, {
    attempts: 1,
    status: 'queued',
    nextAttemptAt: 2_000,
  }));

  const secondMessage = {
    ...message,
    idempotencyKey: 'CHANGE:synthetic-store-2',
  };

  const second = {
    ...input,
    intent: createMailIntent(secondMessage, { secret }),
    envelope: sealMailPayload(secondMessage, { secret }),
  };

  store.enqueue(second);
  store.update(second.intent.key, 0, {
    attempts: 0,
    status: 'stopped',
    nextAttemptAt: second.nextAttemptAt,
  });

  assert.equal(store.due({ now: 10_000 }).length, 0);
  assert.equal(
    store.enqueue(second).status,
    'stopped',
  );
});