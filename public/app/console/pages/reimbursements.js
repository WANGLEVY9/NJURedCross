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
import { reimbursementPackets } from '../reimbursement-packets.js';
import { openPaymentRegistration } from '../reimbursement-payment.js';

export default async function reimbursementsPage() {
  const statusFilter = field({ label: '审核状态', name: 'reviewStatus', value: 'pending', options: [{ value: 'pending', label: '待初审' },
    { value: 'initial_returned', label: '复审退回初审' }, { value: 'final_pending', label: '待复审' },
    { value: 'returned', label: '待申请人补充' }, { value: 'approved', label: '复审通过／待打款' }, { value: 'paid', label: '已打款' }, { value: '', label: '全部' }] });
  const list = h('div', { class: 'material-finance-list' });
  const count = h('p', { class: 't-caption', aria: { live: 'polite' } });
  let requests = [], disposed = false, configured = false, workflow = { version: 2, permissions: [] };
  const summaryLink = button({ label: '活动报销汇总', variant: 'secondary', iconName: 'file', href: '/console/reimbursements/summary' });
  summaryLink.hidden = true;
  const ledgerLink = button({ label: '总表与明细导出', variant: 'secondary', href: '/console/reimbursements/ledger' }); ledgerLink.hidden = true;
  const may = permission => workflow.permissions.includes(permission);
  const initialStage = item => ['pending', 'initial_returned'].includes(item.status);
  const mayHandle = item => initialStage(item) && may('initial') || item.status === 'final_pending' && may('final') && !workflow.activityReview;
  const mayPay = item => workflow.paymentRegistration === true && may('payment') && item.paymentEligibility?.eligible;
  let linkedRequestOpened = false;
  const checks = createInvoiceChecks(api.analyze);
  const checkLabels = new Map(), details = new Set();
  const unsubscribe = checks.subscribe((id, state) => {
    const label = checkLabels.get(id); if (label) label.textContent = invoiceCheckSummary(state);
  });
  function renderList() {
    checkLabels.clear();
    const items = requests.filter(item => {
      const filter = statusFilter.control.value;
      if (!filter) return true;
      if (filter === 'paid') return item.paymentStatus === 'paid';
      return item.status === filter && item.paymentStatus !== 'paid';
    });
    count.textContent = `当前 ${items.length} 份申请 · 初审 ${requests.filter(initialStage).length} 份 · 复审 ${requests.filter(item => item.status === 'final_pending').length} 份`;
    const row = item => h('div', { class: 'material-finance-row' }, h('div', { class: 'material-finance-row__body' },
      h('div', { class: 'row-3 row-wrap' }, h('b', { text: item.name }), reimbursementStatus(item)),
      h('p', { class: 't-secondary', text: item.purpose }), h('p', { class: 't-caption', text: item.code }),
      h('p', { class: 't-caption', ref: label => { checkLabels.set(item.bundle.id, label); label.textContent = invoiceCheckSummary(checks.get(item.bundle.id)); } })),
      h('b', { class: 'material-finance-row__amount', text: reimbursementAmount(item.amountCents) }),
      button({ label: mayHandle(item) ? item.status === 'final_pending' ? '复审材料' : '初审材料' : mayPay(item) ? '登记打款' : '查看记录', variant: mayHandle(item) || mayPay(item) ? 'secondary' : 'ghost',
        ...(workflow.activityReview && item.status === 'final_pending' && may('final') ? { label: '活动终审', href: `/console/reimbursements/summary?activity=${encodeURIComponent(item.activityId)}` } : { onClick: () => mayPay(item) ? openPaymentRegistration(item, { onDone: () => data.reload() }) : openReview(item) }) }));
    const activities = new Map();
    for (const item of items) {
      const key = item.activityId || '';
      if (!activities.has(key)) activities.set(key, []);
      activities.get(key).push(item);
    }
    list.replaceChildren(...[...activities.values()].map(group => h('section', { class: 'stack-3 material-review-activity' },
      h('h2', { class: 't-h4', text: `${group[0].activityName || '未关联活动'} · ${group.length} 份申请` }), ...group.map(row))));
    if (!items.length) list.append(materialEmpty('当前没有此状态的申请', '可切换为“全部”查看记录，或刷新获取最新审核任务。', 'file'));
  }
  statusFilter.control.addEventListener('change', renderList);
  const data = asyncRegion({ load: async () => {
    const [payload, config] = await Promise.all([api.list(), api.config()]); return { ...payload, workflow: config.workflow };
  }, errorTitle: '报销审核尚不可用', render: payload => {
    if (disposed) return [];
    workflow = payload.workflow || { version: 2, permissions: [] };
    summaryLink.hidden = !may('final') && !may('view');
    ledgerLink.hidden = workflow.ledger !== true;
    if (!configured) { statusFilter.control.value = may('initial') ? 'pending' : may('final') ? 'final_pending' : may('payment') ? 'approved' : ''; configured = true; }
    payload.requests.filter(mayHandle).forEach(item => checks.ensure(item.bundle));
    requests = payload.requests; renderList();
    const linkedId = new URLSearchParams(location.search).get('request');
    if (!linkedRequestOpened && linkedId) { linkedRequestOpened = true; const linked = requests.find(item => item.id === linkedId); if (linked) openReview(linked); }
    return [h('section', { class: 'panel material-review-list' },
      h('div', { class: 'panel__head material-review-toolbar' }, statusFilter, count,
        button({ label: '刷新申请', variant: 'ghost', iconName: 'refresh', onClick: () => data.reload() })),
      h('div', { class: 'panel__body' }, list))];
  } });
  const stopWatching = watchMaterialChanges(() => data.reload(), { types: ['reimbursement-created'] });
  function openReview(item) {
    const finalStage = item.status === 'final_pending', actionable = mayHandle(item);
    const detail = bundleDetails(item.bundle, { withPreview: true, checks, request: item, originalsFirst: true, mergedFirst: workflow.activityReview });
    details.add(detail);
    const feedback = h('div', { aria: { live: 'polite' } });
    const note = field({ label: '审核意见', name: 'reviewNote', multiline: true, rows: 3, maxlength: 1000, hint: '退回时必填，请说明需补充的内容。' });
    const checked = checkbox({ label: '已逐份核对原材料与申请金额', name: 'materialsChecked' });
    const packets = workflow.activityReview ? null : reimbursementPackets(item, checked.control, { canGenerate: may('initial') && initialStage(item), autoPreview: finalStage });
    if (packets) { details.add(packets); if (finalStage) detail.prepend(packets); else detail.append(packets); }
    note.control.addEventListener('input', () => note.setError(null));
    checked.control.addEventListener('change', () => checked.control.removeAttribute('aria-invalid'));
    let busy = false;
    const approve = button({ label: workflow.version === 1 ? '审核通过' : finalStage ? '复审通过' : '初审通过并送复审', variant: 'primary', onClick: () => decide(true) });
    const back = button({ label: workflow.version === 1 ? '退回补充' : finalStage ? '退回初审' : '退回申请人补充', variant: 'secondary', onClick: () => decide(false) });
    const decision = actionable ? h('div', { class: 'stack-4 material-review-decision' },
      materialSection(finalStage ? '复审核对' : '初审核对', ''),
      item.status === 'initial_returned' ? notice(`复审意见：${item.history.findLast(event => event.action === 'final-return')?.note || '请核查审核记录。'}`, { tone: 'warning' }) : null,
      checked, note, feedback,
      h('p', { class: 't-caption', text: finalStage ? '通过后进入待打款；退回交由初审处理。' : workflow.activityReview ? '核对合并材料后可直接通过或退回，条目材料已自动整理。' : '先核对并生成本版材料，再送复审。生成材料不会自动送审。' })) : null;
    const drawer = openDrawer({ title: `报销材料 · ${item.code}`, width: 1050,
      body: [h('div', { class: 'material-finance-layout' }, detail, h('aside', { class: 'stack-5 material-review-sidebar' },
        materialSection('申请与审核', ''), requestInfo(item), decision))],
      footer: actionable ? [back, h('span', { class: 'spacer' }), approve] : [], onClose: () => {
        detail.dispose(); packets?.dispose(); details.delete(detail); details.delete(packets);
      } });
    async function decide(passing) {
      const action = workflow.version === 1 ? passing ? 'approve' : 'return' : `${finalStage ? 'final' : 'initial'}-${passing ? 'approve' : 'return'}`;
      if (busy) return;
      note.setError(null); feedback.replaceChildren();
      if (!passing && !note.control.value.trim()) {
        note.setError('请说明需要补充的材料或信息'); note.control.focus(); return;
      }
      if (passing) {
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
        const confirmed = await confirmAction({ title: `${passing ? approve.textContent : back.textContent}？`,
          description: `${item.name} · ${reimbursementAmount(item.amountCents)} · 第 ${item.revision} 版材料。`, confirmLabel: passing ? '确认通过' : '确认退回' });
        if (!confirmed) return;
        await api.review(item.id, { action, revision: item.revision, note: note.control.value.trim(),
          ...(workflow.version >= 2 ? { stateVersion: item.stateVersion } : {}),
          materialsChecked: checked.control.checked });
        drawer.close(); await data.reload();
      } catch (error) { feedback.append(notice(error.message, { tone: 'error', title: '审核未完成' })); }
      finally { busy = false; approve.disabled = false; back.disabled = false; controls.forEach(control => { control.disabled = false; }); }
    }
  }
  return { title: '财务报销', crumb: '报销审核', node: h('div', { class: 'view wspad wspad--wide' },
    materialServices('finance', { console: true }), pageHead({ label: '物资服务', title: '报销材料审核', description: '查看原件与合并材料，记录人工核对结果和审核意见。',
      actions: [summaryLink, ledgerLink] }), data),
    dispose: () => { disposed = true; stopWatching(); unsubscribe(); checks.dispose(); details.forEach(detail => detail.dispose()); } };
}
