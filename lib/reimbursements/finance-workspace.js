import { checkedDate, checkedText, objectFields, summaryFailure } from './summary-contract.js';
import { financeKey, itemActivityId, itemFinalReview, itemPayment, financeRecord, syncFinanceRequest } from './finance-items.js';
import { reimbursementActivityCategory } from '../../public/app/shared/reimbursement-activities.js';

const fail = (status, message) => { throw summaryFailure(message, status); };
const money = (value, label = '金额') => {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value)) fail(400, `${label}须为非负数，最多两位小数。`);
  const [yuan, fraction = ''] = value.split('.'); return Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
};
export function createFinanceWorkspace({ state, queue, requirePermission, permissionsFor, now, limits, apiRoot }) {
  const { requests, activities, summaries, paymentReceipts } = state;
  const may = (actor, permission) => permissionsFor(actor).includes(permission);
  function reader(actor) { if (!actor?.id || !['final', 'view', 'payment'].some(p => may(actor, p))) fail(403, '需要终审、财务查看或打款权限。'); }
  function payer(actor) { if (!actor?.id || !may(actor, 'final') && !may(actor, 'payment')) fail(403, '需要终审或打款权限。'); }
  function selection(entry) {
    objectFields(entry, ['requestId', 'itemId', 'revision', 'stateVersion'], '条目');
    const request = requests.get(entry.requestId), item = request?.expenseItems?.find(row => row.id === entry.itemId);
    if (!item) fail(404, '支出条目不存在。');
    if (request.revision !== entry.revision || request.stateVersion !== entry.stateVersion) fail(409, '条目状态或版本已变化，请刷新后重试。');
    return { request, item };
  }
  function selected(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 200) fail(400, '请选择 1 至 200 项支出。');
    if (new Set(entries.map(e => financeKey(e.requestId, e.itemId))).size !== entries.length) fail(400, '不能重复选择条目。');
    return entries.map(selection);
  }
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(now()));
  function date(value, label) { const result = checkedDate(value, label); if (result > today()) fail(400, `${label}不能晚于今天。`); return result; }
  function payable(request, item) {
    const review = itemFinalReview(request, item), summary = summaries.get(review?.summaryId);
    const allocation = summary?.funding?.allocations?.find(a => a.requestId === request.id && a.itemId === item.id);
    return { summary, review, allocation, cents: allocation?.amountCents ?? review?.amountCents ?? item.amountCents };
  }
  function rows() {
    return [...requests.values()].flatMap(request => (request.expenseItems || []).map(item => {
      const activityId = itemActivityId(request, item), activity = activities.get(activityId), payment = itemPayment(request, item);
      const { review, summary, cents } = payable(request, item);
      const ready = Boolean(review && summary?.status === 'approved' && summary.funding?.receivedDate && !payment);
      return { requestId: request.id, itemId: item.id, revision: request.revision, stateVersion: request.stateVersion,
        code: request.code, owner: request.owner, applicant: request.name, label: item.label, note: item.note || '',
        activityId, activity: activity?.name || request.activityNameSnapshot || '未关联活动', activityCategory: reimbursementActivityCategory(activity),
        sourceActivityId: request.activityId, sourceActivity: request.activityNameSnapshot || activities.get(request.activityId)?.name || '',
        amountCents: item.amountCents, approvedCents: review?.amountCents ?? (review ? item.amountCents : null), payableCents: review ? cents : null,
        paidCents: payment?.amountCents ?? null, paidDate: payment?.paidDate || '', paidBy: payment?.actorName || payment?.actor || '',
        expenseDate: request.expenseDate || '', summaryId: review?.summaryId || '',
        status: payment ? 'paid' : review ? 'approved' : request.status,
        statusLabel: payment ? '已打款' : review ? ready ? '可登记打款' : '待经费到账' : ({ pending: '待初审', final_pending: '待终审', initial_returned: '退回初审', returned: '待申请人补充' }[request.status] || '待核查'),
        canMove: !review && request.workflowVersion === 3,
        canSummarize: !review && request.workflowVersion === 3 && request.status === 'final_pending'
          && request.initialReview?.revision === request.revision && request.initialReview?.bundleId === request.bundleId,
        canPay: ready, fundingRegistered: Boolean(summary?.funding?.receivedDate),
      };
    }));
  }
  function list(actor) {
    reader(actor);
    const fullView = may(actor, 'final') || may(actor, 'view'), items = rows().filter(row => fullView || row.approvedCents !== null);
    return { ok: true, items, activities: [...activities.values()].map(a => structuredClone({ ...a, category: reimbursementActivityCategory(a) })),
      batches: [...summaries.values()].reverse().filter(record => fullView || record.status === 'approved').map(record => ({
        ...structuredClone(Object.fromEntries(Object.keys(record).filter(key => !['formPdf', 'packetPdf'].includes(key)).map(key => [key, record[key]]))),
        formUrl: `${apiRoot}/summaries/${record.id}/form`, packetUrl: `${apiRoot}/summaries/${record.id}/packet` })),
      operator: { name: actor.realName || '', phone: actor.phone || '' },
      permissions: { edit: may(actor, 'final'), pay: may(actor, 'final') || may(actor, 'payment') } };
  }
  function move(actor, body) {
    requirePermission(actor, 'final');
    return queue(() => {
      objectFields(body, ['selections', 'activityId'], '活动归属调整');
      const activity = activities.get(body.activityId); if (!activity) fail(400, '请选择有效活动。');
      const entries = selected(body.selections);
      if (entries.some(({ request, item }) => request.workflowVersion !== 3 || itemFinalReview(request, item))) fail(409, '已终审条目保留材料归属，不能移动；请仅选择尚未终审的条目。');
      const changed = new Set(), at = now();
      for (const { request, item } of entries) {
        const before = itemActivityId(request, item); if (before === activity.id) continue;
        financeRecord(request, item).activityId = activity.id;
        request.history.push({ action: 'finance-item-moved', itemId: item.id, actor: actor.id, at, fromActivityId: before, activityId: activity.id,
          revision: request.revision, bundleId: request.bundleId }); changed.add(request);
      }
      for (const request of changed) { request.stateVersion++; request.updatedAt = at; }
      return { ok: true, changed: changed.size };
    });
  }
  function registerFunding(actor, id, body) {
    payer(actor);
    return queue(() => {
      objectFields(body, ['stateVersion', 'submittedDate', 'receivedDate', 'receivedAmount', 'allocations', 'note'], '材料与到账登记');
      const summary = summaries.get(id);
      if (!summary || summary.status !== 'approved') fail(409, '仅终审通过的报销单可登记材料提交或经费到账。');
      if (summary.stateVersion !== body.stateVersion) fail(409, '报销单记录已变化，请刷新后登记。');
      const submittedDate = date(body.submittedDate, '材料提交日期'), at = now();
      const note = checkedText(body.note, '登记备注', 500, true);
      const existingRows = rows().filter(row => row.summaryId === id);
      if (existingRows.some(row => row.paidCents !== null)) fail(409, '本批已有打款记录，不能修改到账分配。');
      let funding = { submittedDate, actor: actor.id, actorName: actor.realName || actor.id, recordedAt: at, note };
      if (body.receivedDate || body.receivedAmount !== undefined && body.receivedAmount !== '') {
        const receivedDate = date(body.receivedDate, '经费到账日期'), receivedCents = money(body.receivedAmount, '实际到账金额');
        if (receivedDate < submittedDate) fail(400, '经费到账日期不能早于材料提交日期。');
        if (receivedCents > summary.totalCents) fail(400, '实际到账金额不能超过本批终审核定总额。');
        const targets = summary.rows.flatMap(row => row.origins.map(origin => ({ ...origin, approvedCents: origin.amountCents })));
        let allocations;
        if (body.allocations !== undefined) {
          if (!Array.isArray(body.allocations) || body.allocations.length !== targets.length) fail(400, '请逐项确认本批所有条目的实际可支付金额。');
          const seen = new Set();
          allocations = body.allocations.map(value => {
            objectFields(value, ['requestId', 'itemId', 'amount', 'reason'], '到账分配');
            const key = financeKey(value.requestId, value.itemId), target = targets.find(t => financeKey(t.requestId, t.itemId) === key);
            if (!target || seen.has(key)) fail(400, '到账分配存在重复或不属于本批的条目。'); seen.add(key);
            const amountCents = money(value.amount, '条目实际可支付金额'), reason = checkedText(value.reason, '差额原因', 500, amountCents === target.approvedCents);
            if (amountCents > target.approvedCents) fail(400, '条目实际可支付金额不能超过终审核定金额。');
            return { requestId: value.requestId, itemId: value.itemId, amountCents, reason };
          });
        } else {
          if (receivedCents !== summary.totalCents) fail(400, '到账金额与核定总额不一致，请逐项分配并填写差额原因。');
          allocations = targets.map(t => ({ requestId: t.requestId, itemId: t.itemId, amountCents: t.approvedCents, reason: '' }));
        }
        if (allocations.reduce((sum, a) => sum + a.amountCents, 0) !== receivedCents) fail(400, '各条目实际可支付金额之和必须等于本批实际到账金额。');
        funding = { ...funding, receivedDate, receivedCents, allocations };
      } else if (summary.funding?.receivedDate) fail(409, '已登记到账，不能撤销为未到账。');
      summary.funding = funding; summary.stateVersion++;
      summary.financeHistory ||= []; summary.financeHistory.push({ action: 'funding-recorded', actor: actor.id, at, funding: structuredClone(funding) });
      return { ok: true };
    });
  }
  function pay(actor, body) {
    payer(actor);
    return queue(() => {
      objectFields(body, ['selections', 'amount', 'paidDate', 'reference', 'note', 'confirmed', 'idempotencyKey'], '打款登记');
      const key = `items:${actor.id}:${checkedText(body.idempotencyKey, '操作标识', 160)}`, fingerprint = JSON.stringify(body), previous = paymentReceipts.get(key);
      if (previous) { if (previous.fingerprint !== fingerprint) fail(409, '同一操作标识不能用于不同打款内容。'); return { ok: true, duplicate: true }; }
      const entries = selected(body.selections), paidDate = date(body.paidDate, '实际打款日期');
      if (body.confirmed !== true) fail(400, '请先确认实际打款已完成。');
      const reference = checkedText(body.reference, '打款凭证编号', 160, true), note = checkedText(body.note, '打款备注', 500, true);
      const payments = entries.map(({ request, item }) => {
        const { summary, review, allocation, cents } = payable(request, item);
        if (!review || summary?.status !== 'approved' || !summary.funding?.receivedDate || !allocation || itemPayment(request, item)) fail(409, '所选条目尚未登记经费到账，或已经登记打款。');
        if (paidDate < summary.funding.receivedDate) fail(400, '打款日期不能早于经费到账日期。');
        return { request, item, cents, summaryId: summary.id, review };
      });
      if (money(body.amount, '实际打款总金额') !== payments.reduce((sum, p) => sum + p.cents, 0)) fail(400, '实际打款总金额与所选条目合计不一致，请核对到账分配及差额原因后分别登记。');
      if (paymentReceipts.size >= limits.payments) fail(413, '打款登记数量已达容量上限。');
      const at = now(), changed = new Set();
      for (const { request, item, cents, summaryId, review } of payments) {
        const record = { actor: actor.id, actorName: actor.realName || actor.id, recordedAt: at, paidDate, amountCents: cents,
          reference, note, summaryId, revision: review.revision, bundleId: review.bundleId };
        financeRecord(request, item).payment = record; changed.add(request);
        request.history.push({ action: 'finance-item-paid', itemId: item.id, ...record, at });
      }
      for (const request of changed) { syncFinanceRequest(request); request.stateVersion++; request.updatedAt = at; }
      for (const id of new Set(payments.map(p => p.summaryId))) {
        const summary = summaries.get(id), all = rows().filter(row => row.summaryId === id);
        summary.paymentProgress = { count: all.filter(row => row.paidCents !== null).length,
          amountCents: all.reduce((sum, row) => sum + (row.paidCents || 0), 0), actor: actor.id, actorName: actor.realName || actor.id, paidDate };
        summary.stateVersion++;
        summary.financeHistory ||= []; summary.financeHistory.push({ action: 'payments-recorded', actor: actor.id, at, ...summary.paymentProgress });
      }
      paymentReceipts.set(key, { fingerprint }); return { ok: true };
    });
  }
  return { list, move, registerFunding, pay };
}
