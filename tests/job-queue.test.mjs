import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openJobStore } from '../lib/queue/store.js';
import { createJobQueue } from '../lib/queue/index.js';

async function store(t, options) {
  const root = await mkdtemp(join(tmpdir(), 'njuredcross-jobs-'));
  const file = join(root, 'jobs.sqlite');
  const opened = await openJobStore(file, options);
  t.after(async () => { opened.close(); await rm(root, { recursive: true, force: true }); });
  return { store: opened, file, root };
}

test('the dedupe key keeps a single in-flight task per business event', async t => {
  const { store: jobs } = await store(t);

  const first = jobs.enqueue({ type: 'registration.notifications', dedupeKey: 'registration.notifications' });
  const second = jobs.enqueue({ type: 'registration.notifications', dedupeKey: 'registration.notifications' });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.job.id, first.job.id);

  const claimed = jobs.claim({ limit: 5 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].attempts, 1);
  jobs.complete(claimed[0].id);

  const third = jobs.enqueue({ type: 'registration.notifications', dedupeKey: 'registration.notifications' });
  assert.equal(third.created, true);
  assert.notEqual(third.job.id, first.job.id);
});

test('claiming is exclusive and a lease can be reclaimed after a crash', async t => {
  const { store: jobs } = await store(t);
  const { job } = jobs.enqueue({ type: 'registration.notifications', runAfter: 0 });

  const first = jobs.claim({ at: 1_000, limit: 1, leaseMs: 5_000 });
  assert.equal(first.length, 1);
  assert.equal(jobs.claim({ at: 1_001, limit: 1, leaseMs: 5_000 }).length, 0);

  assert.equal(jobs.releaseStale(5_999), 0);
  assert.equal(jobs.releaseStale(6_000), 1);

  const again = jobs.claim({ at: 6_000, limit: 1, leaseMs: 5_000 });
  assert.equal(again.length, 1);
  assert.equal(again[0].id, job.id);
  assert.equal(again[0].attempts, 2);
});

test('failures back off and stop at the attempt limit instead of retrying forever', async t => {
  const { store: jobs } = await store(t, { maxAttempts: 2 });

  const { job } = jobs.enqueue({ type: 'roster.deliver', runAfter: 0 });
  const [attempt] = jobs.claim({ at: 0, limit: 1 });
  const retried = jobs.fail(attempt.id, { error: 'smtp_unavailable', retryAfterMs: 1_000 });

  assert.equal(retried.status, 'queued');
  assert.equal(retried.lastError, 'smtp_unavailable');
  assert.equal(jobs.claim({ at: 0, limit: 1 }).length, 0, 'not due yet');

  const [second] = jobs.claim({ at: retried.runAfter, limit: 1 });
  assert.equal(second.attempts, 2);
  const dead = jobs.fail(second.id, { error: 'smtp_unavailable', retryAfterMs: 1_000 });

  assert.equal(dead.status, 'failed');
  assert.equal(jobs.stats().failed, 1);
  assert.equal(jobs.stats().queued, 0);
  assert.equal(jobs.list({ status: 'failed' })[0].id, job.id);
});

test('invalid task input is rejected before it reaches the database', async t => {
  const { store: jobs } = await store(t);

  assert.throws(() => jobs.enqueue({ type: '' }), { code: 'job_store_invalid' });
  assert.throws(() => jobs.enqueue({ type: 'x', dedupeKey: '' }), { code: 'job_store_invalid' });
  assert.throws(() => jobs.enqueue({ type: 'x', payload: { blob: 'x'.repeat(70_000) } }), { code: 'job_store_invalid' });
  assert.throws(() => jobs.claim({ limit: 0 }), { code: 'job_store_invalid' });
});

test('the runner executes queued work, retries a transient failure and stops cleanly', async t => {
  const root = await mkdtemp(join(tmpdir(), 'njuredcross-queue-'));
  const attempts = [];
  const queue = await createJobQueue({
    file: join(root, 'jobs.sqlite'),
    pollMs: 50,
    leaseMs: 30_000,
    handlerTimeoutMs: 20_000,
    retryBaseMs: 100,
    handlers: {
      'test.notify': async payload => {
        attempts.push(payload.id);
        if (attempts.length === 1) throw Object.assign(new Error('temporary'), { code: 'transient_failure' });
      },
    },
  });

  t.after(async () => {
    await queue.stop({ timeoutMs: 2_000 });
    queue.close();
    await rm(root, { recursive: true, force: true });
  });

  queue.enqueue({ type: 'test.notify', payload: { id: 'mail-1' }, runAfter: Date.now() });
  queue.start();

  const deadline = Date.now() + 5_000;
  while (attempts.length < 2 && Date.now() < deadline) await delay(50);

  assert.deepEqual(attempts, ['mail-1', 'mail-1']);

  while (queue.stats().done < 1 && Date.now() < deadline) await delay(50);
  assert.equal(queue.stats().done, 1);
  assert.equal(queue.stats().runner.completed, 1);
  assert.equal(queue.stats().failed, 0);

  const stopped = await queue.stop({ timeoutMs: 2_000 });
  assert.equal(stopped.pending, 0);
});

test('an unknown task type is parked for review instead of looping', async t => {
  const root = await mkdtemp(join(tmpdir(), 'njuredcross-queue-'));
  const queue = await createJobQueue({
    file: join(root, 'jobs.sqlite'),
    pollMs: 40,
    leaseMs: 30_000,
    handlerTimeoutMs: 20_000,
    retryBaseMs: 100,
    maxAttempts: 1,
    handlers: {},
  });

  t.after(async () => {
    await queue.stop({ timeoutMs: 2_000 });
    queue.close();
    await rm(root, { recursive: true, force: true });
  });

  queue.enqueue({ type: 'unknown.type' });
  queue.start();

  const deadline = Date.now() + 5_000;
  while (queue.stats().failed < 1 && Date.now() < deadline) await delay(50);

  assert.equal(queue.stats().failed, 1);
  assert.equal(queue.list({ status: 'failed' })[0].lastError, 'job_type_unknown');
});
