import test from 'node:test';
import assert from 'node:assert/strict';
import { materialOperationIdentity } from '../lib/materials/operation.js';
import { planMaterialRecovery } from '../lib/materials/recovery.js';

function fixture() {
  const identity = materialOperationIdentity({
    idempotencyKey: 'synthetic-operation',
    applicationId: 'synthetic-application',
    assetCode: 'synthetic-asset',
    operation: '出库',
    quantity: 2,
    actor: 'synthetic-admin',
  });

  const flow = {
    幂等键: identity.key,
    申请单ID: identity.payload.applicationId,
    资产编码: identity.payload.assetCode,
    操作类型: '出库',
    数量: 2,
    操作人: 'synthetic-admin',
  };

  return {
    receipt: {
      identity,
      flow,
      before: { 状态: '开始' },
      after: { 状态: '借出（物资）' },
      state: 'prepared',
    },
    incoming: identity,
    flows: [],
    application: {
      _id: 'synthetic-application',
      状态: '开始',
    },
  };
}

test('prepared operation may start its first flow write', () => {
  assert.deepEqual(
    planMaterialRecovery(fixture()),
    { action: 'append_flow' },
  );
});

test('existing flow resumes the failed application update', () => {
  const input = fixture();
  input.receipt.state = 'flow_attempted';
  input.flows = [{ ...input.receipt.flow, _id: 'synthetic-flow' }];

  assert.deepEqual(planMaterialRecovery(input), {
    action: 'update_application',
    flowId: 'synthetic-flow',
  });
});

test('already applied target completes without repeating writes', () => {
  const input = fixture();
  input.receipt.state = 'application_attempted';
  input.flows = [{ ...input.receipt.flow, _id: 'synthetic-flow' }];
  input.application.状态 = '借出（物资）';

  assert.deepEqual(planMaterialRecovery(input), {
    action: 'complete',
    flowId: 'synthetic-flow',
  });
});

test('missing flow after an attempted write requires reconciliation', () => {
  const input = fixture();
  input.receipt.state = 'flow_attempted';

  assert.throws(
    () => planMaterialRecovery(input),
    error => error.code === 'material_write_outcome_unknown',
  );
});

test('duplicate or conflicting flows stop recovery', () => {
  const input = fixture();
  const flow = { ...input.receipt.flow, _id: 'synthetic-flow' };

  input.flows = [flow, { ...flow, _id: 'another-flow' }];
  assert.throws(
    () => planMaterialRecovery(input),
    error => error.code === 'material_recovery_conflict',
  );

  input.flows = [{ ...flow, 数量: 3 }];
  assert.throws(
    () => planMaterialRecovery(input),
    error => error.code === 'material_recovery_conflict',
  );
});

test('changed application state cannot be overwritten during recovery', () => {
  const input = fixture();
  input.flows = [{ ...input.receipt.flow, _id: 'synthetic-flow' }];
  input.application.状态 = '已归还';

  assert.throws(
    () => planMaterialRecovery(input),
    error => error.code === 'material_recovery_conflict',
  );
});

test('completed receipt cannot reapply an old target', () => {
  const input = fixture();
  input.receipt.state = 'completed';
  input.flows = [{ ...input.receipt.flow, _id: 'synthetic-flow' }];

  assert.throws(
    () => planMaterialRecovery(input),
    error => error.code === 'material_recovery_conflict',
  );
});

test('truncated flow reads cannot authorize any recovery write', () => {
  const input = fixture();
  input.flows.readMeta = { truncated: true };

  assert.throws(
    () => planMaterialRecovery(input),
    error => error.code === 'incomplete_operational_data',
  );
});

test('different request content cannot reuse the recovery receipt', () => {
  const input = fixture();
  input.incoming = materialOperationIdentity({
    ...input.receipt.identity.payload,
    idempotencyKey: input.receipt.identity.key,
    quantity: 3,
  });

  assert.throws(
    () => planMaterialRecovery(input),
    error => error.code === 'material_operation_conflict',
  );
});
test('matching target status cannot hide changed application guard fields', () => {
  const input = fixture();
  input.receipt.before = {
    ...input.receipt.before,
    借用件数: 2,
    借出审批: '审批通过',
  };
  input.flows = [{
    ...input.receipt.flow,
    _id: 'synthetic-flow',
  }];
  input.application = {
    ...input.application,
    ...input.receipt.after,
    借用件数: 3,
    借出审批: '审批通过',
  };

  assert.throws(
    () => planMaterialRecovery(input),
    error => error.code === 'material_recovery_conflict',
  );

  input.application.借用件数 = 2;
  input.application.借出审批 = '审批不通过';

  assert.throws(
    () => planMaterialRecovery(input),
    error => error.code === 'material_recovery_conflict',
  );

  input.application.借出审批 = '审批通过';
  assert.deepEqual(planMaterialRecovery(input), {
    action: 'complete',
    flowId: 'synthetic-flow',
  });
});
