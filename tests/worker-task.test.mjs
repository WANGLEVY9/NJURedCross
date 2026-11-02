import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkerTask } from '../lib/worker-task.js';

const failure = () => new Error('sanitized worker failure');
function task(source, options = {}, settings = {}) {
  // Synthetic workers include deliberate crashes/timeouts; they are not application code.
  const env = { ...process.env };
  delete env.NODE_V8_COVERAGE;
  return runWorkerTask(new URL(`data:text/javascript,${encodeURIComponent(source)}`),
    { env, ...options }, { timeoutMs: 5000, failure, ...settings });
}

test('worker result waits for natural exit and pending cleanup', async () => {
  const state = new SharedArrayBuffer(4);
  const result = await task(`
    import { parentPort, workerData } from 'node:worker_threads';
    parentPort.postMessage({ ok: true });
    setTimeout(() => Atomics.store(new Int32Array(workerData), 0, 1), 100);
  `, { workerData: state });
  assert.deepEqual(result, { ok: true });
  assert.equal(Atomics.load(new Int32Array(state), 0), 1);
});

test('worker crash after posting a result rejects with a sanitized error', async () => {
  await assert.rejects(task(`
    import { parentPort } from 'node:worker_threads';
    parentPort.postMessage({ ok: true });
    throw new Error('private parser details');
  `), { message: 'sanitized worker failure' });
});

test('worker exit without a result rejects instead of hanging', async () => {
  await assert.rejects(task(''), { message: 'sanitized worker failure' });
});

test('worker timeout terminates unfinished work before rejecting', async () => {
  await assert.rejects(task('setInterval(() => {}, 1000)', {}, {
    timeoutMs: 100,
    timeoutFailure: () => new Error('worker timed out'),
  }), { message: 'worker timed out' });
});
