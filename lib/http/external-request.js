import {
  assertRequestActive,
  currentRequestBudget,
} from './request-budget.js';
import { observer } from '../observability.js';

export const DEFAULT_EXTERNAL_TIMEOUT_MS = 15_000;

export class ExternalRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExternalRequestError';
    this.code = code;
    this.statusCode = 503;
  }
}

/**
 * 传输层有时已经能断定「这次请求对端根本没受理」（例如 SMTP 在正文之前就失败了）。
 * 这个判断必须穿过这层统一包装交给调用方：被抹掉的话，调用方只能一律当作
 * 「结果不明」处理，一次网络抖动就会让一条通知永久发不出去。
 */
function carryOutcome(target, source) {
  if (
    target && typeof target === 'object'
    && source && typeof source === 'object'
    && typeof source.deliveryOutcome === 'string'
    && !target.deliveryOutcome
  ) {
    target.deliveryOutcome = source.deliveryOutcome;
  }
  return target;
}

/**
 * The operation must pass the supplied signal to its HTTP request
 * and consume the response body before returning.
 */
export function runExternalRequest(operation, options = {}) {
  return observer.dependency(options.service || 'external', options.operation || 'request',()=>runBudgetedExternalRequest(operation,options));
}

async function runBudgetedExternalRequest(operation, {
  timeoutMs = DEFAULT_EXTERNAL_TIMEOUT_MS,
  signal,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('External request timeout must be a positive integer');
  }

  assertRequestActive();
  const budget = currentRequestBudget();
  if (budget) {
    signal = signal
      ? AbortSignal.any([signal, budget.signal])
      : budget.signal;
  }

  const controller = new AbortController();
  const timeoutError = new ExternalRequestError(
    'external_request_timeout',
    '外部服务响应超时，请稍后重试；写入结果可能需要核对。',
  );
  const cancelledError = new ExternalRequestError(
    'external_request_cancelled',
    '外部服务请求已取消；写入结果可能需要核对。',
  );

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

  const timer = setTimeout(
    () => controller.abort(timeoutError),
    timeoutMs,
  );

  try {
    controller.signal.throwIfAborted();
    const result = await operation(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      throw carryOutcome(controller.signal.reason, error);
    }
    throw carryOutcome(new ExternalRequestError(
      'external_request_failed',
      '外部服务连接失败，请稍后重试；写入结果可能需要核对。',
    ), error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
