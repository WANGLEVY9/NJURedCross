const delays = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
];

/**
 * 整类可重试：安全类、社区通知，以及「早安晚安」的两封人际通知。
 *
 * `morning-comment` / `morning-invitation` 2026-11-15 补入：这两封都是用户点了按钮
 * 之后才发出的**一次性**通知，收件人是平台外的同学，发不出去没有任何补偿路径——
 * 评论人只看到一句「邮件暂时未发送成功」，再去催也不会重发，那条评论就永远躺在
 * 广场里没人知道。它们和注册通知同类，给同一套退避重试（4 次 / 24 小时内）。
 * 信封加密存储，评论正文与邀约附言不会明文落盘。
 */
const RETRYABLE_KINDS = Object.freeze([
  'security',
  'community-notification',
  'morning-comment',
  'morning-invitation',
]);

/**
 * 按前缀可重试：宣传审核的意见/通知邮件。
 *
 * 2026-11-11：`outreach.review.opinion.*` 原先不在白名单，SMTP 抖动一次意见就永久丢失，
 * 审核人却只看到「已退回」。这类邮件是审核链的凭证，必须和注册通知同等对待。
 * 命名约定见 lib/attachment/review.js：opinion.{submitter,liaison,editor}；
 * 汇总邮件见 lib/attachment/digest.js：digest.{liaison,reviewer,mixed}。
 */
const RETRYABLE_PREFIXES = Object.freeze([
  'outreach.review.opinion.',
  'outreach.review.notice.',
  'outreach.digest.',
  // 平台问题反馈：新问题派单通知与回复通知都是对提交人/处理人的一次性提醒，
  // 一旦 SMTP 抖动就永久丢失，和宣传审核意见同等对待（4 次 / 24 小时内退避重试）。
  'feedback.notice.',
  'feedback.reply.',
]);

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
