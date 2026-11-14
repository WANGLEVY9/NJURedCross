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

test('community notifications persist encrypted retries and never duplicate confirmed SMTP', async t => {
  const f = await fixture(t);
  const notice = { ...message, kind: 'community-notification', subject: '你的祝福已送出', idempotencyKey: 'COMMUNITY:synthetic-delivery-1' };
  f.historyFailure(true);
  assert.equal((await sendMail(notice, { renderTemplate: false })).retryable, true);
  const job = f.retryStore.get(notice.idempotencyKey);
  assert.equal(job.status, 'queued');
  assert.equal(JSON.stringify(job.envelope).includes(notice.text), false);
  f.historyFailure(false);
  f.setTime(60_000);
  assert.equal((await retryQueuedMail()).completed, 1);
  assert.equal(f.sends, 1);
  await sendMail(notice, { renderTemplate: false });
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

test('a whitelisted kind with changed content reports the conflict, not a store failure', async t => {
  const f = await fixture(t);
  await sendMail(message);

  const result = await sendMail({ ...message, text: '模拟正文：内容已变更。' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'mail_intent_conflict');
  assert.ok(!result.reason.includes('synthetic'));
  assert.equal(f.sends, 1);
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

/**
 * 汇总邮件随附附件的补发：附件是加成，不能因为附件取不全把整封（含正文）丢掉。
 * 指纹按实际附件内容算，少带一个就与首次发送不同，必须整体降级为无附件。
 */
function digestMessage() {
  const contentA = Buffer.from('A'.repeat(2048));
  const contentB = Buffer.from('B'.repeat(1024));
  const docType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return {
    to: 'liaison@example.test',
    subject: '【南大红会】宣传审核待办（早报）· 2 条',
    text: '模拟正文：2 条待处理。',
    kind: 'outreach.digest.liaison',
    idempotencyKey: 'outreach-digest-synthetic-am-liaison@example.test',
    attachments: [
      { filename: '1-正文.docx', content: contentA, contentType: docType, attachmentId: 'ATT-1' },
      { filename: '2-配图.png', content: contentB, contentType: 'image/png', attachmentId: 'ATT-2' },
    ],
    attachmentRefs: [
      { attachmentId: 'ATT-1', filename: '1-正文.docx', contentType: docType, objectKey: '/内容投稿/博爱中心/献血周/ATT-1/正文.docx' },
      { attachmentId: 'ATT-2', filename: '2-配图.png', contentType: 'image/png', objectKey: '/内容投稿/博爱中心/献血周/ATT-2/配图.png' },
    ],
  };
}

test('digest attachments that all come back are attached again', async t => {
  const f = await fixture(t);
  const digest = digestMessage();
  f.historyFailure(true);
  assert.equal((await sendMail(digest)).retryable, true);

  const rebuilt = [];
  configureMailer({
    ...f.options,
    resolveAttachments: async refs => refs.map(ref => ({
      filename: ref.filename,
      content: Buffer.from(ref.attachmentId === 'ATT-1' ? 'A'.repeat(2048) : 'B'.repeat(1024)),
      contentType: ref.contentType,
      attachmentId: ref.attachmentId,
    })),
    smtpSend: async (_options, payload) => { rebuilt.push(payload); },
  });

  f.historyFailure(false);
  f.setTime(60_000);
  assert.equal((await retryQueuedMail()).completed, 1);
  assert.equal(rebuilt.length, 1, '补发应真正投递一次');
  assert.equal(rebuilt[0].attachments?.length, 2, '两个附件都应随补发带上');
});

test('digest attachments partially missing still deliver the body', async t => {
  const f = await fixture(t);
  const digest = digestMessage();
  f.historyFailure(true);
  assert.equal((await sendMail(digest)).retryable, true);

  const rebuilt = [];
  configureMailer({
    ...f.options,
    // 云盘上只剩一个（跨境超时/被移动），部分取回不能让整封作废。
    resolveAttachments: async () => [{
      filename: '1-正文.docx',
      content: Buffer.from('A'.repeat(2048)),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      attachmentId: 'ATT-1',
    }],
    smtpSend: async (_options, payload) => { rebuilt.push(payload); },
  });

  f.historyFailure(false);
  f.setTime(60_000);
  const outcome = await retryQueuedMail();
  assert.equal(outcome.completed, 1, '取回不全也应补发成功');
  assert.equal(rebuilt.length, 1);
  assert.equal(rebuilt[0].attachments, undefined, '不全就整体降级为无附件');
});
