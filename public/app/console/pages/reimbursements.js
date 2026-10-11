import { h } from '../../core/dom.js';
import { button, field, checkbox, notice, pageHead } from '../../ui/primitives.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { materialServices } from '../../shared/material-services.js';
import { reimbursementsApi as api, reimbursementAmount } from '../../shared/reimbursements-api.js';
import { bundleDetails, requestInfo } from '../../shared/reimbursement-details.js';
import { createInvoiceChecks, invoiceCheckSummary } from '../../shared/invoice-checks.js';
import { watchMaterialChanges } from '../../shared/materials-sync.js';
import { asyncRegion } from '../lib.js';
import { materialEmpty, materialSection, reimbursementStatus } from '../../shared/material-ui.js';

export default async function reimbursementsPage() {
  const statusFilter = field({ label: '审核状态', name: 'reviewStatus', value: 'pending', options: [{ value: 'pending', label: '待审核' },
    { value: '', label: '全部' }, { value: 'returned', label: '待补充' }, { value: 'approved', label: '审核通过' }] });
  const list = h('div', { class: 'material-finance-list' });
  const count = h('p', { class: 't-caption', aria: { live: 'polite' } });
  let requests = [], disposed = false;
  const checks = createInvoiceChecks(api.analyze);
  const checkLabels = new Map(), details = new Set();
  const unsubscribe = checks.subscribe((id, state) => {
    const label = checkLabels.get(id); if (label) label.textContent = invoiceCheckSummary(state);
  });
  function renderList() {
    checkLabels.clear();
    const items = requests.filter(item => !statusFilter.control.value || item.status === statusFilter.control.value);
    count.textContent = `当前 ${items.length} 份申请 · 待审核 ${requests.filter(item => item.status === 'pending').length} 份`;
    list.replaceChildren(...items.map(item => h('div', { class: 'material-finance-row' }, h('div', { class: 'material-finance-row__body' },
      h('div', { class: 'row-3 row-wrap' }, h('b', { text: item.name }), reimbursementStatus(item)),
      h('p', { class: 't-secondary', text: item.purpose }), h('p', { class: 't-caption', text: item.code }),
      h('p', { class: 't-caption', ref: label => { checkLabels.set(item.bundle.id, label); label.textContent = invoiceCheckSummary(checks.get(item.bundle.id)); } })),
      h('b', { class: 'material-finance-row__amount', text: reimbursementAmount(item.amountCents) }),
      button({ label: item.status === 'pending' ? '审核材料' : '查看记录', variant: item.status === 'pending' ? 'secondary' : 'ghost', onClick: () => openReview(item) }))));
    if (!items.length) list.append(materialEmpty('当前没有此状态的申请', '可切换为“全部”查看记录，或刷新获取最新审核任务。', 'file'));
  }
  statusFilter.control.addEventListener('change', renderList);
  const data = asyncRegion({ load: () => api.list(), errorTitle: '报销审核尚不可用', render: payload => {
    if (disposed) return [];
    payload.requests.filter(item => item.status === 'pending').forEach(item => checks.ensure(item.bundle));
    requests = payload.requests; renderList();
    return [h('section', { class: 'panel material-review-list' },
      h('div', { class: 'panel__head material-review-toolbar' }, statusFilter, count,
        button({ label: '刷新申请', variant: 'ghost', iconName: 'refresh', onClick: () => data.reload() })),
      h('div', { class: 'panel__body' }, list))];
  } });
  const stopWatching = watchMaterialChanges(() => data.reload(), { types: ['reimbursement-created'] });
  function openReview(item) {
    const detail = bundleDetails(item.bundle, { withPreview: true, checks });
    details.add(detail);
    const feedback = h('div', { aria: { live: 'polite' } });
    const note = field({ label: '审核意见', name: 'reviewNote', multiline: true, rows: 3, maxlength: 1000, hint: '退回时必填，请说明需补充的内容。' });
    const checked = checkbox({ label: '已逐份核对原材料与申请金额', name: 'materialsChecked' });
    note.control.addEventListener('input', () => note.setError(null));
    checked.control.addEventListener('change', () => checked.control.removeAttribute('aria-invalid'));
    let busy = false;
    const approve = button({ label: '审核通过', variant: 'primary', onClick: () => decide('approve') });
    const back = button({ label: '退回补充', variant: 'secondary', onClick: () => decide('return') });
    const decision = item.status === 'pending' ? h('div', { class: 'stack-4 material-review-decision' },
      materialSection('人工核对', ''), checked, note, feedback,
      h('p', { class: 't-caption', text: '审核通过仅表示材料审核完成，不登记付款。' })) : null;
    const drawer = openDrawer({ title: `报销材料 · ${item.code}`, width: 1050,
      body: [h('div', { class: 'material-finance-layout' }, detail, h('aside', { class: 'stack-5 material-review-sidebar' },
        materialSection('申请与审核', ''), requestInfo(item), decision))],
      footer: item.status === 'pending' ? [back, h('span', { class: 'spacer' }), approve] : [], onClose: () => { detail.dispose(); details.delete(detail); } });
    async function decide(action) {
      if (busy) return;
      note.setError(null); feedback.replaceChildren();
      if (action === 'return' && !note.control.value.trim()) {
        note.setError('请说明需要补充的材料或信息'); note.control.focus(); return;
      }
      if (action === 'approve') {
        if (!checked.control.checked) {
          checked.control.setAttribute('aria-invalid', 'true');
          feedback.append(notice('请逐份核对原材料与申请金额，并勾选确认。', { tone: 'warning' }));
          checked.control.focus(); return;
        }
      }
      busy = true; approve.disabled = true; back.disabled = true;
      const controls = [checked.control, note.control]; controls.forEach(control => { control.disabled = true; });
      feedback.replaceChildren();
      try {
        const confirmed = await confirmAction({ title: action === 'approve' ? '确认审核通过？' : '确认退回补充？',
          description: `${item.name} · ${reimbursementAmount(item.amountCents)} · 第 ${item.revision} 版材料。`, confirmLabel: action === 'approve' ? '确认通过' : '确认退回' });
        if (!confirmed) return;
        await api.review(item.id, { action, revision: item.revision, note: note.control.value.trim(),
          materialsChecked: checked.control.checked });
        drawer.close(); await data.reload();
      } catch (error) { feedback.append(notice(error.message, { tone: 'error', title: '审核未完成' })); }
      finally { busy = false; approve.disabled = false; back.disabled = false; controls.forEach(control => { control.disabled = false; }); }
    }
  }
  return { title: '财务报销', crumb: '报销审核', node: h('div', { class: 'view wspad wspad--wide' },
    materialServices('finance', { console: true }), pageHead({ label: '物资服务', title: '报销材料审核', description: '查看原件与合并材料，记录人工核对结果和审核意见。',
      actions: [button({ label: '活动报销汇总', variant: 'secondary', iconName: 'file', href: '/console/reimbursements/summary' })] }), data),
    dispose: () => { disposed = true; stopWatching(); unsubscribe(); checks.dispose(); details.forEach(detail => detail.dispose()); } };
}
