import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailIntent } from '../lib/mail/intent.js';
import { openMailDeliveryStore } from '../lib/mail/delivery-store.js';
import { deliverMailOnce } from '../lib/mail/delivery.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mail-delivery-'));
  const store = await openMailDeliveryStore(join(directory, 'deliveries.sqlite'));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const message = { idempotencyKey: 'synthetic-key', to: 'recipient@example.test', subject: 'synthetic', text: 'synthetic', kind: 'security' };
  const options = { secret: 'synthetic-secret-at-least-32-characters' };
  const intent = createMailIntent(message, options);
  let sends = 0;
  let records = 0;
  return {
    store, intent,
    changedIntent: () => createMailIntent({ ...message, text: 'changed content' }, options),
    sends: () => sends, records: () => records,
    run: (overrides = {}) => deliverMailOnce({
      store, intent, checkHistory: async () => false,
      deliver: async () => { sends++; },
      recordDelivery: async () => { records++; },
      ...overrides,
    }),
  };
}

test('successful delivery is durably sent and repeated calls do not send again', async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).ok, true);
  assert.equal(f.store.get(f.intent.key).state, 'sent');
  assert.equal(f.store.get(f.intent.key).recorded, true);
  assert.equal((await f.run()).skipped, true);
  assert.equal(f.sends(), 1);
  assert.equal(f.records(), 1);
});

test('remote record failure repairs only the record and never repeats SMTP', async t => {
  const f = await fixture(t);
  const result = await f.run({ recordDelivery: async () => { throw new Error('synthetic record outage'); } });
  assert.equal(result.ok, true);
  assert.equal(result.recordPending, true);
  assert.equal(f.store.get(f.intent.key).state, 'sent');
  assert.equal(f.store.unrecordedSent().length, 1);
  const repaired = await f.run();
  assert.equal(repaired.skipped, true);
  assert.equal(repaired.recordPending, false);
  assert.equal(f.sends(), 1);
});

test('history read failure stops before claiming or sending', async t => {
  const f = await fixture(t);
  const result = await f.run({ checkHistory: async () => { throw new Error('private details'); } });
  assert.equal(result.code, 'mail_history_unavailable');
  assert.equal(f.sends(), 0);
  assert.equal(f.store.get(f.intent.key).state, 'pending');
  assert.ok(!JSON.stringify(result).includes('private details'));
});

test('failure before the body is sent returns to pending and the retry delivers', async t => {
  const f = await fixture(t);
  let attempts = 0;
  const result = await f.run({
    deliver: async () => {
      attempts++;
      if (attempts === 1) throw new Error('private SMTP details');
    },
  });
  assert.equal(result.code, 'mail_delivery_transport_failed');
  assert.equal(result.retryable, true);
  assert.equal(f.store.get(f.intent.key).state, 'pending');
  assert.equal(f.store.get(f.intent.key).stage, '');
  assert.ok(!JSON.stringify(result).includes('private SMTP details'));

  const retry = await f.run();
  assert.equal(retry.ok, true);
  assert.equal(f.store.get(f.intent.key).state, 'sent');
  assert.equal(attempts, 1);
  assert.equal(f.sends(), 1);
});

test('failure after the body was written is unknown and never automatically retried', async t => {
  const f = await fixture(t);
  let attempts = 0;
  const result = await f.run({
    deliver: async markData => {
      attempts++;
      markData();
      throw new Error('private SMTP details');
    },
  });
  assert.equal(result.code, 'mail_delivery_unknown');
  assert.equal(result.retryable, false);
  assert.equal(f.store.get(f.intent.key).state, 'unknown');
  // 阶段已落盘：进程此刻退出，重启恢复也不会重发。
  assert.equal(f.store.get(f.intent.key).stage, 'data');
  assert.equal((await f.run()).code, 'mail_delivery_unknown');
  assert.equal(attempts, 1);
  assert.equal(f.sends(), 0);
  assert.ok(!JSON.stringify(result).includes('private SMTP details'));
});

test('a server rejection after the body is still safe to retry', async t => {
  const f = await fixture(t);
  let attempts = 0;
  // SMTP 回了 451：正文发过，但服务器明确说没接收。
  const result = await f.run({
    deliver: async markData => {
      attempts++;
      markData();
      if (attempts === 1) {
        throw Object.assign(new Error('synthetic 451'), { deliveryOutcome: 'not_sent' });
      }
    },
  });
  assert.equal(result.code, 'mail_delivery_transport_failed');
  assert.equal(result.retryable, true);
  assert.equal(f.store.get(f.intent.key).state, 'pending');

  const retry = await f.run();
  assert.equal(retry.ok, true);
  assert.equal(f.store.get(f.intent.key).state, 'sent');
  assert.equal(attempts, 1);
  assert.equal(f.sends(), 1);
});

test('unfinished sending does not authorize a new attempt', async t => {
  const f = await fixture(t);
  f.store.create(f.intent);
  f.store.transition(f.intent.key, 'pending', 'sending');
  assert.equal((await f.run()).code, 'mail_delivery_unknown');
  assert.equal(f.sends(), 0);
});

test('same key with changed content is rejected before sending', async t => {
  const f = await fixture(t);
  await f.run();
  const result = await f.run({ intent: f.changedIntent() });
  assert.equal(result.code, 'mail_intent_conflict');
  assert.equal(f.sends(), 1);
});

test('success-state persistence failure cannot cause another SMTP attempt', async t => {
  const f = await fixture(t);
  const failingStore = {
    create: value => f.store.create(value),
    transition: (key, expected, next) => {
      if (next === 'sent') throw new Error('synthetic local disk outage');
      return f.store.transition(key, expected, next);
    },
  };
  const result = await f.run({ store: failingStore });
  assert.equal(result.ok, true);
  assert.equal(result.statePersistencePending, true);
  assert.equal(f.store.get(f.intent.key).state, 'sending');
  assert.equal((await f.run()).code, 'mail_delivery_unknown');
  assert.equal(f.sends(), 1);
});

test('concurrent calls claim a mail only once', async t => {
  const f = await fixture(t);
  await Promise.all([f.run(), f.run()]);
  assert.equal(f.sends(), 1);
  assert.equal(f.store.get(f.intent.key).state, 'sent');
});

test('positive remote delivery history imports success without sending', async t => {
  const f = await fixture(t);
  const result = await f.run({ checkHistory: async () => true });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(f.sends(), 0);
  assert.equal(f.records(), 0);
  assert.equal(f.store.get(f.intent.key).recorded, true);
});
