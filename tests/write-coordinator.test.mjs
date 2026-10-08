import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createWriteCoordinator } from '../lib/materials/write-coordinator.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

const moduleUrl = new URL(
  '../lib/materials/write-coordinator.js',
  import.meta.url,
).href;

function message(child, type) {
  return new Promise((resolve, reject) => {
    const receive = value => {
      if (value.type !== type) return;
      cleanup();
      resolve(value);
    };
    const failed = error => {
      cleanup();
      reject(error);
    };
    const exited = () => failed(new Error(`Worker exited before ${type}`));
    const cleanup = () => {
      child.removeListener('message', receive);
      child.removeListener('error', failed);
      child.removeListener('exit', exited);
    };
    child.on('message', receive);
    child.once('error', failed);
    child.once('exit', exited);
  });
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'write-coordinator-'));
  const children = [];

  t.after(async () => {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });

  const file = join(directory, 'lock.sqlite');

  return {
    file,
    async worker() {
      const code = `
        import { createWriteCoordinator } from ${JSON.stringify(moduleUrl)};
        const lock = await createWriteCoordinator(${JSON.stringify(file)});
        let release;
        process.on('message', async value => {
          if (value === 'release') {
            release?.();
            return;
          }
          if (value !== 'start') return;
          process.send({ type: 'waiting' });
          try {
            await lock(async () => {
              await new Promise(resolve => {
                release = resolve;
                process.send({ type: 'acquired' });
              });
            });
            process.send({ type: 'released' });
          } catch {
            process.send({ type: 'failed' });
          }
        });
        process.send({ type: 'ready' });
      `;

      const child = spawn(process.execPath, [
        '--input-type=module',
        '-e',
        code,
      ], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      children.push(child);
      child.stderr.on('data', () => {});
      await message(child, 'ready');
      return child;
    },
  };
}

test('independent processes cannot hold the same write lock together', async t => {
  const f = await fixture(t);
  const first = await f.worker();
  const second = await f.worker();

  const firstAcquired = message(first, 'acquired');
  first.send('start');
  await firstAcquired;

  let secondEntered = false;
  const secondAcquired = message(second, 'acquired').then(() => {
    secondEntered = true;
  });
  const waiting = message(second, 'waiting');
  second.send('start');
  await waiting;
  await delay(100);
  assert.equal(secondEntered, false);

  const released = message(first, 'released');
  first.send('release');
  await released;
  await secondAcquired;

  const secondReleased = message(second, 'released');
  second.send('release');
  await secondReleased;
});

test('terminating the lock holder allows another process to continue', async t => {
  const f = await fixture(t);
  const first = await f.worker();
  const second = await f.worker();

  const acquired = message(first, 'acquired');
  first.send('start');
  await acquired;

  const nextAcquired = message(second, 'acquired');
  const waiting = message(second, 'waiting');
  second.send('start');
  await waiting;

  const exited = once(first, 'exit');
  first.kill();
  await exited;
  await nextAcquired;

  const released = message(second, 'released');
  second.send('release');
  await released;
});

test('task failure releases the lock for later work', async t => {
  const f = await fixture(t);
  const lock = await createWriteCoordinator(f.file);

  await assert.rejects(
    lock(async () => { throw new Error('synthetic failure'); }),
    /synthetic failure/,
  );
  assert.equal(await lock(async () => 'next'), 'next');
});
test('lock waiting timeout never starts the waiting task', async t => {
  const f = await fixture(t);
  const firstLock = await createWriteCoordinator(f.file);
  const secondLock = await createWriteCoordinator(f.file, {
    waitMs: 100,
    retryMs: 10,
  });
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  let calls = 0;

  const first = firstLock(async () => {
    started.resolve();
    await release.promise;
  });
  await started.promise;

  try {
    await assert.rejects(
      secondLock(async () => { calls++; }),
      error => error.code === 'write_lock_timeout',
    );
    assert.equal(calls, 0);
  } finally {
    release.resolve();
    await first;
  }

  assert.equal(await secondLock(async () => 'next'), 'next');
});

test('cancelled lock waiter cannot execute after the lock is released', async t => {
  const f = await fixture(t);
  const firstLock = await createWriteCoordinator(f.file);
  const secondLock = await createWriteCoordinator(f.file);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const controller = new AbortController();
  let calls = 0;

  const first = firstLock(async () => {
    started.resolve();
    await release.promise;
  });
  await started.promise;

  const waiting = withRequestBudget(
    () => secondLock(async () => { calls++; }),
    { signal: controller.signal },
  );
  const rejected = assert.rejects(
    waiting,
    error => error.code === 'external_request_cancelled',
  );

  try {
    controller.abort();
    await rejected;
    assert.equal(calls, 0);
  } finally {
    release.resolve();
    await first;
  }

  assert.equal(await secondLock(async () => 'next'), 'next');
});
