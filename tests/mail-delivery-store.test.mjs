import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailIntent } from '../lib/mail/intent.js';
import { openMailDeliveryStore } from '../lib/mail/delivery-store.js';

const secret = 'synthetic-secret-at-least-32-characters';
function intent(changes = {}) {
  return createMailIntent({
    idempotencyKey: 'synthetic-key', to: 'recipient@example.test',
    subject: 'synthetic subject', text: 'synthetic-private-code-123456',
    kind: 'verification', ...changes,
  }, { secret });
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mail-delivery-store-'));
  const file = join(directory, 'deliveries.sqlite');
  const stores = new Set();
  t.after(async () => {
    for (const store of stores) store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    file,
    async open() { const store = await openMailDeliveryStore(file); stores.add(store); return store; },
    close(store) { store.close(); stores.delete(store); },
  };
}

test('sent state survives reopening and cannot be sent again', async t => {
  const f = await fixture(t);
  let store = await f.open();
  const created = store.create(intent());
  store.transition('synthetic-key', 'pending', 'sending');
  store.transition('synthetic-key', 'sending', 'sent');
  f.close(store);
  store = await f.open();
  assert.equal(store.get('synthetic-key').state, 'sent');
  assert.equal(store.get('synthetic-key').recordId, created.recordId);
  assert.throws(() => store.transition('synthetic-key', 'sent', 'sending'));
});

test('restart before the body was written puts the message back to pending', async t => {
  const f = await fixture(t);
  let store = await f.open();
  store.create(intent());
  store.transition('synthetic-key', 'pending', 'sending');
  f.close(store);
  store = await f.open();
  // 正文没写出去，重发不会重复投递；卡在 sending 反而会让这封信永远发不出去。
  assert.equal(store.get('synthetic-key').state, 'pending');
  assert.equal(store.recovered.pending, 1);
  assert.equal(store.recovered.unknown, 0);
  assert.equal(store.transition('synthetic-key', 'pending', 'sending').state, 'sending');
});

test('restart after the body was written becomes unknown instead of resending', async t => {
  const f = await fixture(t);
  let store = await f.open();
  store.create(intent());
  store.transition('synthetic-key', 'pending', 'sending');
  store.markStage('synthetic-key', 'data');
  f.close(store);
  store = await f.open();
  assert.equal(store.get('synthetic-key').state, 'unknown');
  assert.equal(store.recovered.pending, 0);
  assert.equal(store.recovered.unknown, 1);
  assert.throws(() => store.transition('synthetic-key', 'unknown', 'pending'));
});

test('markStage only applies to a message that is being sent', async t => {
  const f = await fixture(t);
  const store = await f.open();
  store.create(intent());
  assert.throws(
    () => store.markStage('synthetic-key', 'data'),
    { code: 'mail_delivery_state_conflict' },
  );
  assert.throws(() => store.markStage('synthetic-key', 'delivered'), TypeError);
  store.transition('synthetic-key', 'pending', 'sending');
  assert.equal(store.markStage('synthetic-key', 'data').stage, 'data');
  // 退回重试时清掉上一轮的阶段，否则重启会误判成「正文已经发过」。
  store.transition('synthetic-key', 'sending', 'pending');
  assert.equal(store.get('synthetic-key').stage, '');
});

test('a database without the stage column keeps leftover sending as unknown', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mail-delivery-legacy-'));
  const file = join(directory, 'legacy.sqlite');

  const value = intent();
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE mail_deliveries (
      operation_key TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      intent_json TEXT NOT NULL,
      state TEXT NOT NULL,
      record_id TEXT NOT NULL UNIQUE,
      recorded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO mail_deliveries
      (operation_key, fingerprint, intent_json, state, record_id, recorded, created_at, updated_at)
    VALUES (?, ?, ?, 'sending', ?, 0, ?, ?)
  `).run(
    value.key,
    value.fingerprint,
    JSON.stringify(value),
    `MAIL-${randomUUID()}`,
    '2026-11-14T00:00:00.000Z',
    '2026-11-14T00:00:00.000Z',
  );
  db.close();

  const store = await openMailDeliveryStore(file);
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  // 升级前写下的 sending 行没有阶段信息，无从判断正文是否已发出——
  // 按结果不明处理，不能因为升级就重发一遍。
  assert.equal(store.get(value.key).state, 'unknown');
  assert.equal(store.recovered.unknown, 1);
  assert.equal(store.recovered.pending, 0);
});

test('two connections cannot claim the same pending mail', async t => {
  const f = await fixture(t);
  const first = await f.open();
  const second = await f.open();
  const created = first.create(intent());
  assert.equal(second.create(intent()).recordId, created.recordId);
  first.transition('synthetic-key', 'pending', 'sending');
  assert.throws(
    () => second.transition('synthetic-key', 'pending', 'sending'),
    { code: 'mail_delivery_state_conflict' },
  );
});

test('same key with a different message is refused', async t => {
  const f = await fixture(t);
  const store = await f.open();
  store.create(intent());
  assert.throws(() => store.create(intent({ to: 'another@example.test' })), {
    code: 'mail_intent_conflict',
  });
});

test('unknown results require reconciliation instead of automatic retry', async t => {
  const f = await fixture(t);
  const store = await f.open();
  store.create(intent());
  store.transition('synthetic-key', 'pending', 'sending');
  store.transition('synthetic-key', 'sending', 'unknown');
  assert.throws(() => store.transition('synthetic-key', 'unknown', 'pending'));
  assert.throws(() => store.transition('synthetic-key', 'unknown', 'sending'));
});

test('cancelled messages cannot be revived', async t => {
  const f = await fixture(t);
  const store = await f.open();
  store.create(intent());
  store.transition('synthetic-key', 'pending', 'cancelled');
  assert.throws(() => store.transition('synthetic-key', 'cancelled', 'pending'));
});

test('remote record repair selects only sent unrecorded tasks', async t => {
  const f = await fixture(t);
  const store = await f.open();
  store.create(intent());
  assert.equal(store.unrecordedSent().length, 0);
  assert.throws(() => store.markRecorded('synthetic-key'));
  store.transition('synthetic-key', 'pending', 'sending');
  store.transition('synthetic-key', 'sending', 'sent');
  assert.equal(store.unrecordedSent().length, 1);
  store.markRecorded('synthetic-key');
  assert.equal(store.get('synthetic-key').recorded, true);
  assert.equal(store.unrecordedSent().length, 0);
});

test('body and digest secret are not stored in the database', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const entry = store.create(intent());
  assert.equal(entry.intent.text, undefined);
  assert.throws(() => store.create({ ...intent(), text: 'private-code' }));
  f.close(store);
  const bytes = await readFile(f.file);
  assert.ok(!bytes.includes(Buffer.from('synthetic-private-code-123456')));
  assert.ok(!bytes.includes(Buffer.from(secret)));
});
