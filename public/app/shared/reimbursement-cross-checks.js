import { reimbursementMaterialGroups } from './reimbursement-groups.js';
import { requiredReimbursementMaterials } from './reimbursement-material-rules.js';

export function evidenceAmountCents(value) {
  const match = String(value || '').match(/^(0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/);
  return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : null;
}
const normalizeName = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const verdict = (state, message) => ({ state, message });

/** Compare evidence within stable expense associations, never by generated filenames. */
export function reimbursementCrossChecks(request, bundle, analyses) {
  if (!request?.expenseItems?.length) return [];
  const numberFiles = new Map();
  for (const source of bundle.sources.filter(source => source.kind === 'invoice')) {
    const numbers = new Set(analyses.filter(result => result.page >= source.startPage && result.page <= source.endPage)
      .map(result => result.invoice?.fields?.invoiceNumber).filter(field => field?.state === 'extracted').map(field => field.value));
    for (const number of numbers) numberFiles.set(number, (numberFiles.get(number) || 0) + 1);
  }
  const totalAgrees = Number.isSafeInteger(request.amountCents)
    && request.expenseItems.every(item => Number.isSafeInteger(item.amountCents))
    && request.amountCents === request.expenseItems.reduce((sum, item) => sum + item.amountCents, 0);
  const groups = reimbursementMaterialGroups({ ...request, bundle });
  const sameOrder = request.materialRulesVersion === 1 && request.singleOrderConfirmed === true;
  const orderFiles = [...new Map(groups.flatMap(group => group.files).map(file => [file.index, file])).values()];
  return groups.filter(group => group.kind === 'expense').map(group => {
    const category = request.expenseItems.find(item => item.id === group.expenseItemId)?.category;
    const required = request.materialRulesVersion === 1 ? requiredReimbursementMaterials(category, request.meetingRelated) : null;
    const requiresPayment = !required || required.includes('付款截图'), requiresOrder = !required || required.includes('订单截图');
    const wholeOrder = sameOrder && request.expenseItems.length > 1;
    const evidence = (sameOrder ? orderFiles : group.files).map(file => {
      const source = bundle.sources[file.index];
      const pages = analyses.filter(result => source?.startPage > 0 && result.page >= source.startPage && result.page <= source.endPage);
      return { file, pages, complete: source?.startPage > 0 && pages.length === source.endPage - source.startPage + 1 };
    });
    const invoices = evidence.filter(entry => entry.file.kind === 'invoice');
    const orders = evidence.filter(entry => entry.file.kind === 'supporting' && ['订单截图', '订单和付款截图'].includes(entry.file.materialType));
    const payments = evidence.filter(entry => entry.file.kind === 'supporting' && ['付款截图', '订单和付款截图'].includes(entry.file.materialType));
    const read = (entry, field) => entry.pages.map(result => field === 'invoiceAmount' ? result.invoice?.fields?.totalAmount
      : field === 'invoiceNumber' ? result.invoice?.fields?.invoiceNumber : result.supporting?.[field]);
    const distinct = fields => [...new Set(fields.filter(field => field?.state === 'extracted').map(field => field.value))];
    const reliable = (entry, field) => entry.complete && read(entry, field).some(value => value?.state === 'extracted')
      && !read(entry, field).some(value => value?.state === 'conflict');
    const invoiceValues = invoices.map(entry => distinct(read(entry, 'invoiceAmount')));
    const invoiceReady = invoices.length > 0 && invoices.every((entry, index) => reliable(entry, 'invoiceAmount') && invoiceValues[index].length === 1);
    const invoiceAmounts = invoiceValues.map(values => evidenceAmountCents(values[0]));
    const invoiceCents = invoiceReady && invoiceAmounts.every(Number.isSafeInteger) ? invoiceAmounts.reduce((a, b) => a + b, 0) : null;
    const numbers = invoices.flatMap(entry => distinct(read(entry, 'invoiceNumber')));
    const duplicate = numbers.some(number => numberFiles.get(number) > 1);
    const paymentValues = distinct(payments.flatMap(entry => read(entry, 'paidAmount')));
    const paymentReady = payments.length > 0 && payments.every(entry => reliable(entry, 'paidAmount')) && paymentValues.length === 1;
    const paymentCents = paymentReady ? evidenceAmountCents(paymentValues[0]) : null;
    const referenceCents = Number.isSafeInteger(invoiceCents) && (!requiresPayment || Number.isSafeInteger(paymentCents))
      ? requiresPayment ? Math.min(invoiceCents, paymentCents) : invoiceCents : null;
    let amount = !totalAgrees ? verdict('different', '申请总额与支出明细合计不一致')
      : duplicate ? verdict('different', '发票号码重复，金额不能重复计入')
        : !invoices.length || requiresPayment && !payments.length ? verdict('unknown', '缺少关联发票或付款截图')
          : requiresPayment && paymentValues.length > 1 ? verdict('unknown', '存在多个付款金额，请人工确认是否分次付款或材料重复')
            : referenceCents === null ? verdict('unknown', '金额尚未可靠识别，或材料中存在冲突')
              : referenceCents === (wholeOrder ? request.amountCents : group.amountCents) ? verdict('matched', `${wholeOrder ? '本订单申报合计' : '申报金额'}与${requiresPayment ? '发票、实付款的较低值' : '发票金额'}一致${wholeOrder ? '；各物品分摊金额需人工确认' : ''}`)
                : verdict('different', `${wholeOrder ? '本订单申报合计' : '申报金额'}与${requiresPayment ? '发票、实付款的较低值' : '发票金额'}不一致`);
    const names = distinct(orders.flatMap(entry => read(entry, 'productName')));
    const expected = normalizeName(group.label);
    const namesReady = orders.length > 0 && orders.every(entry => reliable(entry, 'productName')) && names.length > 0;
    const nameMatches = value => {
      const actual = normalizeName(value);
      return actual === expected || expected.length >= 2 && /[\u3400-\u9fff]/.test(expected) && actual.includes(expected);
    };
    const name = !requiresOrder ? verdict('not-applicable', '本类别不要求订单物资名自动核验，请核对对应凭据')
      : !namesReady ? verdict('unknown', '订单物资名尚未可靠识别或缺少关联订单截图')
      : !expected ? verdict('unknown', '未填写支出项目名称')
        : names.every(nameMatches) ? verdict('matched', '订单物资名与填写的支出项目名称一致')
          : verdict('different', '订单物资名与填写的支出项目名称不一致');
    return { ...group, amount, name, amountScope: wholeOrder ? 'order' : 'item', invoiceCents, paymentCents, referenceCents, names,
      evidence: evidence.map(entry => ({ name: entry.file.originalName || entry.file.name, kind: entry.file.kind,
        materialType: entry.file.materialType, pages: entry.pages.map(result => result.page), complete: entry.complete,
        fields: entry.pages.flatMap(result => entry.file.kind === 'invoice' ? [result.invoice?.fields?.totalAmount]
          : [result.supporting?.productName, result.supporting?.paidAmount]).filter(Boolean) })) };
  });
}
