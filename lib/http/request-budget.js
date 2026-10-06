import { AsyncLocalStorage } from 'node:async_hooks';
import { ExternalRequestError } from './external-request.js';

const budgets = new AsyncLocalStorage();

export function currentRequestBudget() {
  return budgets.getStore();
}

export function assertRequestActive() {
  const budget = currentRequestBudget();
  if (!budget) return;

  if (Date.now() >= budget.deadline && !budget.signal.aborted) {
    budget.expire();
  }
  budget.signal.throwIfAborted();
}

export async function withRequestBudget(operation, {
  timeoutMs = 30_000,
  signal,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Request budget must be a positive integer');
  }

  const controller = new AbortController();
  const timeoutError = new ExternalRequestError(
    'external_request_timeout',
    '操作等待超时；已执行的写入可能需要核对，请勿直接重复提交。',
  );
  const cancelledError = new ExternalRequestError(
    'external_request_cancelled',
    '请求已取消；已执行的写入可能需要核对。',
  );

  const expire = () => controller.abort(timeoutError);
  const cancel = () => controller.abort(
    signal?.reason instanceof ExternalRequestError
      ? signal.reason
      : cancelledError,
  );

  if (signal?.aborted) {
    cancel();
  } else {
    signal?.addEventListener('abort', cancel, { once: true });
  }

  const budget = {
    deadline: Date.now() + timeoutMs,
    signal: controller.signal,
    expire,
  };
  const timer = setTimeout(expire, timeoutMs);

  try {
    return await budgets.run(budget, async () => {
      assertRequestActive();
      return operation();
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
export async function withHttpRequestBudget(req, res, operation, options = {}) {
  const controller = new AbortController();

  const cancel = () => controller.abort();
  const responseClosed = () => {
    if (!res.writableFinished) cancel();
  };

  req.once('aborted', cancel);
  res.once('close', responseClosed);

  if (req.aborted || res.destroyed) cancel();

  try {
    return await withRequestBudget(operation, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    req.removeListener('aborted', cancel);
    res.removeListener('close', responseClosed);
  }
}
export function withoutRequestBudget(operation) {
  return budgets.run(undefined, operation);
}

export function awaitWithinRequest(promise) {
  const budget = currentRequestBudget();
  if (!budget) return promise;

  assertRequestActive();

  return new Promise((resolve, reject) => {
    const cancelled = () => {
      cleanup();
      reject(budget.signal.reason);
    };
    const cleanup = () => {
      budget.signal.removeEventListener('abort', cancelled);
    };

    budget.signal.addEventListener('abort', cancelled, { once: true });

    Promise.resolve(promise).then(value => {
      cleanup();
      try {
        assertRequestActive();
        resolve(value);
      } catch (error) {
        reject(error);
      }
    }, error => {
      cleanup();
      reject(error);
    });
  });
}