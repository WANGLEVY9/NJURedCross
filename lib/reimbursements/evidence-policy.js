import { reimbursementCrossChecks } from '../../public/app/shared/reimbursement-cross-checks.js';
import { SCHOOL_TAX_ID } from '../../public/app/shared/reimbursement-material-rules.js';

export const OTHER_REIMBURSEMENT_CHANNEL = '非南京大学抬头 · 按实际渠道另行报销';

export function reimbursementEvidence(request, bundle) {
  const expenses = request.expenseItems || [];
  const amounts = new Map(), separate = new Set(), taxMismatch = new Set(), goods = new Map();
  if (!bundle?.sources?.length || !expenses.length)
    return { amounts, separate, taxMismatch, goods, orderCents: null, filenameCents: request.amountCents, checks: [] };

  const analyses = new Map((bundle.analyses || []).map(result => [result.page, result]));
  for (const source of bundle.sources) {
    if (source.kind !== 'invoice') continue;
    const pages = (source.checks || []).filter(check => source.startPage > 0 && source.startPage + check.page - 1 <= source.endPage);
    for (const check of pages) {
      const page = source.startPage + check.page - 1;
      if (!analyses.has(page)) analyses.set(page, { page, buyer: check, invoice: check.invoice });
    }
    for (let page = source.startPage; page > 0 && page <= source.endPage; page++) {
      const result = analyses.get(page), linked = expenses.find(expense => expense.id === source.expenseItemId);
      const affected = linked ? [linked] : expenses;
      if (result?.buyer?.state === 'different') for (const expense of affected) separate.add(expense.id);
      const tax = result?.invoice?.fields?.buyerTaxId;
      if (result?.buyer?.state === 'matched' && tax?.state === 'extracted' && tax.value !== SCHOOL_TAX_ID)
        for (const expense of affected) taxMismatch.add(expense.id);
      if (linked) {
        const original = pages.find(check => source.startPage + check.page - 1 === page)?.invoice?.goodsNames;
        const names = [...original || [], ...result?.invoice?.goodsNames || []];
        if (names.length) goods.set(linked.id, new Set([...goods.get(linked.id) || [], ...names]));
      }
    }
  }

  const originalUrls = (bundle.files || bundle.originalUrls || []).map(({ kind, expenseItemId, materialType, name }) => ({
    kind, expenseItemId, materialType, name,
  }));
  const groups = reimbursementCrossChecks(request, { sources: bundle.sources, originalUrls }, [...analyses.values()]);
  const orderReferences = new Set();
  for (const group of groups) {
    if (!Number.isSafeInteger(group.referenceCents)) continue;
    if (group.amountScope === 'order') orderReferences.add(group.referenceCents);
    else amounts.set(group.expenseItemId, group.referenceCents);
  }
  const orderCents = orderReferences.size === 1 ? orderReferences.values().next().value : null;
  const filenameCents = orderCents ?? (amounts.size ? expenses.reduce((sum, row) => sum + (amounts.get(row.id) ?? row.amountCents), 0) : request.amountCents);
  return { amounts, separate, taxMismatch, goods, orderCents, filenameCents, checks: groups };
}

export function schoolExpenseLimit(expense, evidence) {
  return Math.min(expense.amountCents, evidence.amounts.get(expense.id) ?? expense.amountCents);
}

export function evidenceLabel(request, evidence, expenseId) {
  const expense = request.expenseItems?.find(row => row.id === expenseId);
  // A multi-item invoice uses the reviewer-confirmed mapping.
  if (request.expenseItems?.length === 1 && evidence.goods.get(expenseId)?.size === 1)
    return evidence.goods.get(expenseId).values().next().value;
  return expense?.label;
}

export function reimbursementApprovalIssue(request, evidence) {
  if ([...evidence.taxMismatch].some(id => !evidence.separate.has(id))) return '南京大学发票的纳税人识别号不符，请核对原件并退回更正。';
  if (evidence.checks.some(check => check.shareExceedsTotal)) return '本订单分摊实付款超过共用付款账单总额，请退回申请人更正。';
  if (request.materialRulesVersion !== 1 || request.voucherNote?.trim()) return '';
  const unexplained = evidence.checks.some(check => !evidence.separate.has(check.expenseItemId)
    && Number.isSafeInteger(check.invoiceCents) && Number.isSafeInteger(check.paymentCents)
    && check.invoiceCents !== check.paymentCents);
  return unexplained ? '发票价税合计与实付金额有差额，请在特殊情况说明中注明原因后送审。' : '';
}
