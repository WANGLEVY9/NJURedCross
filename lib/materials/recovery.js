import { assertSameMaterialOperation } from './operation.js';

function conflict(message, code = 'material_recovery_conflict') {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code,
  });
}

function matches(actual, expected) {
  return Object.entries(expected).every(([key, value]) =>
    JSON.stringify(actual[key] ?? null) === JSON.stringify(value ?? null),
  );
}

/**
 * Read-only recovery planning. Caller must provide complete,
 * authoritative reads under the relevant operation locks.
 */
export function planMaterialRecovery({
  receipt,
  incoming,
  flows,
  application,
}) {
  assertSameMaterialOperation(receipt.identity, incoming);

  if (!Array.isArray(flows) || flows.readMeta?.truncated) {
    throw Object.assign(new Error('流水读取不完整，不能判断恢复步骤。'), {
      statusCode: 503,
      code: 'incomplete_operational_data',
    });
  }

  if (
    !receipt.flow
    || !receipt.before
    || !receipt.after
    || !application
    || application._id !== receipt.identity.payload.applicationId
    || !Object.keys(receipt.before).length
    || !Object.keys(receipt.after).length
  ) {
    throw conflict('操作凭证或申请记录不完整。');
  }

  const states = [
    'prepared',
    'flow_attempted',
    'flow_confirmed',
    'application_attempted',
    'completed',
  ];
  if (!states.includes(receipt.state)) {
    throw conflict('未知的操作恢复状态。');
  }

  const existing = flows.filter(row =>
    row['幂等键'] === receipt.identity.key,
  );

  if (existing.length > 1) {
    throw conflict('发现重复流水，必须人工核对，不能自动继续。');
  }

  if (!existing.length) {
    if (receipt.state !== 'prepared') {
      throw conflict(
        '流水写入结果未知或已有记录缺失，请核对后再继续。',
        'material_write_outcome_unknown',
      );
    }
    if (!matches(application, receipt.before)) {
      throw conflict('申请状态已变化，不能按旧凭证开始操作。');
    }
    return { action: 'append_flow' };
  }

  const flow = existing[0];
  if (!flow._id || !matches(flow, receipt.flow)) {
    throw conflict('已有流水与操作凭证不一致。');
  }

  const expectedAfter = {
    ...receipt.before,
    ...receipt.after,
  };
  if (matches(application, expectedAfter)) {
    return { action: 'complete', flowId: flow._id };
  }

  if (receipt.state === 'completed') {
    throw conflict('已完成操作的申请状态发生变化，不能覆盖。');
  }

  if (!matches(application, receipt.before)) {
    throw conflict('申请状态与操作前后快照都不一致，必须人工核对。');
  }

  return { action: 'update_application', flowId: flow._id };
}