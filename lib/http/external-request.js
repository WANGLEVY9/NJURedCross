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
 * The operation must pass the supplied signal to its HTTP request
 * and consume the response body before returning.
 */
export async function runExternalRequest(operation, {
  timeoutMs = DEFAULT_EXTERNAL_TIMEOUT_MS,
  signal,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('External request timeout must be a positive integer');
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
  } catch {
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    throw new ExternalRequestError(
      'external_request_failed',
      '外部服务连接失败，请稍后重试；写入结果可能需要核对。',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}