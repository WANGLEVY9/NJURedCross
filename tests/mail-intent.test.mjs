import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMailIntent,
  assertSameMailIntent,
} from '../lib/mail/intent.js';

const options = {
  secret: 'synthetic-secret-at-least-32-characters',
};
const message = {
  idempotencyKey: 'synthetic-key',
  to: 'recipient@example.test',
  subject: 'synthetic subject',
  text: 'synthetic private body',
  kind: 'verification',
};

test('identical mail content produces the same intent', () => {
  const first = createMailIntent(message, options);
  const second = createMailIntent({ ...message }, options);
  assert.deepEqual(first, second);
  assert.doesNotThrow(() => assertSameMailIntent(first, second));
});

test('same key cannot change recipient subject body or kind', () => {
  const original = createMailIntent(message, options);
  for (const change of [
    { to: 'another@example.test' },
    { subject: 'another subject' },
    { text: 'another body' },
    { kind: 'security' },
  ]) {
    assert.throws(
      () => assertSameMailIntent(
        original,
        createMailIntent({ ...message, ...change }, options),
      ),
      { code: 'mail_intent_conflict' },
    );
  }
});

test('stored intent does not contain the body or secret', () => {
  const intent = createMailIntent(message, options);
  const serialized = JSON.stringify(intent);
  assert.ok(!serialized.includes(message.text));
  assert.ok(!serialized.includes(options.secret));
  assert.equal(intent.text, undefined);
  assert.match(intent.fingerprint, /^[a-f0-9]{64}$/);
});

test('changing the digest secret does not silently reuse old state', () => {
  assert.throws(
    () => assertSameMailIntent(
      createMailIntent(message, options),
      createMailIntent(message, {
        secret: 'another-synthetic-secret-at-least-32-characters',
      }),
    ),
    { code: 'mail_intent_conflict' },
  );
});

test('missing key weak secret and header newlines are rejected', () => {
  for (const change of [
    { idempotencyKey: '' },
    { to: 'recipient@example.test\r\nBcc: another@example.test' },
    { subject: 'subject\nanother header' },
  ]) {
    assert.throws(
      () => createMailIntent({ ...message, ...change }, options),
      { code: 'invalid_mail_intent' },
    );
  }
  assert.throws(
    () => createMailIntent(message, { secret: 'short' }),
    { code: 'invalid_mail_intent' },
  );
});