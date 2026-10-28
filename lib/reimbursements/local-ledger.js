import { checkedDate } from './summary-contract.js';
import { hasFinalApproval } from './workflow.js';
import { paymentEligibility } from './local-payment.js';
import { tableWorkbook } from '../events/xlsx.js';
import { LEDGER_COLUMNS, ITEM_LEDGER_COLUMNS } from '../../public/app/shared/reimbursement-ledger-fields.js';
import { itemActivityId, itemFinalReview, itemPayment } from './finance-items.js';

function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode }); }
export function ledgerState(item) {
  return item.status === 'approved' ? !hasFinalApproval(item) ? 'legacy' : item.paymentStatus === 'paid' ? 'paid' : 'approved' : item.status;
}
const labels = { pending: '待初审', final_pending: '待复审', initial_returned: '复审退回初审', returned: '待申请人补充',
  approved: '复审通过／待打款', paid: '已打款', legacy: '原审核通过（旧流程待核查）' };

/** The projection and column whitelist deliberately contain no identity-card or bank-account fields. */
export function createLocalLedger({ requests, bundles, activities, summaries, reviewer, canRead, mayExport, mayPay, activityName }) {
  const expenseState = (item, expense) => itemPayment(item, expense) ? 'paid' : itemFinalReview(item, expense) ? 'approved' : ledgerState(item);
  const due = (item, expense) => {
    const review = itemFinalReview(item, expense), summary = summaries?.get(review?.summaryId);
    return summary?.funding?.allocations?.find(a => a.requestId === item.id && a.itemId === expense.id)?.amountCents ?? review?.amountCents ?? expense.amountCents;
  };
  function selected(actor, filters = {}, detail = false) {
    reviewer(actor);
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)
      || Object.keys(filters).some(key => !['activityId', 'status', 'from', 'to', 'search'].includes(key))
      || Object.values(filters).some(value => typeof value !== 'string' || value.length > 160)) fail(400, '台账筛选条件不正确。');
    const { activityId = '', status = '', from = '', to = '', search = '' } = filters;
    if (status && !Object.hasOwn(labels, status)) fail(400, '请选择有效的处理状态。');
    if (from) checkedDate(from, '开始日期'); if (to) checkedDate(to, '结束日期');
    if (from && to && from > to) fail(400, '开始日期不能晚于结束日期。');
    const needle = search.trim().toLocaleLowerCase();
    return [...requests.values()].filter(item => canRead(actor, item) && (!activityId || item.activityId === activityId || item.expenseItems?.some(expense => itemActivityId(item, expense) === activityId))
      && (!status || ledgerState(item) === status || detail && item.expenseItems?.some(expense => expenseState(item, expense) === status)) && (!from || item.expenseDate && item.expenseDate >= from)
      && (!to || item.expenseDate && item.expenseDate <= to)
      && (!needle || [item.code, item.name, item.purpose].some(value => String(value || '').toLocaleLowerCase().includes(needle))))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
  }
  function project(item) {
    return { code: item.code, applicant: item.name, activity: activityName(item.activityId, item) || '未关联活动', purpose: item.purpose,
      amount: item.amountCents / 100, status: labels[ledgerState(item)] || '待核查', expenseDate: item.expenseDate || '',
      submittedAt: item.createdAt, initialReviewer: item.initialReview?.actor || '', finalReviewer: item.finalReview?.actor || '',
      paidDate: item.paymentRecord?.paidDate || '', paidAmount: item.paymentRecord ? item.paymentRecord.amountCents / 100 : '',
      paymentReference: item.paymentRecord?.reference || '' };
  }
  function list(actor, filters) {
    const items = selected(actor, filters), paid = items.filter(item => ledgerState(item) === 'paid'), waiting = items.filter(item => ledgerState(item) === 'approved');
    return { ok: true, local: true, rows: items.map(item => ({ ...project(item), id: item.id, revision: item.revision,
      stateVersion: item.stateVersion, paymentStatus: item.paymentStatus, canRegisterPayment: mayPay(actor) && paymentEligibility(item).eligible && !Object.values(item.financeItems || {}).some(row => row.finalReview) })),
      totals: { count: items.length, amountCents: items.reduce((sum, item) => sum + item.amountCents, 0),
        waitingCount: waiting.length, waitingCents: items.reduce((sum, item) => sum + (item.expenseItems?.length ? item.expenseItems.filter(expense => itemFinalReview(item, expense) && !itemPayment(item, expense)).reduce((n, expense) => n + due(item, expense), 0) : ledgerState(item) === 'approved' ? item.amountCents : 0), 0),
        paidCount: paid.length, paidCents: items.reduce((sum, item) => sum + (item.paymentRecord?.amountCents || 0), 0) } };
  }
  function invoiceData(item, expenseId) {
    const bundle = bundles.get(item.bundleId), sources = bundle?.sources.filter(source => source.kind === 'invoice' && source.expenseItemId === expenseId) || [];
    const result = { invoiceFiles: sources.map(source => source.originalName || source.name).join('\n') };
    for (const key of ['buyerName', 'buyerTaxId', 'sellerName', 'invoiceNumber', 'invoiceDate', 'totalAmount']) {
      result[key === 'totalAmount' ? 'invoiceAmount' : key] = sources.flatMap(source => (source.checks || []).map(check => {
        const page = source.startPage + check.page - 1;
        const analysis = bundle.analyses?.find(entry => entry.page === page);
        const field = (analysis?.invoice || check.invoice)?.fields?.[key];
        const value = field?.state === 'extracted' ? field.value : field?.state === 'conflict' ? '识别冲突，待核对' : '待核对';
        return `${source.originalName || source.name} · 第 ${check.page} 页：${value}`;
      })).join('\n');
    }
    return result;
  }
  function exportFile(actor, body) {
    if (!mayExport(actor)) fail(403, '需要财务复审或查看／导出权限。');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['mode', 'columns', 'filters'].includes(key))) fail(400, '导出请求不正确。');
    if (!['requests', 'items'].includes(body.mode)) fail(400, '请选择总表或项目明细。');
    const definitions = body.mode === 'items' ? ITEM_LEDGER_COLUMNS : LEDGER_COLUMNS;
    if (!Array.isArray(body.columns) || !body.columns.length || body.columns.length > definitions.length
      || new Set(body.columns).size !== body.columns.length || body.columns.some(key => !definitions.some(column => column.key === key))) fail(400, '导出列不正确；个人身份证和银行卡字段不允许导出。');
    const items = selected(actor, body.filters, body.mode === 'items'), rows = [];
    for (const item of items) {
      const base = project(item);
      if (body.mode === 'requests') { rows.push(base); continue; }
      const expenses = (item.expenseItems?.length ? item.expenseItems : [{ id: '', label: '项目关联待核查' }]).filter(expense =>
        (!body.filters?.activityId || itemActivityId(item, expense) === body.filters.activityId) && (!body.filters?.status || expenseState(item, expense) === body.filters.status));
      for (const [index, expense] of expenses.entries()) rows.push({ ...base, amount: index === 0 ? base.amount : '',
        paidAmount: index === 0 ? base.paidAmount : '', expenseCategory: expense.category || '', expenseLabel: expense.label,
        itemActivity: activityName(itemActivityId(item, expense)) || base.activity, activityCategory: activities?.get(itemActivityId(item, expense))?.category || '',
        approvedAmount: itemFinalReview(item, expense) ? (itemFinalReview(item, expense).amountCents ?? expense.amountCents) / 100 : '',
        payableAmount: itemFinalReview(item, expense) ? due(item, expense) / 100 : '',
        itemPaidAmount: itemPayment(item, expense) ? itemPayment(item, expense).amountCents / 100 : '',
        differenceReason: [itemFinalReview(item, expense)?.reason,
          summaries?.get(itemFinalReview(item, expense)?.summaryId)?.funding?.allocations?.find(a => a.requestId === item.id && a.itemId === expense.id)?.reason].filter(Boolean).join('；'),
        expenseAmount: Number.isSafeInteger(expense.amountCents) ? expense.amountCents / 100 : '', expenseNote: expense.note || '',
        ...invoiceData(item, expense.id) });
    }
    const columns = body.columns.map(key => definitions.find(column => column.key === key));
    const name = body.mode === 'requests' ? '报销总表' : '报销项目及发票明细';
    return { name: `${name}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: tableWorkbook(columns.map(column => column.label), rows.map(row => Object.fromEntries(columns.map(column => [column.label, row[column.key] ?? '']))), { sheetName: name }) };
  }
  return { list, exportFile };
}
