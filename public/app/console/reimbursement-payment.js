import { h } from '../core/dom.js';
import { button, field, checkbox, notice, definitionList } from '../ui/primitives.js';
import { openDrawer, confirmAction } from '../ui/overlay.js';
import { reimbursementsApi as api, reimbursementAmount, operationKey } from '../shared/reimbursements-api.js';
import { announceMaterialChange } from '../shared/materials-sync.js';

export function openPaymentRegistration(item, { onDone = async () => {} } = {}) {
  const date = field({ label: '实际打款日期', name: 'paymentDate', type: 'date', required: true,
    value: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()) });
  const amount = field({ label: '本笔打款金额（元）', name: 'paymentAmount', value: (item.amountCents / 100).toFixed(2) });
  amount.control.readOnly = true;
  const reference = field({ label: '打款凭证编号（选填）', name: 'paymentReference', maxlength: 160 });
  const note = field({ label: '登记备注（选填）', name: 'paymentNote', multiline: true, rows: 2, maxlength: 500 });
  const confirmed = checkbox({ name: 'paymentConfirmed', label: '我已核对收款人和金额，确认实际打款已完成' });
  const feedback = h('div', { aria: { live: 'polite' } });
  let busy = false, disposed = false;
  const key = operationKey();
  const save = button({ label: '登记为已打款', variant: 'primary', onClick: async () => {
    if (busy || disposed) return;
    feedback.replaceChildren(); date.setError(null);
    if (!date.control.value) { date.setError('请选择实际打款日期'); date.control.focus(); return; }
    if (!confirmed.control.checked) { feedback.append(notice('请先核对并确认实际打款已完成。', { tone: 'warning' })); confirmed.control.focus(); return; }
    busy = true; const controls = [date.control, reference.control, note.control, confirmed.control, save]; controls.forEach(control => { control.disabled = true; });
    try {
      const agreed = await confirmAction({ title: '确认登记已打款？', confirmLabel: '确认登记',
        description: `${item.name} · ${reimbursementAmount(item.amountCents)}。这一步记录已经完成的打款结果。` });
      if (!agreed || disposed) return;
      await api.registerPayment(item.id, { revision: item.revision, stateVersion: item.stateVersion, amount: amount.control.value,
        paidDate: date.control.value, reference: reference.control.value.trim(), note: note.control.value.trim(), confirmed: true, idempotencyKey: key });
      if (disposed) return;
      drawer.close(); announceMaterialChange('reimbursement-created'); await onDone();
    } catch (error) { if (!disposed) feedback.replaceChildren(notice(error.message, { tone: 'error', title: '登记未完成' })); }
    finally { busy = false; controls.forEach(control => { control.disabled = false; }); }
  } });
  const drawer = openDrawer({ title: `打款结果登记 · ${item.code}`, width: 600, body: [
    definitionList([['申请人', item.name], ['申请编号', item.code],
      ['复审金额', reimbursementAmount(item.amountCents)]]),
    notice('请在实际打款完成后登记。此功能不会执行银行转账。', { tone: 'neutral' }),
    h('div', { class: 'stack-4' }, date, amount, reference, note, confirmed, feedback)], footer: [save],
    closeOnBackdrop: false, onClose: () => { disposed = true; } });
  return drawer;
}
