import { createHash } from 'node:crypto';

function invalid(message) {
  return Object.assign(new Error(message), {
    statusCode: 400,
    code: 'invalid_material_operation',
  });
}

function requiredText(value, name, limit = 200) {
  if (typeof value !== 'string') {
    throw invalid(`${name}不能为空`);
  }
  const text = value.trim();
  if (!text || text.length > limit) {
    throw invalid(`${name}不能为空或超出长度限制`);
  }
  return text;
}

export function materialOperationIdentity({
  idempotencyKey,
  applicationId,
  assetCode,
  operation,
  quantity,
  lossQuantity = 0,
  actor,
  destination = '',
  note = '',
  photoHash = '',
}) {
  const key = requiredText(idempotencyKey, '操作标识', 128);

  if (!['出库', '归还'].includes(operation)) {
    throw invalid('不支持的申请流转操作');
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw invalid('数量必须是正整数');
  }
  if (
    !Number.isSafeInteger(lossQuantity)
    || lossQuantity < 0
    || lossQuantity > quantity
  ) {
    throw invalid('损耗数量不合法');
  }
  if (
    typeof destination !== 'string'
    || typeof note !== 'string'
    || destination.length > 1000
    || note.length > 4000
  ) {
    throw invalid('去向或说明格式不合法');
  }
  if (
    typeof photoHash !== 'string'
    || (photoHash && !/^[a-f0-9]{64}$/.test(photoHash))
  ) {
    throw invalid('照片校验值不合法');
  }

  const payload = {
    version: 1,
    applicationId: requiredText(applicationId, '申请标识'),
    assetCode: requiredText(assetCode, '资产编码'),
    operation,
    quantity,
    lossQuantity,
    actor: requiredText(actor, '操作人'),
    destination: destination.trim(),
    note: note.trim(),
    photoHash,
  };

  const fingerprint = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');

  return { key, fingerprint, payload };
}

export function assertSameMaterialOperation(existing, incoming) {
  if (
    existing.key !== incoming.key
    || existing.fingerprint !== incoming.fingerprint
  ) {
    throw Object.assign(
      new Error('操作标识已用于不同内容，请核对原操作，不能覆盖或重复执行。'),
      {
        statusCode: 409,
        code: 'material_operation_conflict',
      },
    );
  }
}