import { AsyncResource } from 'node:async_hooks';
import {
  assertRequestActive,
  currentRequestBudget,
} from '../http/request-budget.js';

export function createPasswordWorkQueue({
  concurrency = 2,
  maxWaiting = 32,
} = {}) {
  if (
    !Number.isSafeInteger(concurrency) || concurrency < 1
    || !Number.isSafeInteger(maxWaiting) || maxWaiting < 0
  ) {
    throw new TypeError('密码计算队列参数无效。');
  }

  let active = 0;
  const waiting = [];

  function drain() {
    while (active < concurrency && waiting.length > 0) {
      const job = waiting.shift();

      if (job.signal?.aborted) {
        job.cleanup();
        job.reject(job.signal.reason);
        continue;
      }

      job.started = true;
      active++;

      Promise.resolve()
        .then(job.operation)
        .then(job.resolve, job.reject)
        .finally(() => {
          job.cleanup();
          active--;
          drain();
        });
    }
  }

  return function run(operation) {
    assertRequestActive();

    if (typeof operation !== 'function') {
      throw new TypeError('缺少密码计算操作。');
    }

    if (active >= concurrency && waiting.length >= maxWaiting) {
      return Promise.reject(Object.assign(
        new Error('密码计算请求较多，请稍后重试。'),
        { statusCode: 503, code: 'password_work_busy' },
      ));
    }

    const signal = currentRequestBudget()?.signal;

    const bound = AsyncResource.bind(async () => {
      assertRequestActive();
      const result = await operation();
      assertRequestActive();
      return result;
    });

    return new Promise((resolve, reject) => {
      const job = {
        operation: bound,
        signal,
        started: false,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', cancelled),
      };

      function cancelled() {
        if (!job.started) {
          const index = waiting.indexOf(job);
          if (index >= 0) waiting.splice(index, 1);
          job.cleanup();
        }

        reject(signal.reason);
      }

      signal?.addEventListener('abort', cancelled, { once: true });
      waiting.push(job);
      drain();
    });
  };
}