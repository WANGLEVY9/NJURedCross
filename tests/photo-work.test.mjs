import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoWorkQueue } from '../lib/events/photo-work.js';
import {
  currentRequestBudget,
  withRequestBudget,
} from '../lib/http/request-budget.js';

test('full decode queue rejects excess work without starting it', async t => {
  const run = createPhotoWorkQueue({ concurrency: 1, maxWaiting: 1 });
  const gate = Promise.withResolvers();
  t.after(() => gate.resolve());
  let excessStarted = false;

  const first = run(() => gate.promise);
  const second = run(async () => 'second');

  await assert.rejects(
    run(async () => { excessStarted = true; }),
    { code: 'photo_work_busy', statusCode: 503 },
  );

  assert.equal(excessStarted, false);
  gate.resolve('first');
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
});

test('failed decoding releases capacity for the next task', async () => {
  const run = createPhotoWorkQueue({ concurrency: 1, maxWaiting: 1 });

  const first = run(async () => { throw new Error('synthetic-failure'); });
  const rejected = assert.rejects(first, /synthetic-failure/);
  const second = run(async () => 'recovered');

  await rejected;
  assert.equal(await second, 'recovered');
});

test('cancelled waiting work never starts and frees its waiting slot', async t => {
  const run = createPhotoWorkQueue({ concurrency: 1, maxWaiting: 1 });
  const gate = Promise.withResolvers();
  t.after(() => gate.resolve());
  const first = run(() => gate.promise);
  const controller = new AbortController();
  let cancelledStarted = false;

  const waiting = withRequestBudget(
    () => run(async () => { cancelledStarted = true; }),
    { signal: controller.signal },
  );
  const rejected = assert.rejects(waiting, {
    code: 'external_request_cancelled',
  });

  controller.abort();
  await rejected;

  const next = run(async () => 'next');
  gate.resolve();
  await first;

  assert.equal(await next, 'next');
  assert.equal(cancelledStarted, false);
});

test('active cancellation does not release capacity before computation finishes', async t => {
  const run = createPhotoWorkQueue({ concurrency: 1, maxWaiting: 0 });
  const gate = Promise.withResolvers();
  const started = Promise.withResolvers();
  const controller = new AbortController();
  t.after(() => gate.resolve());

  const active = withRequestBudget(
    () => run(async () => {
      started.resolve();
      return gate.promise;
    }),
    { signal: controller.signal },
  );
  const rejected = assert.rejects(active, {
    code: 'external_request_cancelled',
  });

  await started.promise;
  controller.abort();
  await rejected;

  await assert.rejects(
    run(async () => 'too-early'),
    { code: 'photo_work_busy' },
  );

  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await run(async () => 'available'), 'available');
});

test('waiting work expires without starting its decoding operation', async t => {
  const run = createPhotoWorkQueue({ concurrency: 1, maxWaiting: 1 });
  const gate = Promise.withResolvers();
  t.after(() => gate.resolve());
  const first = run(() => gate.promise);
  let expiredStarted = false;

  await assert.rejects(
    withRequestBudget(
      () => run(async () => { expiredStarted = true; }),
      { timeoutMs: 30 },
    ),
    { code: 'external_request_timeout' },
  );

  gate.resolve();
  await first;
  assert.equal(expiredStarted, false);
});

test('queued work retains its own request budget', async t => {
  const run = createPhotoWorkQueue({ concurrency: 1, maxWaiting: 1 });
  const gate = Promise.withResolvers();
  t.after(() => gate.resolve());

  const first = run(() => gate.promise);
  const second = withRequestBudget(() => {
    const expected = currentRequestBudget();

    return run(async () => {
      assert.equal(currentRequestBudget(), expected);
      return 'correct-context';
    });
  });

  gate.resolve();
  await first;
  assert.equal(await second, 'correct-context');
});

test('invalid queue parameters are rejected', () => {
  for (const options of [
    { concurrency: 0 },
    { concurrency: 1.5 },
    { maxWaiting: -1 },
    { maxWaiting: 1.5 },
  ]) {
    assert.throws(() => createPhotoWorkQueue(options), TypeError);
  }
});