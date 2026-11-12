import { isRetryableMailKind } from './retry-policy.js';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { createMailIntent, assertSameMailIntent } from './intent.js';
import { mailAttachments, attachmentIntent, attachmentRefs } from './attachments.js';

function failure() {
  return Object.assign(
    new Error('邮件正文无法安全恢复，任务必须停止。'),
    { code: 'mail_payload_unavailable' },
  );
}

function encryptionKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw failure();
  }

  return createHmac('sha256', secret)
    .update('nju-redcross/mail-payload/v1')
    .digest();
}

function associatedData(intent) {
  return Buffer.from(JSON.stringify([
    1,
    intent.key,
    intent.fingerprint,
  ]));
}

export function sealMailPayload(message, { secret } = {}) {
  const intent = createMailIntent(message, { secret });

  if (!isRetryableMailKind(intent.kind)) throw failure();

  /*
   * 附件内容不进信封：加密载荷走 SQLite，单条明文上限 80KB，一张原图就能撑爆。
   * 这里存两样小东西——
   *   · attachmentRefs   附件 ID / 文件名 / 类型，补发时按它重新去云盘取；
   *   · attachmentDigest 附件内容的 sha256 摘要，让 open 时能复算出同一个指纹。
   */
  let attachments = [];
  try { attachments = mailAttachments(message); } catch { attachments = []; }
  // 调用方可以给出更完整的引用（带云盘路径），补发时就不必再查一次表；
  // 没给就退化成「只有附件 ID」，由解析器自己找回定位。
  const refs = Array.isArray(message.attachmentRefs) && message.attachmentRefs.length
    ? message.attachmentRefs
    : attachmentRefs(attachments);

  const payload = {
    idempotencyKey: intent.key,
    to: intent.to,
    subject: intent.subject,
    text: message.text,
    kind: intent.kind,
    ...(refs.length ? { attachmentRefs: refs, attachmentDigest: attachmentIntent(attachments) } : {}),
  };

  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    iv,
  );

  cipher.setAAD(associatedData(intent));

  const data = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);

  return {
    version: 1,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex'),
  };
}

export function openMailPayload(envelope, intent, { secret } = {}) {
  try {
    if (
      !envelope || envelope.version !== 1
      || !/^[a-f0-9]{24}$/.test(envelope.iv || '')
      || !/^[a-f0-9]{32}$/.test(envelope.tag || '')
      || typeof envelope.data !== 'string'
      || !/^(?:[a-f0-9]{2})+$/.test(envelope.data)
      || envelope.data.length > 160_000
      || !isRetryableMailKind(intent.kind)
    ) {
      throw failure();
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(secret),
      Buffer.from(envelope.iv, 'hex'),
    );

    decipher.setAAD(associatedData(intent));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));

    const bytes = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'hex')),
      decipher.final(),
    ]);

    const message = JSON.parse(bytes.toString('utf8'));
    const recovered = createMailIntent(message, { secret });

    assertSameMailIntent(intent, recovered);
    // attachmentDigest 留在 message 里：补发时若附件取不回来，createMailIntent 靠它
    // 复算出同一个指纹，才不会把「同一条任务少带了附件」误判成幂等键冲突。
    return message;
  } catch {
    throw failure();
  }
}