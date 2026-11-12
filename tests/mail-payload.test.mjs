import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailIntent } from '../lib/mail/intent.js';
import { sealMailPayload, openMailPayload } from '../lib/mail/payload.js';

const secret = 'synthetic-secret-for-mail-tests-123456789';
const message = {
  idempotencyKey: 'CHANGE:synthetic-1',
  to: 'student@example.test',
  subject: '模拟安全通知',
  text: '模拟正文：你的密码已修改。',
  kind: 'security',
};

const intent = createMailIntent(message, { secret });

const unavailable = error => error.code === 'mail_payload_unavailable';

test('encrypted payload restores the original notification', () => {
  const envelope = sealMailPayload(message, { secret });

  assert.deepEqual(
    openMailPayload(envelope, intent, { secret }),
    message,
  );
  assert.ok(!JSON.stringify(envelope).includes(message.text));
  assert.ok(!JSON.stringify(envelope).includes(secret));
});

test('each encryption uses a fresh nonce', () => {
  const first = sealMailPayload(message, { secret });
  const second = sealMailPayload(message, { secret });

  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.data, second.data);
});

test('tampered payloads and different keys cannot be recovered', () => {
  const envelope = sealMailPayload(message, { secret });
  const changed = {
    ...envelope,
    data: (envelope.data.startsWith('00') ? '01' : '00')
      + envelope.data.slice(2),
  };

  assert.throws(
    () => openMailPayload(changed, intent, { secret }),
    unavailable,
  );

  assert.throws(
    () => openMailPayload(envelope, intent, {
      secret: 'another-synthetic-secret-123456789012345',
    }),
    unavailable,
  );
});

test('encrypted content cannot be moved to another mail task', () => {
  const envelope = sealMailPayload(message, { secret });
  const other = createMailIntent({
    ...message,
    idempotencyKey: 'CHANGE:synthetic-2',
  }, { secret });

  assert.throws(
    () => openMailPayload(envelope, other, { secret }),
    unavailable,
  );
});

test('verification messages and malformed envelopes are rejected', () => {
  assert.throws(() => sealMailPayload({
    ...message,
    kind: 'verification',
  }, { secret }), unavailable);

  assert.throws(
    () => openMailPayload({}, intent, { secret }),
    unavailable,
  );
});

test('带附件的汇总邮件：信封只存引用与摘要，补发时指纹仍能对上', () => {
  const attachment = {
    filename: '1-正文.docx',
    content: Buffer.from('synthetic-file-body'),
    contentType: 'application/octet-stream',
    attachmentId: 'ATT-1',
  };
  const digestMessage = {
    idempotencyKey: 'outreach-digest-2026-11-13-08-liaison@example.test',
    to: 'liaison@example.test',
    subject: '【宣传待办·早间汇总】1 条（11-13 08:00）',
    text: '待办正文',
    kind: 'outreach.digest.liaison',
    attachments: [attachment],
    attachmentRefs: [{
      attachmentId: 'ATT-1',
      filename: '1-正文.docx',
      contentType: 'application/octet-stream',
      objectKey: '/内容投稿/博爱中心/献血周/ATT-1/正文.docx',
      provider: 'njubox',
      size: 20,
    }],
  };
  const digestIntent = createMailIntent(digestMessage, { secret });
  const envelope = sealMailPayload(digestMessage, { secret });
  const restored = openMailPayload(envelope, digestIntent, { secret });

  // 附件本体不进信封（SQLite 存不下），只留引用；摘要留给指纹复算。
  assert.equal(restored.attachments, undefined);
  assert.equal(restored.attachmentRefs.length, 1);
  assert.equal(restored.attachmentRefs[0].objectKey, '/内容投稿/博爱中心/献血周/ATT-1/正文.docx');
  assert.ok(!JSON.stringify(envelope).includes('synthetic-file-body'));

  // 补发时附件取不回来 → 没有 attachments，但指纹必须仍然一致。
  assert.equal(createMailIntent(restored, { secret }).fingerprint, digestIntent.fingerprint);
  // 取回来了 → 内容与文件名都没变时，指纹也一致。
  assert.equal(
    createMailIntent({ ...restored, attachments: [attachment] }, { secret }).fingerprint,
    digestIntent.fingerprint,
  );
  // 换了一个同名但内容不同的文件 → 指纹必须变，补发会被幂等校验拦下。
  assert.notEqual(
    createMailIntent({ ...restored, attachments: [{ ...attachment, content: Buffer.from('other') }] }, { secret }).fingerprint,
    digestIntent.fingerprint,
  );
});
