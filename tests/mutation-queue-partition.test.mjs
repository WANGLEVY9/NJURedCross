import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createMutationQueue } from '../lib/events/safety.js';

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}

test('keyed queue serializes one key while independent keys run concurrently', async () => {
  const queue = createMutationQueue({ keyOf: scope => scope?.eventId ?? '*' });
  const firstRelease = deferred();
  const independentDone = deferred();
  const order = [];

  const first = queue(async () => {
    order.push('event-a:start');
    await firstRelease.promise;
    order.push('event-a:end');
  }, { eventId: 'event-a' });

  const second = queue(async () => {
    order.push('event-a-2:start');
  }, { eventId: 'event-a' });

  const independent = queue(async () => {
    order.push('event-b:start');
    await delay(10);
    order.push('event-b:end');
    independentDone.resolve();
  }, { eventId: 'event-b' });

  await independentDone.promise;
  assert.deepEqual(order, ['event-a:start', 'event-b:start', 'event-b:end']);
  firstRelease.resolve();
  await Promise.all([first, second, independent]);
  assert.deepEqual(order, ['event-a:start', 'event-b:start', 'event-b:end', 'event-a:end', 'event-a-2:start']);
});

test('global barrier waits for every active partition and blocks later partitions', async () => {
  const queue = createMutationQueue({ keyOf: scope => scope?.eventId ?? '*' });
  const release = deferred();
  const started = deferred();
  let globalStarted = false;
  let laterStarted = false;
  const order = [];

  const first = queue(async () => {
    started.resolve();
    await release.promise;
    order.push('first');
  }, { eventId: 'a' });
  await started.promise;

  const barrier = queue(async () => {
    globalStarted = true;
    order.push('global');
  });
  const later = queue(async () => {
    laterStarted = true;
    order.push('later');
  }, { eventId: 'b' });

  await delay(10);
  assert.equal(globalStarted, false);
  assert.equal(laterStarted, false);
  release.resolve();
  await Promise.all([first, barrier, later]);
  assert.equal(globalStarted, true);
  assert.equal(laterStarted, true);
  assert.deepEqual(order, ['first', 'global', 'later']);
});

test('cancelled partitioned wait does not execute its task', async () => {
  const queue = createMutationQueue({ keyOf: scope => scope?.eventId ?? '*' });
  const release = deferred();
  let calls = 0;
  const first = queue(() => release.promise, { eventId: 'a' });
  const cancelled = queue(async () => { calls += 1; }, { eventId: 'a' });
  release.resolve();
  await first;
  assert.equal(await queue(async () => 'next', { eventId: 'a' }), 'next');
  await cancelled;
  assert.equal(calls, 1);
});
