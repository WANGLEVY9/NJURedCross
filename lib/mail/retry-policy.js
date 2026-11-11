const delays = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
];

/** 整类可重试：安全类与社区通知。 */
const RETRYABLE_KINDS = Object.freeze(['security', 'community-notification']);

/**
 * 按前缀可重试：宣传审核的意见/通知邮件。
 *
 * 2026-11-11：`outreach.review.opinion.*` 原先不在白名单，SMTP 抖动一次意见就永久丢失，
 * 审核人却只看到「已退回」。这类邮件是审核链的凭证，必须和注册通知同等对待。
 * 命名约定见 lib/attachment/review.js：opinion.{submitter,liaison,editor} /
 * notice.{next,done}。
 */
const RETRYABLE_PREFIXES = Object.freeze(['outreach.review.opinion.', 'outreach.review.notice.']);

export function isRetryableMailKind(kind) {
  const value = String(kind || '');
  if (!value) return false;
  return RETRYABLE_KINDS.includes(value)
    || RETRYABLE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function planMailRetry({
  kind,
  state,
  attempts,
  expiresAt,
  now = Date.now(),
}) {
  if (
    !Number.isSafeInteger(attempts) || attempts < 0
    || !Number.isFinite(now)
    || !Number.isFinite(expiresAt)
  ) {
    throw new TypeError('邮件重试参数无效。');
  }

  if (!isRetryableMailKind(kind)) {
    return { retry: false, reason: 'unsupported_kind' };
  }

  if (state !== 'pending') {
    return { retry: false, reason: 'not_pending' };
  }

  if (expiresAt <= now) {
    return { retry: false, reason: 'expired' };
  }

  if (attempts >= delays.length) {
    return { retry: false, reason: 'attempt_limit' };
  }

  const nextAttemptAt = now + delays[attempts];

  if (nextAttemptAt >= expiresAt) {
    return { retry: false, reason: 'expires_before_retry' };
  }

  return { retry: true, nextAttemptAt };
}
