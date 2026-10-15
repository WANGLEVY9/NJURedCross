import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materialOperationIdentity } from '../lib/materials/operation.js';
import { openMaterialReceiptStore } from '../lib/materials/receipt-store.js';
import { createWriteCoordinator } from '../lib/materials/write-coordinator.js';
import { executeMaterialRecovery } from '../lib/materials/execute-recovery.js';

test('persisted receipt resumes failed application update after reopening', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'material-recovery-'));
  const receiptFile = join(directory, 'receipts.sqlite');
  let store;

  t.after(async () => {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  });

  const identity = materialOperationIdentity({
    idempotencyKey: 'synthetic-operation',
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

  const application = {
    _id: identity.payload.applicationId,
    状态: '开始',
  };
  const flows = [];
  let appUpdates = 0;
  let failUpdate = true;

  store = await openMaterialReceiptStore(receiptFile);
  store.create(receipt);
  const lock = await createWriteCoordinator(join(directory, 'lock.sqlite'));

  const execute = () => lock(() => executeMaterialRecovery({
    receipt: store.get(identity.key),
    incoming: identity,
    saveReceipt: value => store.save(value),
    readState: async () => ({
      application: structuredClone(application),
      flows: structuredClone(flows),
    }),
    appendFlow: async flow => {
      flows.push({ ...structuredClone(flow), _id: 'synthetic-flow' });
    },
    updateApplication: async (id, patch) => {
      assert.equal(id, application._id);
      appUpdates++;
      if (failUpdate) throw new Error('synthetic application outage');
      Object.assign(application, structuredClone(patch));
    },
  }));

  await assert.rejects(execute(), /synthetic application outage/);
  assert.equal(flows.length, 1);
  assert.equal(application.状态, '开始');
  assert.equal(store.get(identity.key).state, 'application_attempted');

  store.close();
  store = undefined;
  store = await openMaterialReceiptStore(receiptFile);
  failUpdate = false;

  const result = await execute();
  assert.equal(result.ok, true);
  assert.equal(flows.length, 1);
  assert.equal(application.状态, '借出（物资）');
  assert.equal(store.get(identity.key).state, 'completed');

  await execute();
  assert.equal(flows.length, 1);
  assert.equal(appUpdates, 2);
});
