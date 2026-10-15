import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMailDeliveryStore } from '../lib/mail/delivery-store.js';
import { openMailRetryStore } from '../lib/mail/retry-store.js';
import {
  configureMailer,
  sendMail,
  retryQueuedMail,
} from '../lib/mailer.js';

const message = {
  to: 'student@example.test',
  subject: '模拟安全通知',
  text: '模拟正文：密码已修改。',
  kind: 'security',
  idempotencyKey: 'CHANGE:synthetic-integration-1',
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mailer-retry-'));
  const deliveryStore = await openMailDeliveryStore(
    join(directory, 'delivery.sqlite'),
  );
  const retryStore = await openMailRetryStore(
    join(directory, 'retry.sqlite'),
  );

  t.after(async () => {
    configureMailer({ isProduction: true });
    retryStore.close();
    deliveryStore.close();
    await rm(directory, { recursive: true, force: true });
  });

  let time = 0;
  let failHistory = false;
  let failSmtp = false;
  let sends = 0;
  const rows = [];

  const options = {
    isProduction: true,
    smtpHost: 'smtp.example.test',
    smtpUser: 'synthetic',
    smtpPassword: 'synthetic',
    deliverySecret: 'synthetic-integration-secret-123456789',
    deliveryStore,
    retryStore,
    now: () => time,
    smtpSend: async () => {
      sends++;
      if (failSmtp) throw new Error('synthetic-private-smtp-detail');
    },
    getClient: async () => ({
      listRows: async (_table, _view, _order, _direction, start, limit) => {
        if (failHistory) throw new Error('synthetic-history-offline');
        return rows.slice(start, start + limit);
      },
      appendRow: async (_table, row) => {
        rows.push({ ...row, _id: 'synthetic-record' });
      },
    }),
  };

  configureMailer(options);

  return {
    options,
    deliveryStore,
    retryStore,
    rows,
    setTime(value) { time = value; },
    historyFailure(value) { failHistory = value; },
    smtpFailure(value) { failSmtp = value; },
    get sends() { return sends; },
  };
}

test('pre-send failure is recovered by the queued delivery worker', async t => {
  const f = await fixture(t);
  f.historyFailure(true);

  const failed = await sendMail(message);
  assert.equal(failed.ok, false);
  assert.equal(failed.retryable, true);
  assert.equal(f.sends, 0);
  assert.equal(
    f.retryStore.get(message.idempotencyKey).status,
    'queued',
  );

  f.historyFailure(false);
  f.setTime(60_000);

  assert.equal((await retryQueuedMail()).completed, 1);
  assert.equal(f.sends, 1);
  assert.equal(f.rows.length, 1);

  await retryQueuedMail();
  assert.equal((await sendMail(message)).skipped, true);
  assert.equal(f.sends, 1);
});

test('uncertain SMTP result is not automatically sent again', async t => {
  const f = await fixture(t);
  f.smtpFailure(true);

  assert.equal((await sendMail(message)).ok, false);
  assert.equal(
    f.deliveryStore.get(message.idempotencyKey).state,
    'unknown',
  );

  f.smtpFailure(false);
  f.setTime(60_000);

  assert.equal((await retryQueuedMail()).stopped, 1);
  assert.equal(f.sends, 1);
});

test('verification messages never enter the retry queue', async t => {
  const f = await fixture(t);
  const verification = {
    ...message,
    kind: 'verification',
    idempotencyKey: 'VCD:synthetic-1',
  };

  assert.equal((await sendMail(verification)).ok, true);
  assert.equal(
    f.retryStore.get(verification.idempotencyKey),
    null,
  );
  assert.equal(f.sends, 1);
});

test('completed queue jobs still reject changed content', async t => {
  const f = await fixture(t);
  await sendMail(message);

  f.setTime(60_000);
  assert.equal((await retryQueuedMail()).completed, 1);

  const changed = await sendMail({
    ...message,
    text: '另一份模拟正文',
  });

  assert.equal(changed.ok, false);
  assert.equal(f.sends, 1);
});

test('expired queued notifications stop without SMTP delivery', async t => {
  const f = await fixture(t);
  f.historyFailure(true);
  await sendMail(message);

  f.historyFailure(false);
  f.setTime(24 * 60 * 60_000);

  assert.equal((await retryQueuedMail()).stopped, 1);
  assert.equal(f.sends, 0);
});

test('queue persistence failure prevents initial SMTP delivery', async t => {
  const f = await fixture(t);

  configureMailer({
    ...f.options,
    retryStore: {
      get() {
        throw new Error('synthetic-private-database-detail');
      },
    },
  });

  const result = await sendMail(message);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'mail_retry_store_unavailable');
  assert.equal(f.sends, 0);
  assert.ok(!result.reason.includes('synthetic-private'));
});