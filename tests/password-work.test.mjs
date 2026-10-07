import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createPasswordWorkQueue } from '../lib/identity/password-work.js';
import {
  withRequestBudget,
  currentRequestBudget,
} from '../lib/http/request-budget.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('queue bounds concurrent work and drains waiting jobs', async () => {
  const run = createPasswordWorkQueue({
    concurrency: 2,
    maxWaiting: 3,
  });
  const gate = deferred();
  let active = 0;
  let peak = 0;
  let started = 0;

  const jobs = Array.from({ length: 5 }, (_, index) => run(async () => {
    started++;
    active++;
    peak = Math.max(peak, active);

    try {
      await gate.promise;
      return index;
    } finally {
      active--;
    }
  }));

  await setImmediate();
  assert.equal(started, 2);

  gate.resolve();

  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
});

test('full queues reject additional work without starting it', async () => {
  const run = createPasswordWorkQueue({
    concurrency: 1,
    maxWaiting: 1,
  });
  const gate = deferred();
  let extraStarted = false;

  const first = run(() => gate.promise);
  const second = run(async () => 'second');

  await assert.rejects(
    run(async () => { extraStarted = true; }),
    error => (
      error.code === 'password_work_busy'
      && error.statusCode === 503
    ),
  );

  assert.equal(extraStarted, false);
  gate.resolve();

  await first;
  assert.equal(await second, 'second');
});

test('failed work releases its slot for subsequent jobs', async () => {
  const run = createPasswordWorkQueue({ concurrency: 1 });

  const failed = run(async () => {
    throw new Error('synthetic-failure');
  });
  const next = run(async () => 'recovered');

  await assert.rejects(failed, /synthetic-failure/);
  assert.equal(await next, 'recovered');
});

test('cancelled waiting work is removed before it starts', async () => {
  const run = createPasswordWorkQueue({
    concurrency: 1,
    maxWaiting: 1,
  });
  const gate = deferred();
  const first = run(() => gate.promise);
  const controller = new AbortController();
  let started = false;

  const waiting = withRequestBudget(
    () => run(async () => { started = true; }),
    { signal: controller.signal },
  );

  const rejected = assert.rejects(
    waiting,
    error => error.code === 'external_request_cancelled',
  );

  controller.abort();
  await rejected;

  const replacement = run(async () => 'replacement');

  gate.resolve();
  await first;

  assert.equal(await replacement, 'replacement');
  assert.equal(started, false);
});

test('cancelled active work retains its slot until computation ends', async () => {
  const run = createPasswordWorkQueue({
    concurrency: 1,
    maxWaiting: 0,
  });
  const gate = deferred();
  const controller = new AbortController();

  const active = withRequestBudget(
    () => run(() => gate.promise),
    { signal: controller.signal },
  );

  const rejected = assert.rejects(
    active,
    error => error.code === 'external_request_cancelled',
  );

  await setImmediate();
  controller.abort();
  await rejected;

  await assert.rejects(
    run(async () => 'must-not-start'),
    error => error.code === 'password_work_busy',
  );

  gate.resolve();
  await setImmediate();

  assert.equal(await run(async () => 'available'), 'available');
});

test('waiting jobs retain their own request budget context', async () => {
  const run = createPasswordWorkQueue({ concurrency: 1 });
  const gate = deferred();
  const first = run(() => gate.promise);
  let expected;

  const waiting = withRequestBudget(() => {
    expected = currentRequestBudget();

    return run(async () => {
      assert.equal(currentRequestBudget(), expected);
      return 'correct-context';
    });
  });

  gate.resolve();
  await first;

  assert.equal(await waiting, 'correct-context');
});

test('invalid queue settings and operations are rejected', () => {
  for (const concurrency of [0, -1, 0.5, NaN]) {
    assert.throws(
      () => createPasswordWorkQueue({ concurrency }),
      TypeError,
    );
  }

  for (const maxWaiting of [-1, 0.5, NaN]) {
    assert.throws(
      () => createPasswordWorkQueue({ maxWaiting }),
      TypeError,
    );
  }

  const run = createPasswordWorkQueue();
  assert.throws(() => run(null), TypeError);
});