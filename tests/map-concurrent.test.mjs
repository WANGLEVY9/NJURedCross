import test from 'node:test';
import assert from 'node:assert/strict';
import { mapConcurrent } from '../lib/http/map-concurrent.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('active operations never exceed the configured concurrency', async () => {
  let active = 0;
  let peak = 0;

  const result = await mapConcurrent(
    Array.from({ length: 12 }, (_, index) => index),
    3,
    async value => {
      active++;
      peak = Math.max(peak, active);

      try {
        await new Promise(resolve => setImmediate(resolve));
        return value * 2;
      } finally {
        active--;
      }
    },
  );

  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(result, Array.from({ length: 12 }, (_, index) => index * 2));
});

test('results preserve input order despite different completion order', async () => {
  const result = await mapConcurrent([0, 1, 2], 3, async value => {
    await new Promise(resolve => setTimeout(resolve, (2 - value) * 5));
    return `result-${value}`;
  });

  assert.deepEqual(result, ['result-0', 'result-1', 'result-2']);
});

test('empty input never starts an operation', async () => {
  let calls = 0;

  assert.deepEqual(
    await mapConcurrent([], 4, async () => { calls++; }),
    [],
  );
  assert.equal(calls, 0);
});

test('failure stops admission and waits for active operations', async () => {
  const triggerFailure = deferred();
  const releaseActive = deferred();
  const started = deferred();
  const expectedError = new Error('synthetic-failure');
  const calls = [];
  let settled = false;

  const operation = mapConcurrent([0, 1, 2, 3], 2, async value => {
    calls.push(value);

    if (value === 0) {
      await triggerFailure.promise;
      throw expectedError;
    }

    started.resolve();
    await releaseActive.promise;
    return value;
  });

  operation.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  const rejected = assert.rejects(operation, error => error === expectedError);

  try {
    await started.promise;
    triggerFailure.resolve();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(calls, [0, 1]);
    assert.equal(settled, false);
  } finally {
    triggerFailure.resolve();
    releaseActive.resolve();
    await rejected;
  }

  assert.equal(settled, true);
});

test('a synchronous failure prevents later workers from starting', async () => {
  let calls = 0;
  const expectedError = new Error('synthetic-synchronous-failure');

  await assert.rejects(
    mapConcurrent([0, 1, 2], 3, () => {
      calls++;
      throw expectedError;
    }),
    error => error === expectedError,
  );

  assert.equal(calls, 1);
});

test('cancellation prevents admission of remaining items', async () => {
  const controller = new AbortController();
  const started = deferred();
  const gate = deferred();
  let calls = 0;

  const operation = withRequestBudget(
    () => mapConcurrent([0, 1, 2, 3, 4], 2, async value => {
      calls++;
      if (calls === 2) started.resolve();
      await gate.promise;
      return value;
    }),
    { signal: controller.signal, timeoutMs: 5000 },
  );

  const rejected = assert.rejects(
    operation,
    error => error.code === 'external_request_cancelled',
  );

  try {
    await started.promise;
    controller.abort();
  } finally {
    gate.resolve();
    await rejected;
  }

  assert.equal(calls, 2);
});

test('already cancelled requests do not start any operation', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  await assert.rejects(
    withRequestBudget(
      () => mapConcurrent([1], 1, async () => { calls++; }),
      { signal: controller.signal },
    ),
    error => error.code === 'external_request_cancelled',
  );

  assert.equal(calls, 0);
});

test('invalid arguments fail before executing operations', async () => {
  let calls = 0;
  const operation = async () => { calls++; };

  for (const concurrency of [0, -1, 1.5, NaN, Infinity, 33]) {
    await assert.rejects(
      mapConcurrent([1], concurrency, operation),
      TypeError,
    );
  }

  await assert.rejects(mapConcurrent(null, 1, operation), TypeError);
  await assert.rejects(mapConcurrent([1], 1, null), TypeError);
  assert.equal(calls, 0);
});