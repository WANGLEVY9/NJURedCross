import { createHmac } from 'node:crypto';

function invalid(message) {
  return Object.assign(new Error(message), {
    statusCode: 400,
    code: 'invalid_mail_intent',
  });
}

export function createMailIntent(message, { secret } = {}) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw invalid('邮件任务摘要需要至少32字符的密钥。');
  }

  const key = message.idempotencyKey;
  const to = message.to;
  const subject = message.subject;
  const text = message.text;
  const kind = message.kind || 'generic';

  if (
    typeof key !== 'string' || !key.trim() || key.length > 200
    || typeof to !== 'string' || !to.includes('@')
    || to.length > 320 || /[\r\n]/.test(to)
    || typeof subject !== 'string' || subject.length > 500
    || /[\r\n]/.test(subject)
    || typeof text !== 'string'
    || Buffer.byteLength(text, 'utf8') > 64 * 1024
    || typeof kind !== 'string' || !kind || kind.length > 80
  ) {
    throw invalid('邮件任务格式不正确。');
  }

  const normalized = {
    key: key.trim(),
    to: to.trim(),
    subject,
    text,
    kind,
  };

  const fingerprint = createHmac('sha256', secret)
    .update(JSON.stringify(normalized))
    .digest('hex');

  return {
    key: normalized.key,
    to: normalized.to,
    subject,
    kind,
    fingerprint,
  };
}

export function assertSameMailIntent(existing, incoming) {
  if (
    existing.key !== incoming.key
    || existing.fingerprint !== incoming.fingerprint
  ) {
    throw Object.assign(new Error('邮件幂等键已用于不同内容，不能重发或覆盖。'), {
      statusCode: 409,
      code: 'mail_intent_conflict',
    });
  }
}