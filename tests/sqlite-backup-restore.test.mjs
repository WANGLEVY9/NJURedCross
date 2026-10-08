import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import {
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAuditReconciliationStore } from '../lib/audit/reconciliation-store.js';
import { openMaterialReceiptStore } from '../lib/materials/receipt-store.js';
import { materialOperationIdentity } from '../lib/materials/operation.js';
import { openMailDeliveryStore } from '../lib/mail/delivery-store.js';
import { openMailRetryStore } from '../lib/mail/retry-store.js';
import { createMailIntent } from '../lib/mail/intent.js';
import { sealMailPayload, openMailPayload } from '../lib/mail/payload.js';

async function fixture(t) {
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, 'sqlite-restore-'));
  const databases = [];

  t.after(async () => {
    for (const db of databases) db.close();
    await rm(root, { recursive: true, force: true });
  });

  return {
    root,
    track(store) {
      databases.push(store);
      return store;
    },
    open(file) {
      const db = new DatabaseSync(file);
      databases.push(db);
      return db;
    },
  };
}

function snapshot(source, destination) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.prepare('VACUUM INTO ?').run(destination);
  } finally {
    db.close();
  }
}

test('a snapshot includes committed WAL data and restores independently', async t => {
  const f = await fixture(t);
  const source = join(f.root, 'source.sqlite');
  const backup = join(f.root, 'backup.sqlite');
  const restored = join(f.root, 'restored.sqlite');
  const db = f.open(source);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE synthetic_state (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL
    );
    PRAGMA wal_checkpoint(TRUNCATE);
  `);

  db.prepare(
    'INSERT INTO synthetic_state VALUES (?, ?)',
  ).run('synthetic-operation', 'unconfirmed');

  assert.ok((await stat(source + '-wal')).size > 0);
  snapshot(source, backup);

  // Changes after the snapshot must not change the restored snapshot.
  db.prepare(
    'UPDATE synthetic_state SET state = ? WHERE id = ?',
  ).run('confirmed', 'synthetic-operation');

  await copyFile(backup, restored, constants.COPYFILE_EXCL);
  const recovered = f.open(restored);

  assert.equal(
    recovered.prepare('PRAGMA integrity_check').get().integrity_check,
    'ok',
  );
  assert.equal(
    recovered.prepare(
      'SELECT state FROM synthetic_state WHERE id = ?',
    ).get('synthetic-operation').state,
    'unconfirmed',
  );
  assert.equal(
    db.prepare(
      'SELECT state FROM synthetic_state WHERE id = ?',
    ).get('synthetic-operation').state,
    'confirmed',
  );
});

test('a snapshot does not include an uncommitted transaction', async t => {
  const f = await fixture(t);
  const source = join(f.root, 'source.sqlite');
  const backup = join(f.root, 'backup.sqlite');
  const db = f.open(source);

  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE synthetic_state (id TEXT PRIMARY KEY);
    INSERT INTO synthetic_state VALUES ('committed');
    BEGIN IMMEDIATE;
    INSERT INTO synthetic_state VALUES ('uncommitted');
  `);

  try {
    snapshot(source, backup);
  } finally {
    db.exec('ROLLBACK');
  }

  const recovered = f.open(backup);
  const rows = recovered.prepare(
    'SELECT id FROM synthetic_state ORDER BY id',
  ).all();

  assert.deepEqual(rows.map(row => row.id), ['committed']);
});

test('snapshot creation does not overwrite a nonempty destination', async t => {
  const f = await fixture(t);
  const source = join(f.root, 'source.sqlite');
  const backup = join(f.root, 'existing-backup');
  const db = f.open(source);
  db.exec('CREATE TABLE synthetic_state (id TEXT PRIMARY KEY)');

  await writeFile(backup, 'synthetic-existing-backup');

  assert.throws(() => snapshot(source, backup));
  assert.equal(
    await readFile(backup, 'utf8'),
    'synthetic-existing-backup',
  );
});

test('restored audit receipts preserve encryption context and uncertain state', async t => {
  const f = await fixture(t);
  const source = join(f.root, 'audit-source.sqlite');
  const backup = join(f.root, 'audit-backup.sqlite');
  const restored = join(f.root, 'audit-restored.sqlite');
  const options = {
    secret: 'synthetic-audit-backup-secret-at-least-32-characters',
    baseUuid: '00000000-0000-4000-8000-000000000001',
  };

  const store = f.track(await openAuditReconciliationStore(source, options));
  const row = {
    审计ID: 'AUD-backup-001',
    时间: '2026-01-01T00:00:00.000Z',
    操作人: 'synthetic-private-actor',
    角色: 'platform_admin',
    动作: 'materials.synthetic',
    对象: 'synthetic-private-target',
    结果: 'success',
    IP: 'synthetic-private-address',
    备注: '{"quantity":2}',
  };

  store.prepare(row);
  store.claimAttempt(row['审计ID']);
  store.transition(row['审计ID'], 'unconfirmed');
  const expected = store.get(row['审计ID']);

  snapshot(source, backup);
  await copyFile(backup, restored, constants.COPYFILE_EXCL);

  const recovered = f.track(
    await openAuditReconciliationStore(restored, options),
  );

  assert.deepEqual(recovered.get(row['审计ID']), expected);
  assert.equal(recovered.summary().unconfirmed, 1);

  await assert.rejects(
    openAuditReconciliationStore(restored, {
      ...options,
      secret: 'synthetic-wrong-backup-secret-at-least-32-characters',
    }),
    { code: 'audit_reconciliation_conflict' },
  );

  await assert.rejects(
    openAuditReconciliationStore(restored, {
      ...options,
      baseUuid: '00000000-0000-4000-8000-000000000002',
    }),
    { code: 'audit_reconciliation_conflict' },
  );

  assert.deepEqual(recovered.get(row['审计ID']), expected);
});

