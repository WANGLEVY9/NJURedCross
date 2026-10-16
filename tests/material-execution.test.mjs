import test from 'node:test';
import assert from 'node:assert/strict';
import { materialOperationIdentity } from '../lib/materials/operation.js';
import { executeMaterialRecovery } from '../lib/materials/execute-recovery.js';

function fixture() {
  const identity = materialOperationIdentity({
    idempotencyKey: 'synthetic-operation',
    applicationId: 'synthetic-application',
    assetCode: 'synthetic-asset',
    operation: '出库',
    quantity: 2,
    actor: 'synthetic-admin',
  });

  let stored = {
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
  const calls = [];

  const dependencies = {
    incoming: identity,
    async saveReceipt(receipt) {
      calls.push(`save:${receipt.state}`);
      stored = structuredClone(receipt);
    },
    async readState() {
      return {
        application: structuredClone(application),
        flows: structuredClone(flows),
      };
    },
    async appendFlow(flow) {
      calls.push('append');
      flows.push({ ...structuredClone(flow), _id: 'synthetic-flow' });
    },
    async updateApplication(id, patch) {
      assert.equal(id, application._id);
      calls.push('update');
      Object.assign(application, structuredClone(patch));
    },
  };

  return {
    calls,
    flows,
    application,
    dependencies,
    receipt: () => structuredClone(stored),
    run(overrides = {}) {
      return executeMaterialRecovery({
        ...dependencies,
        ...overrides,
        receipt: structuredClone(stored),
      });
    },
  };
}

test('execution saves intent before each write and confirms completion', async () => {
  const f = fixture();
  const result = await f.run();

  assert.equal(result.ok, true);
  assert.equal(f.receipt().state, 'completed');
  assert.deepEqual(f.calls, [
    'save:flow_attempted',
    'append',
    'save:application_attempted',
    'update',
    'save:completed',
  ]);
  assert.equal(f.flows.length, 1);
});

test('failed receipt persistence prevents the first business write', async () => {
  const f = fixture();

  await assert.rejects(f.run({
    async saveReceipt() {
      throw new Error('synthetic persistence failure');
    },
  }), /synthetic persistence failure/);

  assert.equal(f.flows.length, 0);
  assert.equal(f.application.状态, '开始');
});

test('application failure resumes from stored receipt without another flow', async () => {
  const f = fixture();

  await assert.rejects(f.run({
    async updateApplication() {
      throw new Error('synthetic application failure');
    },
  }), /synthetic application failure/);

  assert.equal(f.flows.length, 1);
  assert.equal(f.receipt().state, 'application_attempted');

  // A fresh executor invocation uses only persisted receipt and table state.
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(f.flows.length, 1);
  assert.equal(f.application.状态, '借出（物资）');
  assert.equal(f.calls.filter(call => call === 'append').length, 1);
});

test('lost flow response is recovered through an authoritative read', async () => {
  const f = fixture();

  await assert.rejects(f.run({
    async appendFlow(flow) {
      await f.dependencies.appendFlow(flow);
      throw new Error('synthetic lost response');
    },
  }), /synthetic lost response/);

  assert.equal(f.receipt().state, 'flow_attempted');

  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(f.flows.length, 1);
});

test('unknown flow outcome never triggers a blind repeat write', async () => {
  const f = fixture();

  await assert.rejects(f.run({
    async appendFlow() {
      f.calls.push('uncertain-append');
      throw new Error('synthetic unknown outcome');
    },
  }), /synthetic unknown outcome/);

  await assert.rejects(
    f.run(),
    error => error.code === 'material_write_outcome_unknown',
  );

  assert.equal(f.calls.filter(call => call === 'uncertain-append').length, 1);
  assert.equal(f.calls.includes('append'), false);
});

test('lost application response completes without reapplying the patch', async () => {
  const f = fixture();

  await assert.rejects(f.run({
    async updateApplication(id, patch) {
      await f.dependencies.updateApplication(id, patch);
      throw new Error('synthetic lost application response');
    },
  }), /synthetic lost application response/);

  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(f.calls.filter(call => call === 'update').length, 1);
});

test('completed operations are confirmed without repeating writes', async () => {
  const f = fixture();
  await f.run();
  const callsBeforeRetry = [...f.calls];

  await f.run();

  assert.deepEqual(f.calls, callsBeforeRetry);
  assert.equal(f.flows.length, 1);
});