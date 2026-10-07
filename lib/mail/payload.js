import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { createMailIntent, assertSameMailIntent } from './intent.js';

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

  if (intent.kind !== 'security') throw failure();

  const payload = {
    idempotencyKey: intent.key,
    to: intent.to,
    subject: intent.subject,
    text: message.text,
    kind: intent.kind,
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
      || intent.kind !== 'security'
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
    return message;
  } catch {
    throw failure();
  }
}