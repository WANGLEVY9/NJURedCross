import { h } from '../core/dom.js';
import { field, button, checkbox, notice } from '../ui/primitives.js';
import { openDrawer, confirmAction } from '../ui/overlay.js';
import { reimbursementsApi as api, reimbursementAmount, operationKey } from '../shared/reimbursements-api.js';
import { financeSelection, financeRowKey, financeTable } from './reimbursement-finance-nav.js';
const localDate = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
const amountInput = (name, label, value) => field({ name, label, type: 'number', min: 0, step: '.01', required: true, value: (value / 100).toFixed(2) });

export function fundingDialog(batch, { onDone }) {
  const feedback = h('div', { aria: { live: 'polite' } });
  const submitted = field({ name: 'financeSubmittedDate', label: '材料提交日期', type: 'date', required: true, value: batch.funding?.submittedDate || localDate() });
  const received = field({ name: 'financeReceivedDate', label: '经费到账日期', type: 'date', value: batch.funding?.receivedDate || '' });
  const amount = field({ name: 'financeReceivedAmount', label: '实际到账金额（元）', type: 'number', min: 0, step: '.01',
    value: batch.funding?.receivedCents === undefined ? '' : (batch.funding.receivedCents / 100).toFixed(2), hint: '尚未到账时留空；到账金额有差额时，在下方逐项分配。' });
  const note = field({ name: 'financeFundingNote', label: '登记备注', multiline: true, rows: 2, maxlength: 500, value: batch.funding?.note || '' });
  const allocations = batch.rows.flatMap(row => row.origins.map(origin => {
    const previous = batch.funding?.allocations?.find(a => a.requestId === origin.requestId && a.itemId === origin.itemId);
    return { ...origin, label: row.label, applicant: batch.selections.find(s => s.requestId === origin.requestId)?.applicant || '',
      amount: amountInput(`allocation-${financeRowKey(origin)}`, '', previous?.amountCents ?? origin.amountCents),
      reason: field({ name: `allocation-reason-${financeRowKey(origin)}`, label: '', placeholder: '减少时必填原因', maxlength: 500, value: previous?.reason || '' }) };
  }));
  allocations.forEach(a => { a.amount.control.setAttribute('aria-label', `${a.label}实际可支付金额`); a.reason.control.setAttribute('aria-label', `${a.label}差额原因`); });
  const allocated = h('p', { class: 't-secondary', aria: { live: 'polite' } });
  const update = () => { const sum = allocations.reduce((total, a) => total + Math.round(Number(a.amount.control.value) * 100), 0);
    allocated.textContent = `逐项分配合计 ${reimbursementAmount(sum)} · 终审核定 ${reimbursementAmount(batch.totalCents)}`; };
  allocations.forEach(a => a.amount.control.addEventListener('input', update)); update();
  const save = button({ label: '保存登记', variant: 'primary', onClick: async () => {
    if (save.disabled) return; feedback.replaceChildren();
    if (!submitted.control.value) { submitted.setError('请填写材料提交日期'); return; }
    const hasReceived = Boolean(received.control.value || amount.control.value !== '');
    save.disabled = true;
    try {
      await api.registerFunding(batch.id, { stateVersion: batch.stateVersion, submittedDate: submitted.control.value,
        ...(hasReceived ? { receivedDate: received.control.value, receivedAmount: amount.control.value,
          allocations: allocations.map(a => ({ requestId: a.requestId, itemId: a.itemId, amount: a.amount.control.value, reason: a.reason.control.value.trim() })) } : {}), note: note.control.value.trim() });
      await drawer.close(); await onDone();
    } catch (error) { feedback.replaceChildren(notice(error.message, { tone: 'error' })); }
    finally { save.disabled = false; }
  } });
  if (batch.paymentProgress?.count) {
    save.hidden = true;
    [submitted, received, amount, note, ...allocations.flatMap(a => [a.amount, a.reason])].forEach(f => { f.control.disabled = true; });
    feedback.append(notice('本批已有打款记录，到账金额和分配保留供查阅。', { tone: 'neutral' }));
  }
  const drawer = openDrawer({ title: `材料与到账登记 · ${batch.activity.name}`, width: 960,
    body: [h('div', { class: 'stack-4' }, h('p', { class: 't-secondary', text: `${batch.code} · 核定 ${reimbursementAmount(batch.totalCents)}` }),
      h('div', { class: 'formgrid' }, submitted, received, amount),
      h('details', { open: true, class: 'finance-allocation' }, h('summary', { text: '逐项确认实际可支付金额及差额原因' }),
        financeTable(['支出项目', '申请人', '核定金额', '实际可支付（元）', '差额原因'], allocations.map(a => h('tr', {}, h('td', { text: a.label }), h('td', { text: a.applicant }),
          h('td', { text: reimbursementAmount(a.amountCents) }), h('td', {}, a.amount), h('td', {}, a.reason)))), allocated), note, feedback)], footer: [save] });
}

