import test from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableMailKind, planMailRetry } from '../lib/mail/retry-policy.js';

const input = {
  kind: 'security',
  state: 'pending',
  attempts: 0,
  now: 0,
  expiresAt: 24 * 60 * 60_000,
};

test('pending security notifications use bounded backoff', () => {
  const delays = [60_000, 300_000, 900_000, 3_600_000];

  for (let attempts = 0; attempts < delays.length; attempts++) {
    assert.deepEqual(planMailRetry({ ...input, attempts }), {
      retry: true,
      nextAttemptAt: delays[attempts],
    });
  }

  assert.equal(
    planMailRetry({ ...input, attempts: 4 }).reason,
    'attempt_limit',
  );
});

test('verification and overdue messages are excluded', () => {
  for (const kind of ['verification', 'overdue', 'other']) {
    assert.equal(
      planMailRetry({ ...input, kind }).reason,
      'unsupported_kind',
    );
  }
});

test('community author notices use the same bounded retry policy', () => {
  assert.deepEqual(planMailRetry({ ...input, kind: 'community-notification' }), { retry: true, nextAttemptAt: 60_000 });
});

test('宣传审核意见与通过通知进重试队列（2026-11-11）', () => {
  for (const kind of [
    'outreach.review.opinion.submitter',
    'outreach.review.opinion.liaison',
    'outreach.review.opinion.editor',
    'outreach.review.notice.next',
    'outreach.review.notice.done',
  ]) {
    assert.equal(isRetryableMailKind(kind), true, `${kind} 应可重试`);
    assert.deepEqual(planMailRetry({ ...input, kind }), { retry: true, nextAttemptAt: 60_000 });
  }
  // 前缀不能放得太宽：任何 outreach 前缀都不可重试。
  for (const kind of ['outreach', 'outreach.review', 'outreach.review.opinion', 'outreach.other']) {
    assert.equal(isRetryableMailKind(kind), false, `${kind} 不在白名单`);
  }
});

test('sending and uncertain deliveries cannot be retried', () => {
  for (const state of ['sending', 'unknown', 'sent', 'cancelled']) {
    assert.equal(
      planMailRetry({ ...input, state }).reason,
      'not_pending',
    );
  }
});

test('expired messages and retries beyond expiry are rejected', () => {
  assert.equal(
    planMailRetry({ ...input, expiresAt: 0 }).reason,
    'expired',
  );
  assert.equal(
    planMailRetry({ ...input, expiresAt: 60_000 }).reason,
    'expires_before_retry',
  );
});

test('invalid retry parameters are rejected', () => {
  for (const attempts of [-1, 0.5, NaN]) {
    assert.throws(
      () => planMailRetry({ ...input, attempts }),
      TypeError,
    );
  }

  assert.throws(
    () => planMailRetry({ ...input, expiresAt: NaN }),
    TypeError,
  );
});
