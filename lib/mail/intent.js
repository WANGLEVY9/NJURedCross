import { createHmac } from 'node:crypto';
import {mailAttachments,attachmentIntent} from './attachments.js';

function invalid(message) {
  return Object.assign(new Error(message), {
    statusCode: 400,
    code: 'invalid_mail_intent',
  });
}

/** 附件摘要（filename/contentType/sha256）格式校验，用于从加密信封恢复时复用。 */
function validAttachmentDigest(value) {
  return Array.isArray(value) && value.length <= 30 && value.every(item => item
    && typeof item.filename === 'string'
    && typeof item.contentType === 'string'
    && typeof item.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(item.sha256));
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
  try{
    const attachments=mailAttachments(message);
    if(attachments.length)normalized.attachments=attachmentIntent(attachments);
    // 从重试信封恢复时没有附件内容，只有随信封保存的摘要：用它复算同一个指纹，
    // 否则 seal 与 open 的 fingerprint 必然不同，补发会被判成「幂等键已用于不同内容」。
    else if(validAttachmentDigest(message.attachmentDigest))normalized.attachments=message.attachmentDigest;
  }catch{throw invalid('邮件附件格式不正确。');}

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
