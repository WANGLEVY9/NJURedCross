import { randomUUID } from 'node:crypto';
import { integer, MATERIAL_TABLES } from './service.js';
import { checkedDate } from '../reimbursements/summary-contract.js';
import { createMutationQueue } from '../events/safety.js';
import { createLocalReturns } from './local-returns.js';

function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode, code: 'materials_portal_invalid' }); }
function text(value, label, max = 160, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail(400, `请填写${label}，不超过 ${max} 个字符。`);
  return value.trim();
}
/** Only accepts the isolated preview fixture. No remote adapter is passed here. */
export function createLocalMaterialsPortal({ service, fixture }) {
  const queue = createMutationQueue(), receipts = new Map(), inbound = new Map();
  const member = actor => { if (!actor?.id) fail(401, '请先登录。'); if (!actor.memberCode) fail(403, '当前申请暂按会员编号开放。'); };
  const reviewer = actor => { if (!actor?.id) fail(401, '请先登录。'); if (actor.canReview !== true) fail(403, '需要物资管理权限。'); };
  async function catalog() {
    const data = await service.overview();
    return data.inventory.filter(item => item.availability !== 'disabled').map(item => ({ id: item.id, assetCode: item.code, name: item.name,
      unit: item.unit, remaining: Number.isSafeInteger(item.quantity) && item.quantity >= 0 ? item.quantity : 0,
      location: `${item.center} · ${item.cabinet} · ${item.level}` }));
  }
  async function selection(body) {
    const id = text(body.materialId, '物资 ID'), code = text(body.assetCode, '物资类别码');
    const item = (await catalog()).find(item => item.id === id && item.assetCode === code);
    if (!item) fail(409, '物资不存在、已停用或标识不匹配，请刷新目录。');
    return { item, quantity: integer(body.quantity, '数量', { min: 1 }) };
  }
  async function mutate(actor, body, kind, fn) {
    if (kind === 'inbound') reviewer(actor); else member(actor);
    const key = text(body.idempotencyKey, '操作标识');
    return queue(async () => {
      const receiptKey = `${actor.id}:${kind}:${key}`, fingerprint = JSON.stringify(body), repeated = receipts.get(receiptKey);
      if (repeated) { if (repeated.fingerprint !== fingerprint) fail(409, '同一操作标识不能重复用于不同申请。'); return { ...structuredClone(repeated.result), duplicate: true }; }
      if (receipts.size >= 500) fail(413, '本轮本地申请已达容量上限，请重启预览。');
      const result = await fn(await selection(body));
      receipts.set(receiptKey, { fingerprint, result: structuredClone(result) }); return result;
    });
  }
  function borrow(actor, body) {
    return mutate(actor, body, 'borrow', async ({ item, quantity }) => {
      if (quantity > item.remaining) fail(409, '可借库存不足，请刷新目录。');
      if (body.consent !== true) fail(400, '请确认借用责任。');
      const name = text(body.name, '姓名', 50), purpose = text(body.purpose, '用途', 500);
      const studentId = text(body.studentId, '学号', 50), email = text(body.email, '邮箱', 150);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, '请填写有效邮箱。');
      const plannedBorrowDate = checkedDate(body.plannedBorrowDate, '借用日期'), plannedReturnDate = checkedDate(body.plannedReturnDate, '归还日期');
      if (plannedReturnDate < plannedBorrowDate) fail(400, '归还日期不能早于借用日期。');
      const items = `${item.name} ${quantity} ${item.unit}`;
      const row = { 姓名: name, 学号: studentId, 邮箱: email, 借用用途: purpose, 借用物资名及数量: items, 借用件数: quantity,
        拟借用日期: plannedBorrowDate, 拟归还日期: plannedReturnDate, 状态: '待审批', 借出审批: '待审核',
        申请资产编码: item.assetCode, 申请物资ID: item.id, 本地申请人: actor.id };
      const { _id: id } = await fixture.client.appendRow(MATERIAL_TABLES.applications, row);
      return { ok: true, local: true, message: '本地申请已提交，暂未发送邮件。', request: { id, code: `REQ-${id}`, materialId: item.id, assetCode: item.assetCode, items, quantity, status: '待审批', plannedBorrowDate, plannedReturnDate } };
    });
  }
  function submitInbound(actor, body) {
    return mutate(actor, body, 'inbound', ({ item, quantity }) => {
      if (!['采购', '捐赠'].includes(body.source)) fail(400, '普通入库仅支持采购或捐赠；借用归还须关联原借用单。');
      const location = text(body.location, '存放位置', 120), note = text(body.note, '说明', 500, true);
      const id = randomUUID(), code = `IN-${id.slice(0, 8).toUpperCase()}`;
      const record = { id, code, owner: actor.id, materialId: item.id, assetCode: item.assetCode, name: item.name, unit: item.unit,
        quantity, location, note, source: body.source, status: 'pending', revision: 1, createdAt: new Date().toISOString() };
      inbound.set(id, record); return { ok: true, local: true, code, status: '待核对', record: structuredClone(record) };
    });
  }
  function listInbound(actor, reviewing = false) {
    if (reviewing) reviewer(actor); else member(actor);
    return { ok: true, local: true, records: [...inbound.values()].filter(item => reviewing || item.owner === actor.id).map(item => structuredClone(item)) };
  }
  function reviewInbound(actor, id, body) {
    reviewer(actor);
    return queue(async () => {
      const item = inbound.get(id);
      if (!item) fail(404, '入库登记不存在。');
      if (item.status !== 'pending' || body.revision !== item.revision) fail(409, '登记已审核或版本已变化，请刷新。');
      if (!['approve', 'reject'].includes(body.action)) fail(400, '请选择核对通过或拒绝。');
      const note = text(body.note, '审核说明', 500, body.action === 'approve');
      let result;
      if (body.action === 'approve') {
        if (body.physicalChecked !== true) fail(400, '须确认实物、数量与存放位置已核对。');
        result = await service.transaction({ operation: '入库', assetCode: item.assetCode, quantity: item.quantity,
          idempotencyKey: `inbound:${id}`, note: `${item.code} · ${item.source} · ${item.location} · ${item.note}${note ? ` · 核对：${note}` : ''}` });
      }
      Object.assign(item, { status: body.action === 'approve' ? 'approved' : 'rejected', revision: item.revision + 1,
        reviewedAt: new Date().toISOString(), reviewer: actor.id, reviewNote: note, flowId: result?.flowId || null });
      return { ok: true, local: true, record: structuredClone(item), ...(result ? { flowId: result.flowId } : {}) };
    });
  }
  return { catalog, borrow, submitInbound, listInbound, reviewInbound, returns: createLocalReturns({ service, fixture }) };
}
