import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materialOperationIdentity } from '../lib/materials/operation.js';
import { openMaterialReceiptStore } from '../lib/materials/receipt-store.js';

function receipt() {
  const identity = materialOperationIdentity({
    idempotencyKey: 'synthetic-operation',
    applicationId: 'synthetic-application',
    assetCode: 'synthetic-asset',
    operation: '出库',
    quantity: 2,
    actor: 'synthetic-admin',
  });

  return {
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
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'material-receipts-'));
  const stores = [];
  t.after(async () => {
    for (const store of stores) store.close();
    await rm(directory, { recursive: true, force: true });
  });

  return {
    async open() {
      const store = await openMaterialReceiptStore(
        join(directory, 'receipts.sqlite'),
      );
      stores.push(store);
      return store;
    },
  };
}

test('receipt and recovery phase survive reopening the database', async t => {
  const f = await fixture(t);
  const first = await f.open();
  const original = receipt();

  first.create(original);
  first.save({ ...original, state: 'flow_attempted' });

  const reopened = await f.open();
  assert.deepEqual(reopened.get(original.identity.key), {
    ...original,
    state: 'flow_attempted',
  });
});

test('two connections share the unique operation key', async t => {
  const f = await fixture(t);
  const first = await f.open();
  const second = await f.open();
  const original = receipt();

  first.create(original);
  assert.deepEqual(second.create(original), original);

  first.save({ ...original, state: 'flow_attempted' });
  assert.equal(second.create(original).state, 'flow_attempted');
});

test('same key cannot be reused for different operation content', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const original = receipt();
  store.create(original);

  const changedIdentity = materialOperationIdentity({
    ...original.identity.payload,
    idempotencyKey: original.identity.key,
    quantity: 3,
  });

  assert.throws(
    () => store.create({
      ...original,
      identity: changedIdentity,
      flow: { ...original.flow, 数量: 3 },
    }),
    error => error.code === 'material_operation_conflict',
  );

  assert.deepEqual(store.get(original.identity.key), original);
});

test('saved execution plans cannot be overwritten', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const original = receipt();
  store.create(original);

  assert.throws(
    () => store.save({
      ...original,
      after: { 状态: '已归还' },
      state: 'flow_attempted',
    }),
    error => error.code === 'material_receipt_conflict',
  );

  assert.deepEqual(store.get(original.identity.key), original);
});

test('stale connections cannot move the recovery phase backwards', async t => {
  const f = await fixture(t);
  const first = await f.open();
  const second = await f.open();
  const original = receipt();
  first.create(original);
  first.save({ ...original, state: 'application_attempted' });

  assert.throws(
    () => second.save({ ...original, state: 'flow_attempted' }),
    error => error.code === 'material_receipt_conflict',
  );

  assert.equal(first.get(original.identity.key).state, 'application_attempted');
});

test('missing or invalid receipts cannot be saved', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const original = receipt();

  assert.equal(store.get('missing'), null);
  assert.throws(
    () => store.save(original),
    error => error.code === 'material_receipt_conflict',
  );
  assert.throws(
    () => store.create({ ...original, state: 'completed' }),
    error => error.code === 'material_receipt_conflict',
  );
});
test('pending application lookup excludes completed receipts', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const original = receipt();
  store.create(original);

  assert.equal(
    store.pendingForApplication('synthetic-application').length,
    1,
  );
  assert.equal(store.pendingForApplication('another-application').length, 0);

  store.save({ ...original, state: 'completed' });

  assert.equal(
    store.pendingForApplication('synthetic-application').length,
    0,
  );
});

test('pending asset lookup excludes completed receipts', async t => {
  const f = await fixture(t);
  const store = await f.open();
  const original = receipt();
  const assetCode = original.identity.payload.assetCode;
  store.create(original);

  assert.equal(store.pendingForAsset(assetCode).length, 1);
  assert.equal(store.pendingForAsset('another-asset').length, 0);

  store.save({ ...original, state: 'completed' });

  assert.equal(store.pendingForAsset(assetCode).length, 0);
});