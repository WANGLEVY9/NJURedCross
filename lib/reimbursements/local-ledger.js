import { checkedDate } from './summary-contract.js';
import { hasFinalApproval } from './workflow.js';
import { paymentEligibility } from './local-payment.js';
import { tableWorkbook } from '../events/xlsx.js';
import { LEDGER_COLUMNS, ITEM_LEDGER_COLUMNS } from '../../public/app/shared/reimbursement-ledger-fields.js';
import { itemActivityId, itemFinalReview, itemPayment } from './finance-items.js';
import { zipEntries } from './docx-writer.js';
import { observer } from '../observability.js';
import { reimbursementApprovalIssue, reimbursementEvidence } from './evidence-policy.js';
import { reimbursementMaterialIssues } from '../../public/app/shared/reimbursement-material-rules.js';
import { MB } from '../../public/app/shared/reimbursement-limits.js';

function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode }); }
export function ledgerState(item) {
  return item.status === 'approved' ? !hasFinalApproval(item) ? 'legacy' : item.paymentStatus === 'paid' ? 'paid' : 'approved' : item.status;
}
const labels = { pending: '待初审', final_pending: '待复审', initial_returned: '复审退回初审', returned: '待申请人补充',
  approved: '复审通过／待打款', paid: '已打款', legacy: '原审核通过（旧流程待核查）' };

const ARCHIVE_MAX_BYTES = 60 * MB;
const zipPart = value => String(value || '').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
  .trim().replace(/^[.]+|[. ]+$/g, '').slice(0, 160) || '材料';
const archiveMonth = value => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 7);
export function retainOriginalsUntil(paidDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate || '')) return '';
  const [year, month, day] = paidDate.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + 6, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/** The projection and column whitelist deliberately contain no identity-card or bank-account fields. */
export function createLocalLedger({ requests, bundles, activities, summaries, reviewer, canRead, mayExport, mayPay, activityName, archiveAttachment }) {
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
  function originalsRetention(item) {
    const dates = [item.paymentRecord?.paidDate, ...(item.expenseItems || []).map(expense => itemPayment(item, expense)?.paidDate)];
    return retainOriginalsUntil(dates.filter(Boolean).sort().at(-1));
  }
  function project(item) {
    const retainUntil = originalsRetention(item);
    return { ...(retainUntil ? { retainUntil } : {}), code: item.code, applicant: item.name, activity: activityName(item.activityId, item) || '未关联活动', purpose: item.purpose,
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
  async function archive(actor, month, activityId = '') {
    if (!mayExport(actor)) fail(403, '需要财务复审或查看／导出权限。');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') || typeof activityId !== 'string' || activityId.length > 160)
      fail(400, '请选择有效的归档月份及活动。');
    const root = month + ' 待报销', entries = [];
    let size = 0;
    function add(name, data) {
      const bytes = Buffer.from(data);
      size += bytes.length;
      if (size > ARCHIVE_MAX_BYTES || entries.length >= 1000) fail(413, '月度归档超过大小限制，请按活动分开导出。');
      entries.push({ name, data: bytes, store: true });
    }
    for (const item of selected(actor, { activityId })) {
      const submitted = item.history?.findLast(event => ['submit', 'resubmit'].includes(event.action))?.at || item.createdAt;
      if (archiveMonth(submitted) !== month || !['final_pending', 'approved'].includes(item.status)) continue;
      const bundle = bundles.get(item.bundleId);
      if (!bundle?.files || reimbursementMaterialIssues(item, bundle.files).length) continue;
      const evidence = reimbursementEvidence(item, bundle);
      if (reimbursementApprovalIssue(item, evidence)) continue;
      const category = evidence.separate.size ? '含另行报销材料' : '学校报销';
      const folder = root + '/' + category + '/' + zipPart(item.code);
      if (bundle.pageCount) {
        const file = await archiveAttachment(actor, bundle.id);
        add(folder + '/' + zipPart(file.name), file.bytes);
      }
      for (const [index, source] of bundle.files.entries()) {
        add(folder + '/原件/' + String(index + 1).padStart(2, '0') + '-' + zipPart(source.name), source.bytes);
      }
      const retainUntil = originalsRetention(item);
      add(folder + '/留存说明.txt', (retainUntil ? '原件至少保留至 ' + retainUntil + '。' : '请保留原件，到账后至少继续保存六个月。')
        + (evidence.separate.size ? '\n含非南京大学抬头材料，请按实际渠道另行处理。' : '') + '\n');
    }
    if (!entries.length) fail(404, '该月份暂无符合归档条件的报销材料。');
    const bytes = await observer.dependency('content', 'generate', () => zipEntries(entries));
    return { name: root + '.zip', contentType: 'application/zip', bytes };
  }
  return { list, exportFile, archive };
}
