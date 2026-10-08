import test from 'node:test';
import assert from 'node:assert/strict';
import { startBackgroundTask } from '../lib/background/task.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function scheduler(t, operation, options = {}) {
  const task = startBackgroundTask(operation, {
    intervalMs: 60000,
    runImmediately: false,
    ...options,
  });
  t.after(() => task.stop());
  return task;
}

test('overlapping runs do not start another operation', async t => {
  const gate = deferred();
  let calls = 0;

  const task = scheduler(t, async () => {
    calls++;
    await gate.promise;
  });

  const first = task.run();
  try {
    await task.run();
    await task.run();
    assert.equal(calls, 1);
  } finally {
    gate.resolve();
    await first;
  }

  await task.run();
  assert.equal(calls, 2);
});

test('operation failure releases the running slot', async t => {
  let calls = 0;
  let errors = 0;

  const task = scheduler(t, async () => {
    calls++;
    if (calls === 1) throw new Error('synthetic-private-detail');
  }, {
    onError: (...args) => {
      assert.equal(args.length, 0);
      errors++;
    },
  });

  await task.run();
  await task.run();

  assert.equal(calls, 2);
  assert.equal(errors, 1);
});

test('logger failure does not block subsequent runs', async t => {
  let calls = 0;

  const task = scheduler(t, async () => {
    calls++;
    if (calls === 1) throw new Error('synthetic-failure');
  }, {
    onError: () => { throw new Error('synthetic-logger-failure'); },
  });

  await task.run();
  await task.run();
  assert.equal(calls, 2);
});

test('stopping prevents new manual runs and is idempotent', async t => {
  let calls = 0;
  const task = scheduler(t, async () => { calls++; });

  task.stop();
  task.stop();
  await task.run();

  assert.equal(calls, 0);
});

test('stopping allows an active operation to finish without restarting', async t => {
  const gate = deferred();
  let started = 0;
  let completed = 0;

  const task = scheduler(t, async () => {
    started++;
    await gate.promise;
    completed++;
  });

  const first = task.run();
  task.stop();

  try {
    await task.run();
    assert.equal(started, 1);
    assert.equal(completed, 0);
  } finally {
    gate.resolve();
    await first;
  }

  await task.run();
  assert.equal(started, 1);
  assert.equal(completed, 1);
});

test('immediate startup does not overlap with a manual run', async t => {
  const gate = deferred();
  const finished = deferred();
  let calls = 0;

  const task = scheduler(t, async () => {
    calls++;
    await gate.promise;
    finished.resolve();
  }, {
    runImmediately: true,
  });

  try {
    await task.run();
    assert.equal(calls, 1);
  } finally {
    task.stop();
    gate.resolve();
    await finished.promise;
  }
});

test('interval ticks cannot overlap an unfinished operation', async t => {
  const started = deferred();
  const gate = deferred();
  const finished = deferred();
  let calls = 0;

  const task = scheduler(t, async () => {
    calls++;
    started.resolve();
    await gate.promise;
    finished.resolve();
  }, {
    intervalMs: 10,
  });

  try {
    await started.promise;
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(calls, 1);
  } finally {
    task.stop();
    gate.resolve();
    await finished.promise;
  }
});

test('invalid settings are rejected before scheduling', () => {
  for (const intervalMs of [0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    assert.throws(
      () => startBackgroundTask(async () => {}, { intervalMs }),
      TypeError,
    );
  }

  assert.throws(
    () => startBackgroundTask(null, { intervalMs: 1000 }),
    TypeError,
  );
  assert.throws(
    () => startBackgroundTask(async () => {}, {
      intervalMs: 1000,
      onError: null,
    }),
    TypeError,
  );
  assert.throws(
    () => startBackgroundTask(async () => {}, {
      intervalMs: 1000,
      runImmediately: 'true',
    }),
    TypeError,
  );
});