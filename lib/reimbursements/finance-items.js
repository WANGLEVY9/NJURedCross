/** Per-expense finance records retain the original application and evidence identity. */
export const financeKey = (requestId, itemId) => JSON.stringify([requestId, itemId]);
const financeValue = (request, item) => request.financeItems && Object.hasOwn(request.financeItems, item.id) ? request.financeItems[item.id] : null;
export const itemActivityId = (request, item) => financeValue(request, item)?.activityId || request.activityId;
export function itemFinalReview(request, item) {
  const own = financeValue(request, item)?.finalReview;
  if (own) return own;
  return request.workflowVersion >= 2 && request.status === 'approved' && request.initialReview?.revision === request.revision
    && request.initialReview?.bundleId === request.bundleId && request.finalReview?.revision === request.revision
    && request.finalReview?.bundleId === request.bundleId && (request.workflowVersion === 2 || request.finalReview.summaryId) ? request.finalReview : null;
}
export function itemPayment(request, item) {
  const own = financeValue(request, item)?.payment;
  if (own) return own;
  return request.paymentStatus === 'paid' && !financeValue(request, item)?.finalReview
    ? { ...request.paymentRecord, amountCents: item.amountCents } : null;
}
export function financeRecord(request, item) {
  request.financeItems ||= Object.create(null);
  if (!Object.hasOwn(request.financeItems, item.id)) Object.defineProperty(request.financeItems, item.id, { value: {}, enumerable: true, writable: true, configurable: true });
  return request.financeItems[item.id];
}
export function syncFinanceRequest(request) {
  const items = request.expenseItems || [];
  const finals = items.map(item => itemFinalReview(request, item));
  if (items.length && finals.every(Boolean)) {
    request.status = 'approved';
    request.finalReview = { ...finals.at(-1), revision: request.revision, bundleId: request.bundleId };
  }
  const payments = items.map(item => itemPayment(request, item));
  request.paymentStatus = payments.length && payments.every(Boolean) ? 'paid'
    : payments.some(Boolean) ? 'partial' : finals.some(Boolean) ? 'pending' : 'not-ready';
  const recorded = payments.filter(Boolean);
  if (recorded.length) request.paymentRecord = { ...recorded.at(-1), amountCents: recorded.reduce((sum, p) => sum + p.amountCents, 0) };
}
export function assertFrozenExpenses(request, expenses, fail) {
  for (const item of request.expenseItems || []) {
    if (!itemFinalReview(request, item)) continue;
    const next = expenses.find(row => row.id === item.id);
    if (!next || ['label', 'note', 'category', 'amountCents'].some(key => (next[key] || '') !== (item[key] || ''))
      || JSON.stringify(next.railJourney || null) !== JSON.stringify(item.railJourney || null))
      fail(409, '已终审的条目须保留原名称、金额、用途和材料关联；请仅修改退回的条目。');
  }
}
/** A corrected request association cannot move previously approved expense rows. */
export function applyRequestActivityCorrection(request, nextActivityId) {
  if (!nextActivityId || nextActivityId === request.activityId) return;
  for (const item of request.expenseItems || []) {
    const prior = itemActivityId(request, item);
    financeRecord(request, item).activityId = itemFinalReview(request, item) ? prior : nextActivityId;
  }
}
