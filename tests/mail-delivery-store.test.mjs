import test from 'node:test';
import assert from 'node:assert/strict';
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

test('unfinished sending survives reopening and cannot return to pending', async t => {
  const f = await fixture(t);
  let store = await f.open();
  store.create(intent());
  store.transition('synthetic-key', 'pending', 'sending');
  f.close(store);
  store = await f.open();
  assert.equal(store.get('synthetic-key').state, 'sending');
  assert.throws(() => store.transition('synthetic-key', 'sending', 'pending'));
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