export function financePaymentDialog(rows, operator, { onDone }) {
  const total = rows.reduce((sum, row) => sum + row.payableCents, 0), feedback = h('div', { aria: { live: 'polite' } });
  const amount = field({ label: '实际打款总金额（元）', name: 'financePaymentAmount', type: 'number', min: 0, step: '.01', required: true, hint: `所选条目应付合计 ${reimbursementAmount(total)}，请核对后填写。` });
  const paidDate = field({ label: '实际打款日期', name: 'financePaidDate', type: 'date', required: true, value: localDate() });
  const reference = field({ label: '打款凭证编号', name: 'financePaymentReference', maxlength: 160 });
  const note = field({ label: '备注', name: 'financePaymentNote', multiline: true, rows: 2, maxlength: 500 });
  const confirmed = checkbox({ label: '已核对收款人和金额，实际打款已完成', name: 'financePaymentConfirmed' });
  const groups = new Map(); rows.forEach(row => { const key = JSON.stringify([row.activityId, row.owner]); const group = groups.get(key) || { ...row, count: 0, total: 0 };
    group.count++; group.total += row.payableCents; groups.set(key, group); });
  const key = operationKey();
  const save = button({ label: '确认登记打款', variant: 'primary', onClick: async () => {
    if (save.disabled) return; feedback.replaceChildren();
    if (!amount.control.value || Math.round(Number(amount.control.value) * 100) !== total) { amount.setError('实际金额须与所选条目合计一致；有差额请先核对报销单的到账分配。'); return; }
    if (!confirmed.control.checked) { feedback.append(notice('请先确认实际打款已完成。', { tone: 'error' })); return; }
    save.disabled = true;
    try {
      if (!await confirmAction({ title: '确认记录已完成的打款？', description: `${rows.length} 项支出 · ${groups.size} 组活动与申请人 · ${reimbursementAmount(total)}`, confirmLabel: '确认登记' })) return;
      await api.payItems({ selections: rows.map(financeSelection), amount: amount.control.value, paidDate: paidDate.control.value,
        reference: reference.control.value.trim(), note: note.control.value.trim(), confirmed: true, idempotencyKey: key });
      await drawer.close(); await onDone();
    } catch (error) { feedback.replaceChildren(notice(error.message, { tone: 'error' })); }
    finally { save.disabled = false; }
  } });
  const drawer = openDrawer({ title: rows.length === 1 ? '逐项打款登记' : '批量打款登记', width: 820, body: [h('div', { class: 'stack-4' },
    h('p', { class: 't-secondary', text: `打款人：${operator.name || '当前登录账号'} · ${rows.length} 项 · 合计 ${reimbursementAmount(total)}` }),
    financeTable(['活动', '申请人', '条目数', '本次打款'], [...groups.values()].map(g => h('tr', {}, h('td', { text: g.activity }), h('td', { text: g.applicant }), h('td', { text: g.count }), h('td', { text: reimbursementAmount(g.total) })))),
    h('div', { class: 'formgrid' }, paidDate, amount), reference, note, confirmed, feedback)], footer: [save] });
}
