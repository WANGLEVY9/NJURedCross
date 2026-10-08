import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  createWriteCoordinator,
} from '../lib/materials/write-coordinator.js';
import {
  withRequestBudget,
} from '../lib/http/request-budget.js';

test('cancellation interrupts a long lock retry and releases admission', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'write-cancel-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const file = join(directory, 'coordination.sqlite');
  const withLock = await createWriteCoordinator(file, {
    waitMs: 60000,
    retryMs: 30000,
    maxPendingRequests: 1,
  });

  const blocker = new DatabaseSync(file);
  let locked = false;

  try {
    blocker.exec('BEGIN IMMEDIATE');
    locked = true;

    const controller = new AbortController();
    let writes = 0;
    const started = performance.now();

    const waiting = withRequestBudget(
      () => withLock(() => { writes++; }),
      { signal: controller.signal, timeoutMs: 60000 },
    );

    // Attach the rejection check before triggering cancellation.
    const rejected = assert.rejects(
      waiting,
      error => error.code === 'external_request_cancelled',
    );

    // The synchronous lock attempt has reached its retry wait.
    controller.abort();
    await rejected;

    assert.ok(
      performance.now() - started < 5000,
      'Cancellation must not wait for the 30-second retry interval',
    );
    assert.equal(writes, 0);

    blocker.exec('ROLLBACK');
    locked = false;

    // The cancelled request must have released its admission slot.
    assert.equal(await withLock(() => 'next request completed'),
      'next request completed');
    assert.equal(writes, 0);
  } finally {
    try {
      if (locked) blocker.exec('ROLLBACK');
    } finally {
      blocker.close();
    }
  }
});