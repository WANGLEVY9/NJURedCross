import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMailDeliveryStore } from '../lib/mail/delivery-store.js';
import { openMailRetryStore } from '../lib/mail/retry-store.js';
import { createMailIntent } from '../lib/mail/intent.js';
import { sealMailPayload } from '../lib/mail/payload.js';
import { inspectMailState } from '../lib/mail/inspection.js';

const secret = 'synthetic-inspection-secret-123456789';
const unavailable = error => (
  error.code === 'mail_inspection_unavailable'
);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mail-inspection-'));
  const delivery = await openMailDeliveryStore(
    join(directory, 'mail-deliveries.sqlite'),
  );
  const retry = await openMailRetryStore(
    join(directory, 'mail-retries.sqlite'),
  );

  t.after(async () => {
    retry.close();
    delivery.close();
    await rm(directory, { recursive: true, force: true });
  });

  let sequence = 0;

  return {
    directory,
    delivery,
    retry,

    add(state = 'pending', retryStatus = null) {
      const message = {
        idempotencyKey: `CHANGE:synthetic-${++sequence}`,
        to: 'private-student@example.test',
        subject: '模拟私有主题',
        text: '模拟私有正文',
        kind: 'security',
      };

      const intent = createMailIntent(message, { secret });
      delivery.create(intent);

      if (state === 'cancelled') {
        delivery.transition(intent.key, 'pending', 'cancelled');
      } else if (state !== 'pending') {
        delivery.transition(intent.key, 'pending', 'sending');
        if (state !== 'sending') {
          delivery.transition(intent.key, 'sending', state);
        }
      }

      if (retryStatus) {
        retry.enqueue({
          intent,
          envelope: sealMailPayload(message, { secret }),
          expiresAt: 100_000,
          nextAttemptAt: 1_000,
        });

        if (retryStatus !== 'queued') {
          retry.update(intent.key, 0, {
            attempts: 0,
            status: retryStatus,
            nextAttemptAt: 1_000,
          });
        }
      }

      return intent.key;
    },
  };
}

test('inspection reports delivery and retry counts', async t => {
  const f = await fixture(t);

  f.add('pending', 'queued');
  f.add('sending');
  f.add('sent', 'completed');
  f.add('unknown', 'stopped');
  f.add('cancelled');

  const report = inspectMailState(f.directory);

  assert.equal(report.mode, 'read-only');
  assert.equal(report.writes, 0);
  assert.equal(report.crossDatabaseAtomic, false);

  assert.deepEqual(report.delivery.states, {
    pending: 1,
    sending: 1,
    sent: 1,
    unknown: 1,
    cancelled: 1,
  });
  assert.equal(report.delivery.recordsPending, 1);

  assert.deepEqual(report.retry.states, {
    queued: 1,
    completed: 1,
    stopped: 1,
  });
});

test('inspection does not change stored jobs', async t => {
  const f = await fixture(t);
  const key = f.add('sent', 'queued');
  const deliveryBefore = f.delivery.get(key);
  const retryBefore = f.retry.get(key);

  inspectMailState(f.directory);
  inspectMailState(f.directory);

  assert.deepEqual(f.delivery.get(key), deliveryBefore);
  assert.deepEqual(f.retry.get(key), retryBefore);
});

test('inspection output excludes private mail content', async t => {
  const f = await fixture(t);
  const key = f.add('pending', 'queued');

  const output = JSON.stringify(inspectMailState(f.directory));

  for (const privateValue of [
    key,
    secret,
    'private-student@example.test',
    '模拟私有主题',
    '模拟私有正文',
    f.delivery.get(key).intent.fingerprint,
    f.retry.get(key).envelope.data,
  ]) {
    assert.ok(!output.includes(privateValue));
  }
});

test('missing databases fail without creating files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mail-missing-'));

  t.after(() => rm(directory, { recursive: true, force: true }));

  assert.throws(() => inspectMailState(directory), unavailable);

  for (const filename of [
    'mail-deliveries.sqlite',
    'mail-retries.sqlite',
  ]) {
    await assert.rejects(
      access(join(directory, filename)),
      error => error.code === 'ENOENT',
    );
  }
});

test('unknown stored states fail rather than produce misleading counts', async t => {
  const f = await fixture(t);
  const key = f.add();

  const db = new DatabaseSync(
    join(f.directory, 'mail-deliveries.sqlite'),
  );

  try {
    db.prepare(`
      UPDATE mail_deliveries SET state = 'invalid-test-state'
      WHERE operation_key = ?
    `).run(key);
  } finally {
    db.close();
  }

  assert.throws(() => inspectMailState(f.directory), unavailable);
});

test('invalid directories return a safe diagnostic error', () => {
  for (const directory of [null, '', '   ']) {
    assert.throws(() => inspectMailState(directory), unavailable);
  }
});