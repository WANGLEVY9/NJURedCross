import { Worker } from 'node:worker_threads';

/** Wait for worker exit as well as its response, so resources and coverage are flushed. */
export function runWorkerTask(url, options, { timeoutMs, failure, timeoutFailure = failure }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, options);
    let payload, received = false, error;
    const timer = setTimeout(() => {
      error = timeoutFailure();
      // Only unfinished work is forcibly stopped. Successful workers exit naturally.
      void worker.terminate().catch(() => reject(error));
    }, timeoutMs);
    worker.once('message', result => { payload = result; received = true; });
    worker.once('error', () => { error ||= failure(); });
    worker.once('exit', code => {
      clearTimeout(timer);
      if (error || code !== 0 || !received) reject(error || failure());
      else resolve(payload);
    });
  });
}
