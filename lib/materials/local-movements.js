import { integer } from './service.js';

const reasons = { in: ['采购', '捐赠', '调拨', '其他', '借用归还'], out: ['借用备货', '领用', '消耗'] };
function fail(message) { throw Object.assign(new Error(message), { statusCode: 400, code: 'local_movement_invalid' }); }

/** Pure form adapter. The injected service decides persistence and authorization. */
export function createLocalMovements(service) {
  return async (body, photo) => {
    const allowed = ['direction', 'reason', 'assetCode', 'quantity', 'lossQuantity', 'applicationId', 'reference', 'idempotencyKey'];
    if (Object.keys(body).some(key => !allowed.includes(key))) fail('出入库请求含不支持的字段');
    if (!Object.hasOwn(reasons, body.direction) || !reasons[body.direction].includes(body.reason)) fail('请选择有效的入库或出库原因');
    if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim()) fail('缺少操作标识');
    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (!reference || reference.length > 500 || reference.includes('[RC-MATERIALS-V1]')) fail('请填写不超过 500 字的来源、去向或核对说明');
    const quantity = integer(body.quantity, '数量'), loss = integer(body.lossQuantity, '损耗数量', { optional: true });
    const returning = body.reason === '借用归还', borrowing = body.reason === '借用备货';
    if (!returning && (quantity < 1 || loss !== 0)) fail('非归还操作须登记正整数件数，不能登记借用损耗');
    const values = { assetCode: body.assetCode, quantity, lossQuantity: loss,
      note: `${body.reason}：${reference}`, idempotencyKey: body.idempotencyKey };
    if (returning || borrowing) {
      if (typeof body.applicationId !== 'string' || !body.applicationId.trim()) fail('借用出库和归还须选择原借用申请');
      return service.applicationAction(body.applicationId, returning ? 'return' : 'checkout', values, photo);
    }
    if (body.applicationId) fail('普通补货或消耗不能代替借用登记');
    return service.transaction({ ...values, operation: body.direction === 'in' ? '入库' : '出库', destination: reference });
  };
}