test('restored material receipts preserve the unfinished execution plan', async t => {
  const f = await fixture(t);
  const source = join(f.root, 'material-source.sqlite');
  const backup = join(f.root, 'material-backup.sqlite');
  const restored = join(f.root, 'material-restored.sqlite');
  const store = f.track(await openMaterialReceiptStore(source));

  const identity = materialOperationIdentity({
    idempotencyKey: 'synthetic-backup-operation',
    applicationId: 'synthetic-application',
    assetCode: 'synthetic-asset',
    operation: '出库',
    quantity: 2,
    actor: 'synthetic-admin',
  });

  const receipt = {
    identity,
    flow: {
      幂等键: identity.key,
      申请单ID: identity.payload.applicationId,
      资产编码: identity.payload.assetCode,
      操作类型: '出库',
      数量: 2,
    },
    before: { 状态: '开始' },
    after: { 状态: '借出（物资）' },
    state: 'prepared',
  };

  store.create(receipt);
  store.save({ ...receipt, state: 'flow_attempted' });
  const expected = store.get(identity.key);

  snapshot(source, backup);
  await copyFile(backup, restored, constants.COPYFILE_EXCL);
  const recovered = f.track(await openMaterialReceiptStore(restored));

  assert.deepEqual(recovered.get(identity.key), expected);
  assert.equal(recovered.pendingForAsset('synthetic-asset').length, 1);
  assert.equal(
    recovered.pendingForApplication('synthetic-application').length,
    1,
  );
});

test('restored mail delivery states retain uncertainty and pending record repair', async t => {
  const f = await fixture(t);
  const secret = 'synthetic-mail-backup-secret-at-least-32-characters';

  for (const state of ['unknown', 'sent']) {
    const source = join(f.root, `delivery-${state}-source.sqlite`);
    const backup = join(f.root, `delivery-${state}-backup.sqlite`);
    const restored = join(f.root, `delivery-${state}-restored.sqlite`);
    const store = f.track(await openMailDeliveryStore(source));

    const intent = createMailIntent({
      idempotencyKey: `synthetic-delivery-${state}`,
      to: 'student@example.test',
      subject: '模拟通知',
      text: '模拟通知正文',
      kind: 'security',
    }, { secret });

    store.create(intent);
    store.transition(intent.key, 'pending', 'sending');
    store.transition(intent.key, 'sending', state);
    const expected = store.get(intent.key);

    snapshot(source, backup);
    await copyFile(backup, restored, constants.COPYFILE_EXCL);
    const recovered = f.track(await openMailDeliveryStore(restored));

    assert.deepEqual(recovered.get(intent.key), expected);
    assert.equal(recovered.get(intent.key).recorded, false);

    assert.throws(
      () => recovered.transition(intent.key, state, 'sending'),
      { code: 'mail_delivery_state_conflict' },
    );
  }
});

test('restored mail retries preserve encrypted content, attempts and expiry', async t => {
  const f = await fixture(t);
  const source = join(f.root, 'retry-source.sqlite');
  const backup = join(f.root, 'retry-backup.sqlite');
  const restored = join(f.root, 'retry-restored.sqlite');
  const store = f.track(await openMailRetryStore(source));
  const secret = 'synthetic-mail-backup-secret-at-least-32-characters';

  const message = {
    idempotencyKey: 'synthetic-security-retry',
    to: 'student@example.test',
    subject: '模拟安全通知',
    text: '模拟私有正文：密码已修改。',
    kind: 'security',
  };

  const intent = createMailIntent(message, { secret });
  store.enqueue({
    intent,
    envelope: sealMailPayload(message, { secret }),
    expiresAt: 100000,
    nextAttemptAt: 1000,
  });

  store.update(intent.key, 0, {
    attempts: 1,
    status: 'queued',
    nextAttemptAt: 2000,
  });
  store.update(intent.key, 1, {
    attempts: 2,
    status: 'queued',
    nextAttemptAt: 3000,
  });

  const expected = store.get(intent.key);
  snapshot(source, backup);
  await copyFile(backup, restored, constants.COPYFILE_EXCL);
  const recovered = f.track(await openMailRetryStore(restored));
  const job = recovered.get(intent.key);

  assert.deepEqual(job, expected);
  assert.equal(job.attempts, 2);
  assert.equal(job.expiresAt, 100000);
  assert.equal(job.nextAttemptAt, 3000);
  assert.deepEqual(
    openMailPayload(job.envelope, job.intent, { secret }),
    message,
  );

  assert.throws(
    () => openMailPayload(job.envelope, job.intent, {
      secret: 'synthetic-wrong-mail-secret-at-least-32-characters',
    }),
    { code: 'mail_payload_unavailable' },
  );

  assert.deepEqual(recovered.get(intent.key), expected);
});