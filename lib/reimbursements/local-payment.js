import { checkedDate } from './summary-contract.js';
import { hasFinalApproval } from './workflow.js';
import { LOCAL_LIMITS } from './state.js';

function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode }); }
function text(value, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) fail(400, '打款登记内容不正确。');
  return value.trim();
}
export function paymentEligibility(item) {
  const reason = !hasFinalApproval(item) ? '须完成本版初审和复审后才能登记打款。'
    : item.paymentStatus !== 'pending' ? '该申请已登记打款或付款状态待核查。' : '';
  return { eligible: !reason, reason };
}

/** Records a human-confirmed external payment; never calls a bank, mailer or remote adapter. */
export function createLocalPayments({ queue, target, requirePermission, parseAmount, now,
  receipts = new Map(), limits = LOCAL_LIMITS }) {
  function register(actor, id, body) {
    requirePermission(actor, 'payment');
    return queue(() => {
      const item = target(id, actor, true);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['revision', 'stateVersion', 'amount', 'paidDate', 'reference', 'note', 'confirmed', 'idempotencyKey'].includes(key))) fail(400, '打款登记请求不正确。');
      if (body.confirmed !== true) fail(400, '请确认已核对收款人与金额，且实际打款已完成。');
      const paidDate = checkedDate(body.paidDate, '实际打款日期');
      const recordedAt = now(), today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(recordedAt));
      if (paidDate > today) fail(400, '实际打款日期不能晚于今天。');
      const amountCents = parseAmount(body.amount), reference = text(body.reference, 160), note = text(body.note, 500);
      const key = `${actor.id}:${text(body.idempotencyKey, 160, true)}`;
      const fingerprint = JSON.stringify({ id, revision: body.revision, stateVersion: body.stateVersion, amountCents, paidDate, reference, note });
      const receipt = receipts.get(key);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) fail(409, '同一操作标识不能用于不同的打款登记。');
        return { ok: true, local: true, duplicate: true, item: structuredClone(item) };
      }
      if (item.revision !== body.revision || item.stateVersion !== body.stateVersion) fail(409, '申请版本或状态已变化，请刷新后登记。');
      const eligibility = paymentEligibility(item);
      if (!eligibility.eligible) fail(409, eligibility.reason);
      if (item.workflowVersion === 3 || Object.values(item.financeItems || {}).some(row => row.finalReview)) fail(409, '请在待打款工作区逐项登记，并先完成经费到账登记。');
      if (amountCents !== item.amountCents) fail(400, '登记金额必须等于本笔已复审通过的金额。');
      if (receipts.size >= limits.payments) fail(413, '打款登记数量已达容量上限。');
      const record = { actor: actor.id, recordedAt, paidDate, amountCents, reference, note, revision: item.revision, bundleId: item.bundleId };
      item.paymentStatus = 'paid'; item.paymentRecord = record; item.stateVersion++; item.updatedAt = recordedAt;
      item.history.push({ action: 'payment-recorded', actor: actor.id, at: recordedAt, paidDate, amountCents, reference, note,
        revision: item.revision, stateVersion: item.stateVersion, bundleId: item.bundleId });
      receipts.set(key, { fingerprint });
      return { ok: true, local: true, item: structuredClone(item) };
    });
  }
  return { register };
}
