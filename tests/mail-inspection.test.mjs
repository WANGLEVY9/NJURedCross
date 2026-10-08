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
import {
  inspectMailState,
  inspectMailTask,
  listMailAttention,
} from '../lib/mail/inspection.js';

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
test('task inspection links delivery and retry state by record ID', async t => {
  const f = await fixture(t);
  const key = f.add('unknown', 'stopped');
  const entry = f.delivery.get(key);

  const report = inspectMailTask(f.directory, entry.recordId);

  assert.equal(report.mode, 'read-only');
  assert.equal(report.writes, 0);
  assert.equal(report.found, true);
  assert.equal(report.recordId, entry.recordId);
  assert.equal(report.delivery.state, 'unknown');
  assert.equal(report.delivery.recorded, false);
  assert.equal(report.retry.status, 'stopped');
  assert.equal(report.retry.attempts, 0);

  assert.deepEqual(f.delivery.get(key), entry);
  assert.equal(f.retry.get(key).status, 'stopped');
});

test('task inspection does not expose private mail fields', async t => {
  const f = await fixture(t);
  const key = f.add('pending', 'queued');
  const entry = f.delivery.get(key);

  const output = JSON.stringify(
    inspectMailTask(f.directory, entry.recordId),
  );

  for (const privateValue of [
    key,
    secret,
    'private-student@example.test',
    '模拟私有主题',
    '模拟私有正文',
    entry.intent.fingerprint,
    f.retry.get(key).envelope.data,
  ]) {
    assert.ok(!output.includes(privateValue));
  }
});

test('delivery without a retry job reports no associated queue entry', async t => {
  const f = await fixture(t);
  const key = f.add('sent');
  const entry = f.delivery.get(key);

  const report = inspectMailTask(f.directory, entry.recordId);

  assert.equal(report.found, true);
  assert.equal(report.delivery.state, 'sent');
  assert.equal(report.retry, null);
});

test('missing record IDs are reported without creating tasks', async t => {
  const f = await fixture(t);
  const recordId = 'MAIL-00000000-0000-0000-0000-000000000000';

  const report = inspectMailTask(f.directory, recordId);

  assert.equal(report.found, false);
  assert.equal(report.delivery, null);
  assert.equal(report.retry, null);

  assert.deepEqual(inspectMailState(f.directory).delivery.states, {
    pending: 0,
    sending: 0,
    sent: 0,
    unknown: 0,
    cancelled: 0,
  });
});

test('invalid record identifiers are rejected', async t => {
  const f = await fixture(t);

  for (const recordId of [
    null,
    '',
    'CHANGE:synthetic-1',
    "' OR 1=1 --",
    '../mail-deliveries.sqlite',
  ]) {
    assert.throws(
      () => inspectMailTask(f.directory, recordId),
      unavailable,
    );
  }
});
test('attention list includes pending work and excludes completed records', async t => {
  const f = await fixture(t);

  const included = [
    f.add('pending'),
    f.add('sending'),
    f.add('unknown'),
    f.add('sent'),
  ].map(key => f.delivery.get(key).recordId).sort();

  const recordedKey = f.add('sent');
  f.delivery.markRecorded(recordedKey);
  f.add('cancelled');

  const report = listMailAttention(f.directory);

  assert.equal(report.mode, 'read-only');
  assert.equal(report.writes, 0);
  assert.deepEqual(
    report.items.map(item => item.recordId),
    included,
  );
  assert.equal(report.hasMore, false);
  assert.equal(report.nextCursor, null);
});

test('attention list pagination has no duplicates or missing fixture records', async t => {
  const f = await fixture(t);

  const expected = Array.from({ length: 5 }, () => {
    const key = f.add('unknown');
    return f.delivery.get(key).recordId;
  }).sort();

  const found = [];
  let after = null;
  let pages = 0;

  do {
    const report = listMailAttention(f.directory, {
      limit: 2,
      after,
    });

    assert.ok(report.items.length <= 2);
    found.push(...report.items.map(item => item.recordId));
    pages++;

    if (!report.hasMore) {
      assert.equal(report.nextCursor, null);
      break;
    }

    assert.equal(
      report.nextCursor,
      report.items.at(-1).recordId,
    );

    after = report.nextCursor;
    assert.ok(pages < 5);
  } while (after !== null);

  assert.equal(pages, 3);
  assert.deepEqual(found, expected);
  assert.equal(new Set(found).size, expected.length);
});

test('attention list excludes private content and preserves stored records', async t => {
  const f = await fixture(t);
  const key = f.add('pending', 'queued');
  const before = f.delivery.get(key);
  const queueBefore = f.retry.get(key);

  const output = JSON.stringify(listMailAttention(f.directory));

  for (const privateValue of [
    key,
    secret,
    'private-student@example.test',
    '模拟私有主题',
    '模拟私有正文',
    before.intent.fingerprint,
    queueBefore.envelope.data,
  ]) {
    assert.ok(!output.includes(privateValue));
  }

  assert.deepEqual(f.delivery.get(key), before);
  assert.deepEqual(f.retry.get(key), queueBefore);
});

test('attention list rejects invalid bounds and cursors', async t => {
  const f = await fixture(t);

  for (const limit of [0, 101, -1, 0.5, NaN]) {
    assert.throws(
      () => listMailAttention(f.directory, { limit }),
      unavailable,
    );
  }

  for (const after of ['', 'invalid', "' OR 1=1 --"]) {
    assert.throws(
      () => listMailAttention(f.directory, { after }),
      unavailable,
    );
  }
});

test('empty attention list clearly reports completion', async t => {
  const f = await fixture(t);

  const report = listMailAttention(f.directory, { limit: 1 });

  assert.deepEqual(report.items, []);
  assert.equal(report.hasMore, false);
  assert.equal(report.nextCursor, null);
});
