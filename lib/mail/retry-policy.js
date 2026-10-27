const delays = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
];

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

  if (kind !== 'security') {
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