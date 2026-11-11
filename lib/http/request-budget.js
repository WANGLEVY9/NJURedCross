import { AsyncLocalStorage } from 'node:async_hooks';
import { ExternalRequestError } from './external-request.js';

const budgets = new AsyncLocalStorage();

/**
 * 默认单请求预算：读路径用它兜底，避免上游卡死把连接一直占着。
 */
export const DEFAULT_REQUEST_BUDGET_MS = 30_000;

/**
 * 上传类接口的预算（2026-11-12）。
 *
 * 30 秒的读预算套在上传上会出事：影像与投稿附件的字节要经过本机中转，跨境链路下
 * 一张 5MB 原图端到端就要 60～90 秒；预算一到，SeaTable 那次写表会被 abort，
 * 结果是「文件已经进了云盘、相册/附件表里没有记录」，而前端只看到 500。
 * 放宽到 180 秒，与 nginx 的 proxy_read_timeout 对齐；单次 Box 上传仍有自己的
 * 60 秒超时，不会真的挂死。
 */
export const UPLOAD_REQUEST_BUDGET_MS = 180_000;

/** 需要放宽预算的上传接口（method + path 精确匹配，避免把普通写接口一起放宽）。 */
const UPLOAD_POST_PATTERNS = Object.freeze([
  /^\/api\/public\/media$/,                // 影像库中转上传（直传不可用时的兜底）
  /^\/api\/public\/attachments\/[^/]+$/,   // 投稿附件中转上传
  /^\/api\/console\/showcase\/batch$/,     // 展示封面批量上传
]);

/**
 * 按「方法 + 路径」给出这次请求该用多长的预算。
 * 除上传外一律走默认值，保持读路径的快速失败语义。
 */
export function requestBudgetMsFor(method, pathname) {
  const path = String(pathname || '');
  if (String(method || '').toUpperCase() === 'POST' && UPLOAD_POST_PATTERNS.some((pattern) => pattern.test(path))) {
    return UPLOAD_REQUEST_BUDGET_MS;
  }
  return DEFAULT_REQUEST_BUDGET_MS;
}

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
  timeoutMs = DEFAULT_REQUEST_BUDGET_MS,
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
      signal: options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal,
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