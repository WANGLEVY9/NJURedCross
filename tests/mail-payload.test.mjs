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
