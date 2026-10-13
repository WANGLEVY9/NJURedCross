const paymentTypes = ['订单截图', '订单和付款截图', '付款截图'];
export const isOrderPayment = file => file.kind === 'supporting' && paymentTypes.includes(file.materialType);
function priority(file) {
  if (file.kind === 'invoice') return 0;
  const index = paymentTypes.indexOf(file.materialType);
  return file.kind === 'supporting' && index >= 0 ? index + 1 : 4;
}

/** Stable expense IDs only; common attachments are never copied into every expense. */
export function reimbursementMaterialGroups(item) {
  const groups = (item.expenseItems || []).map(expense => ({ kind: 'expense', expenseItemId: expense.id,
    label: expense.label, category: expense.category || '', amountCents: expense.amountCents, files: [] }));
  const common = { kind: 'common', expenseItemId: '', label: '整份申请材料', amountCents: item.amountCents, files: [] };
  const unassigned = { kind: 'unassigned', expenseItemId: '', label: '关联信息待核查', files: [] };
  for (const [index, file] of (item.bundle.originalUrls || []).entries()) {
    let group = groups.find(entry => entry.expenseItemId === file.expenseItemId);
    if (!['invoice', 'supporting'].includes(file.kind)) group = unassigned;
    if (!group) group = file.kind === 'supporting' && !file.expenseItemId ? common : unassigned;
    group.files.push({ ...file, index });
  }
  for (const group of [...groups, common, unassigned]) group.files.sort((a, b) => priority(a) - priority(b) || a.index - b.index);
  return [...groups, ...(common.files.length ? [common] : []), ...(unassigned.files.length ? [unassigned] : [])];
}
