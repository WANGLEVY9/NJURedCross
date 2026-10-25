import { h } from '../../core/dom.js';
import { getSessionState } from '../../core/api.js';
import { button, field, checkbox, notice, pageHead } from '../../ui/primitives.js';
import { materialServices } from '../../shared/material-services.js';
import { reimbursementsApi as api, reimbursementAmount } from '../../shared/reimbursements-api.js';
import { LEDGER_COLUMNS, ITEM_LEDGER_COLUMNS } from '../../shared/reimbursement-ledger-fields.js';
import { openPaymentRegistration } from '../reimbursement-payment.js';
import { watchMaterialChanges } from '../../shared/materials-sync.js';

export default async function ledgerPage() {
  const activity = field({ label: '活动', name: 'ledgerActivity', searchable: true, options: [{ value: '', label: '全部活动' }] });
  const state = field({ label: '处理状态', name: 'ledgerStatus', options: [{ value: '', label: '全部' }, { value: 'pending', label: '待初审' },
    { value: 'final_pending', label: '待复审' }, { value: 'initial_returned', label: '复审退回初审' }, { value: 'returned', label: '待申请人补充' },
    { value: 'approved', label: '待打款' }, { value: 'paid', label: '已打款' }, { value: 'legacy', label: '旧流程待核查' }] });
  const from = field({ label: '费用发生日期起', name: 'ledgerFrom', type: 'date' });
  const to = field({ label: '费用发生日期止', name: 'ledgerTo', type: 'date' });
  const search = field({ label: '姓名／编号／事由', name: 'ledgerSearch', maxlength: 100 });
  const status = h('div', { aria: { live: 'polite' } }), totals = h('div', { class: 'material-ledger-totals' }), rows = h('div', { class: 'material-ledger-rows' });
  const mode = field({ label: '导出内容', name: 'ledgerExportMode', value: 'requests', options: [{ value: 'requests', label: '报销总表' }, { value: 'items', label: '项目及发票明细' }] });
  const columns = h('div', { class: 'material-ledger-columns' });
  let selectedColumns = new Set(['code', 'applicant', 'activity', 'amount', 'status', 'expenseDate', 'paidDate']), disposed = false, busy = false, sequence = 0, enabled = false;
  const filters = () => ({ activityId: activity.control.value, status: state.control.value, from: from.control.value, to: to.control.value, search: search.control.value.trim() });
  const definitions = () => mode.control.value === 'items' ? ITEM_LEDGER_COLUMNS : LEDGER_COLUMNS;
  function renderColumns() {
    selectedColumns = new Set([...selectedColumns].filter(key => definitions().some(column => column.key === key)));
    columns.replaceChildren(...definitions().map(column => checkbox({ name: `export-${column.key}`, label: column.label, checked: selectedColumns.has(column.key),
      onChange: checked => { if (checked) selectedColumns.add(column.key); else selectedColumns.delete(column.key); } })));
  }
  mode.control.addEventListener('change', () => {
    if (mode.control.value === 'items') selectedColumns = new Set(['code', 'applicant', 'activity', 'status', 'expenseLabel', 'expenseAmount', 'invoiceNumber', 'invoiceDate', 'invoiceAmount']);
    renderColumns();
  }); renderColumns();
  const exportStatus = h('div', { aria: { live: 'polite' } });
  const download = button({ label: '导出 Excel', variant: 'primary', onClick: async () => {
    if (busy || !enabled) return;
    exportStatus.replaceChildren();
    if (!selectedColumns.size) { exportStatus.append(notice('请至少选择一列。', { tone: 'warning' })); return; }
    const exportMode = mode.control.value;
    busy = true; download.disabled = true;
    try {
      const response = await fetch('/api/preview/reimbursements/ledger/export', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getSessionState().csrfToken },
        body: JSON.stringify({ mode: exportMode, columns: definitions().filter(column => selectedColumns.has(column.key)).map(column => column.key), filters: filters() }) });
      if (!response.ok) { const error = await response.json(); throw new Error(error.message || '导出失败，请刷新后重试。'); }
      const url = URL.createObjectURL(await response.blob()), link = h('a', { href: url, download: exportMode === 'items' ? '报销项目及发票明细.xlsx' : '报销总表.xlsx' });
      if (disposed) { URL.revokeObjectURL(url); return; }
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      exportStatus.replaceChildren(notice('已按当前筛选条件导出。', { tone: 'success' }));
    } catch (error) { if (!disposed) exportStatus.replaceChildren(notice(error.message, { tone: 'error' })); }
    finally { busy = false; download.disabled = !enabled; }
  } });
  const exportPanel = h('section', { class: 'panel', hidden: true }, h('div', { class: 'panel__body stack-4' },
    h('h2', { class: 't-h3', text: '选择导出信息' }), mode, columns,
    h('p', { class: 't-caption', text: '身份证和银行卡字段不提供导出。明细按项目分行；申请金额和打款金额只在本申请首行列出，避免重复累计。发票识别结果需人工核对。' }), download, exportStatus));
  async function load() {
    const id = ++sequence;
    try {
      const payload = await api.ledger(filters()); if (disposed || id !== sequence) return;
      status.replaceChildren(); const t = payload.totals;
      totals.replaceChildren(...[['申请', `${t.count} 笔 · ${reimbursementAmount(t.amountCents)}`], ['待打款', `${t.waitingCount} 笔 · ${reimbursementAmount(t.waitingCents)}`],
        ['已登记打款', `${t.paidCount} 笔 · ${reimbursementAmount(t.paidCents)}`]].map(([label, value]) => h('div', {}, h('span', { class: 't-caption', text: label }), h('b', { text: value }))));
      rows.replaceChildren(h('div', { class: 'material-ledger-scroll', tabindex: 0, aria: { label: '报销台账，可横向滚动查看' } }, h('table', { class: 'material-ledger-table' },
        h('thead', {}, h('tr', {}, ...['申请编号', '申请人', '活动', '金额', '状态', '费用日期', '操作'].map(text => h('th', { scope: 'col', text })))),
        h('tbody', {}, ...payload.rows.map(item => h('tr', { data: { request: item.id } }, ...[item.code, item.applicant, item.activity, `¥${item.amount.toFixed(2)}`, item.status, item.expenseDate].map(text => h('td', { text })),
          h('td', {}, item.canRegisterPayment ? button({ label: '登记打款', size: 'sm', onClick: async () => {
            try { const result = await api.requestDetails(item.id); if (!disposed) openPaymentRegistration(result.request, { onDone: load }); }
            catch (error) { if (!disposed) status.replaceChildren(notice(error.message, { tone: 'error' })); }
          } }) : item.paidDate ? h('span', { class: 't-caption', text: item.paidDate }) : '')))))));
      if (!payload.rows.length) rows.append(h('p', { class: 't-secondary', text: '当前筛选没有申请。' }));
    } catch (error) { if (!disposed && id === sequence) status.replaceChildren(notice(error.message, { tone: 'error' })); }
  }
  for (const entry of [activity, state, from, to, search]) entry.control.addEventListener('change', load);
  const node = h('div', { class: 'view wspad wspad--wide' }, materialServices('finance', { console: true }),
    pageHead({ label: '财务报销', title: '报销台账与明细导出', description: '按活动、状态及费用日期查看申请与打款登记。',
      actions: [button({ label: '返回审核', variant: 'secondary', href: '/console/reimbursements' })] }),
    h('section', { class: 'panel material-ledger-panel' }, h('div', { class: 'panel__body stack-4' }, h('div', { class: 'formgrid' }, activity, state, from, to, search),
      button({ label: '刷新台账', onClick: load }), status, totals, rows)), exportPanel);
  let stop = () => {};
  try {
    const config = await api.config();
    if (!config.workflow?.ledger) { status.append(notice('报销台账暂不可用，请返回审核页面查看记录。', { tone: 'warning' })); }
    else {
      enabled = config.workflow.permissions.some(permission => ['final', 'view'].includes(permission)); exportPanel.hidden = !enabled;
      const data = await api.activities(); activity.control.replaceChildren(h('option', { value: '', text: '全部活动' }), ...data.activities.map(item => h('option', { value: item.id, text: item.name })));
      await load(); stop = watchMaterialChanges(load, { types: ['reimbursement-created'] });
    }
  } catch (error) { status.replaceChildren(notice(error.message, { tone: 'error' })); }
  return { title: '报销台账', node, dispose: () => { disposed = true; stop(); } };
}
