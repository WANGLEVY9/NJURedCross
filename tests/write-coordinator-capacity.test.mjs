import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withRequestBudget } from '../lib/http/request-budget.js';
import { createWriteCoordinator } from '../lib/materials/write-coordinator.js';

async function fixture(t, options = {}) {
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'write-capacity-'));
  const file = join(directory, 'lock.sqlite');
  const lock = await createWriteCoordinator(file, {
    retryMs: 5,
    ...options,
  });

  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  return { directory, file, lock };
}

test('capacity rejects excess requests before their task starts', async t => {
  const f = await fixture(t, { maxPendingRequests: 1 });
  const gate = Promise.withResolvers();
  const started = Promise.withResolvers();
  let excessStarted = false;

  const first = f.lock(async () => {
    started.resolve();
    return gate.promise;
  });

  await started.promise;

  try {
    await assert.rejects(
      f.lock(async () => { excessStarted = true; }),
      { code: 'write_lock_busy', statusCode: 503 },
    );
    assert.equal(excessStarted, false);
  } finally {
    gate.resolve();
    await first;
  }

  assert.equal(await f.lock(async () => 'available'), 'available');
});

test('capacity includes both the active request and lock waiters', async t => {
  const f = await fixture(t, { maxPendingRequests: 2 });
  const gate = Promise.withResolvers();
  const first = f.lock(() => gate.promise);
  let secondStarted = false;
  const second = f.lock(async () => {
    secondStarted = true;
    return 'second';
  });

  try {
    await assert.rejects(
      f.lock(async () => 'excess'),
      { code: 'write_lock_busy' },
    );
    assert.equal(secondStarted, false);
  } finally {
    gate.resolve();
    await first;
    await second;
  }

  assert.equal(secondStarted, true);
});

test('task failure returns its admission slot', async t => {
  const f = await fixture(t, { maxPendingRequests: 1 });

  await assert.rejects(
    f.lock(async () => { throw new Error('synthetic-task-failure'); }),
    /synthetic-task-failure/,
  );

  assert.equal(await f.lock(async () => 'recovered'), 'recovered');
});

test('connection opening failure returns its admission slot', async t => {
  const f = await fixture(t, { maxPendingRequests: 1 });
  const saved = join(f.directory, 'saved-lock.sqlite');

  await rename(f.file, saved);
  await mkdir(f.file);

  try {
    await assert.rejects(f.lock(async () => 'must-not-start'));
  } finally {
    await rm(f.file, { recursive: true });
    await rename(saved, f.file);
  }

  assert.equal(await f.lock(async () => 'recovered'), 'recovered');
});

test('invalid capacity settings are rejected', async t => {
  const f = await fixture(t);

  for (const maxPendingRequests of [0, -1, 1.5, NaN]) {
    await assert.rejects(
      createWriteCoordinator(f.file, { maxPendingRequests }),
      TypeError,
    );
  }

  await assert.rejects(f.lock(null), TypeError);
  assert.equal(await f.lock(async () => 'still-available'), 'still-available');
});

test('lock waiting timeout returns its admission slot', async t => {
  const f = await fixture(t, {
    maxPendingRequests: 2,
    waitMs: 50,
  });
  const gate = Promise.withResolvers();
  const first = f.lock(() => gate.promise);

  try {
    await assert.rejects(
      f.lock(async () => 'must-not-start'),
      { code: 'write_lock_timeout' },
    );

    const replacement = f.lock(async () => 'replacement');
    gate.resolve();
    await first;

    assert.equal(await replacement, 'replacement');
  } finally {
    gate.resolve();
    await first;
  }
});

test('cancelled lock waiters return their admission slot without executing', async t => {
  const f = await fixture(t, { maxPendingRequests: 2 });
  const gate = Promise.withResolvers();
  const first = f.lock(() => gate.promise);
  const controller = new AbortController();
  let cancelledStarted = false;

  const waiting = withRequestBudget(
    () => f.lock(async () => { cancelledStarted = true; }),
    { signal: controller.signal },
  );
  const rejected = assert.rejects(waiting, {
    code: 'external_request_cancelled',
  });

  try {
    controller.abort();
    await rejected;

    const replacement = f.lock(async () => 'replacement');
    gate.resolve();
    await first;

    assert.equal(await replacement, 'replacement');
    assert.equal(cancelledStarted, false);
  } finally {
    gate.resolve();
    await first;
  }
});