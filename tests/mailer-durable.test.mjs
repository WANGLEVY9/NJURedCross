import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMailDeliveryStore } from '../lib/mail/delivery-store.js';
import { configureMailer, sendMail, repairMailRecords } from '../lib/mailer.js';

const message = { to: 'recipient@example.test', subject: 'synthetic', text: 'synthetic', kind: 'security', idempotencyKey: 'synthetic-key' };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mailer-durable-'));
  const store = await openMailDeliveryStore(join(directory, 'mail.sqlite'));
  t.after(async () => { configureMailer({ isProduction: true }); store.close(); await rm(directory, { recursive: true, force: true }); });
  const rows = [];
  let sends = 0;
  let failRecord = false;
  let failHistory = false;
  const options = {
    isProduction: true, smtpHost: 'smtp.example.test', smtpUser: 'synthetic', smtpPassword: 'synthetic',
    deliveryStore: store, deliverySecret: 'synthetic-secret-at-least-32-characters',
    smtpSend: async () => { sends++; },
    getClient: async () => ({
      listRows: async (_table, _view, _order, _direction, start, limit) => {
        if (failHistory) throw new Error('private history failure');
        return rows.slice(start, start + limit);
      },
      appendRow: async (_table, row) => {
        if (failRecord) throw new Error('private record failure');
        rows.push({ ...row, _id: 'synthetic-record' });
      },
    }),
  };
  configureMailer(options);
  return { store, rows, options, sends: () => sends, historyFailure: value => { failHistory = value; }, recordFailure: value => { failRecord = value; } };
}

test('configured SMTP persists success and sends the same message once', async t => {
  const f = await fixture(t);
  assert.equal((await sendMail(message)).ok, true);
  assert.equal((await sendMail(message)).skipped, true);
  assert.equal(f.sends(), 1);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].记录ID, f.store.get(message.idempotencyKey).recordId);
});

test('remote failure is repaired without another SMTP attempt', async t => {
  const f = await fixture(t);
  f.recordFailure(true);
  assert.equal((await sendMail(message)).recordPending, true);
  assert.equal(f.store.get(message.idempotencyKey).state, 'sent');
  f.recordFailure(false);
  assert.equal((await repairMailRecords()).repaired, 1);
  assert.equal(f.rows.length, 1);
  assert.equal(f.sends(), 1);
});

test('known local success still skips sending when remote history is offline', async t => {
  const f = await fixture(t);
  await sendMail(message);
  f.historyFailure(true);
  const result = await sendMail(message);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(f.sends(), 1);
});

test('same key with changed content is refused by the SMTP entry', async t => {
  const f = await fixture(t);
  await sendMail(message);
  assert.equal((await sendMail({ ...message, text: 'changed' })).code, 'mail_intent_conflict');
  assert.equal(f.sends(), 1);
});

test('SMTP cannot run without durable state configuration', async t => {
  const f = await fixture(t);
  configureMailer({ ...f.options, deliveryStore: null });
  assert.equal((await sendMail(message)).code, 'mail_delivery_store_unavailable');
  assert.equal(f.sends(), 0);
});

test('console history is not SMTP delivery evidence', async t => {
  const f = await fixture(t);
  f.rows.push({ 幂等键: message.idempotencyKey, 状态: '已发送', 通道: 'console' });
  assert.equal((await sendMail(message)).ok, true);
  assert.equal(f.sends(), 1);
});

test('legacy history with another recipient stops sending', async t => {
  const f = await fixture(t);
  f.rows.push({ 幂等键: message.idempotencyKey, 状态: '已发送', 通道: 'smtp', 收件人: 'another@example.test', 主题: message.subject, 类型: message.kind });
  assert.equal((await sendMail(message)).code, 'mail_history_unavailable');
  assert.equal(f.sends(), 0);
});
