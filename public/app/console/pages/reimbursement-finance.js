import { h } from '../../core/dom.js';
import { button, field, notice, pageHead } from '../../ui/primitives.js';
import { openDrawer } from '../../ui/overlay.js';
import { materialServices } from '../../shared/material-services.js';
import { reimbursementsApi as api, reimbursementAmount } from '../../shared/reimbursements-api.js';
import { bundleDetails, requestInfo } from '../../shared/reimbursement-details.js';
import { watchMaterialChanges, announceMaterialChange } from '../../shared/materials-sync.js';
import { financeNavigation, financeRowKey, financeSelection, financeTable } from '../reimbursement-finance-nav.js';
import { fundingDialog, financePaymentDialog } from '../reimbursement-finance-dialogs.js';
import { openMaterialPreview } from '../../shared/material-preview.js';
import { financeActivityDialog } from '../reimbursement-finance-activity.js';
import { editFinanceRequest } from '../reimbursement-request-edit.js';
import { REIMBURSEMENT_ACTIVITY_CATEGORIES } from '../../shared/reimbursement-activities.js';

const sum = (rows, key = 'amountCents') => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
const cell = text => h('td', { text });
const stages = [['pending', '待初审'], ['final_pending', '待终审'], ['initial_returned', '退回初审'], ['returned', '待申请人补充'], ['approved', '待打款'], ['paid', '已打款']];

export default async function financePage({ view: initialView, workflow } = {}) {
  workflow ||= (await api.config()).workflow;
  const view = initialView || new URLSearchParams(location.search).get('view') || 'items';
  const active = ['items', 'activities', 'payments', 'records'].includes(view) ? view : 'items';
  const status = h('div', { aria: { live: 'polite' } }), content = h('div', { class: 'stack-4' });
  const totals = h('p', { class: 'finance-totals', aria: { live: 'polite' } }), actionSlot = h('div', { class: 'row-3 row-wrap finance-actions' });
  const category = field({ label: '活动类别', name: 'financeCategory', options: [{ value: '', label: '全部类别' }] });
  const activity = field({ label: '活动', name: 'financeActivity', searchable: true, options: [{ value: '', label: '全部活动' }] });
  const state = field({ label: '处理状态', name: 'financeState', options: [{ value: '', label: '全部状态' }, ...stages.map(([value, label]) => ({ value, label }))] });
  const search = field({ label: '搜索', name: 'financeSearch', placeholder: '活动、支出项目、申请人、编号', maxlength: 160 });
  const groupBy = field({ label: '分组方式', name: 'financeGroupBy', value: active === 'payments' ? 'person' : 'activity', options: [
    { value: 'activity', label: '活动类别 → 活动' }, { value: 'person', label: '活动 → 申请人' }, { value: 'owner', label: '申请人（跨活动汇总）' }, { value: 'flat', label: '平铺列表' }] });
  let payload = null, disposed = false, sequence = 0, picked = new Set(), shown = [], openedLink = false;
  const drawers = new Set();
  const reload = async () => {
    const run = ++sequence;
    try {
      const result = await api.finance(); if (disposed || run !== sequence) return;
      payload = result; status.replaceChildren();
      const keep = (entry, options) => { const value = entry.control.value; entry.control.replaceChildren(...options); entry.control.value = value; };
      keep(category, [h('option', { value: '', text: '全部类别' }), ...[...REIMBURSEMENT_ACTIVITY_CATEGORIES,
        ...(result.activities.some(a => !a.category || a.category === '未分类') ? ['未分类'] : [])].map(value => h('option', { value, text: value }))]);
      keep(activity, [h('option', { value: '', text: '全部活动' }), ...result.activities.map(a => h('option', { value: a.id, text: a.name }))]);
      const valid = new Set(result.items.map(financeRowKey)); picked = new Set([...picked].filter(key => valid.has(key))); render();
      const linked = new URLSearchParams(location.search).get('request');
      if (linked && !openedLink) { openedLink = true; await showRequest(linked); }
    } catch (error) { if (!disposed && run === sequence) status.replaceChildren(notice(error.message, { tone: 'error', title: '财务工作台暂不可用' })); }
  };
  async function changed() { picked.clear(); announceMaterialChange('reimbursement-created'); await reload(); }
  async function showRequest(id) {
    try {
      const { request } = await api.requestDetails(id); if (disposed) return;
      const details = bundleDetails(request.bundle, { request, originalsFirst: true, withPreview: true });
      const drawer = openDrawer({ title: `条目来源 · ${request.code}`, width: 1050, body: [requestInfo(request), details],
        footer: payload.permissions.edit && request.status === 'final_pending' ? [button({ label: '修改申请信息', variant: 'primary', onClick: () => {
          const editing = editFinanceRequest(request, { onDone: async () => { await drawer.close(); await changed(); } }); drawers.add(editing);
        } })] : [],
        onClose: () => { details.dispose?.(); drawers.delete(drawer); } }); drawers.add(drawer);
    } catch (error) { status.replaceChildren(notice(error.message, { tone: 'error' })); }
  }
  function filtered() {
    const needle = search.control.value.trim().toLocaleLowerCase();
    return payload.items.filter(row => (!category.control.value || row.activityCategory === category.control.value)
      && (!activity.control.value || row.activityId === activity.control.value) && (!state.control.value || row.status === state.control.value)
      && (!needle || [row.activity, row.activityCategory, row.label, row.applicant, row.code].some(value => value.toLocaleLowerCase().includes(needle))));
  }
  function pickBox(rows, label) {
    const eligible = rows.filter(row => active === 'payments' ? row.canPay && payload.permissions.pay : row.canMove && payload.permissions.edit);
    const checked = eligible.length > 0 && eligible.every(row => picked.has(financeRowKey(row)));
    const input = h('input', { type: 'checkbox', checked: checked || undefined, disabled: !eligible.length || undefined, aria: { label },
      on: { change: event => { eligible.forEach(row => event.target.checked ? picked.add(financeRowKey(row)) : picked.delete(financeRowKey(row))); render(); } } });
    input.indeterminate = !checked && eligible.some(row => picked.has(financeRowKey(row))); return input;
  }
  function moveSelected() {
    const entries = shown.filter(row => picked.has(financeRowKey(row)) && row.canMove);
    const target = field({ name: 'financeMoveActivity', label: '调整到活动', searchable: true, options: [{ value: '', label: '请选择活动' }, ...payload.activities.map(a => ({ value: a.id, label: `${a.category || '未分类'} · ${a.name}` }))] });
    const feedback = h('div', { aria: { live: 'polite' } });
    const save = button({ label: '保存活动归属', variant: 'primary', onClick: async () => {
      if (save.disabled) return; save.disabled = true;
      try { await api.moveItems({ selections: entries.map(financeSelection), activityId: target.control.value }); await drawer.close(); await changed(); }
      catch (error) { feedback.replaceChildren(notice(error.message, { tone: 'error' })); } finally { save.disabled = false; }
    } });
    const drawer = openDrawer({ title: '调整报销活动归属', width: 640, body: [h('div', { class: 'stack-4' },
      h('p', { text: `已选择 ${entries.length} 项支出。关联材料随条目整理，原申请人与原始活动记录保留。调整后需重新生成终审材料。` }), target, feedback)], footer: [save] });
  }
  function renderItems() {
    shown = filtered().filter(row => active !== 'payments' || row.status === 'approved');
    shown.sort((a, b) => (groupBy.control.value === 'owner' ? a.applicant.localeCompare(b.applicant, 'zh-CN') || a.owner.localeCompare(b.owner) : 0)
      || a.activityCategory.localeCompare(b.activityCategory, 'zh-CN') || a.activity.localeCompare(b.activity, 'zh-CN')
      || (active === 'payments' || groupBy.control.value === 'person' ? a.applicant.localeCompare(b.applicant, 'zh-CN') || a.owner.localeCompare(b.owner) : 0) || a.code.localeCompare(b.code));
    const selected = shown.filter(row => picked.has(financeRowKey(row)));
    totals.textContent = active === 'payments' ? `${shown.length} 项待打款 · 核定 ${reimbursementAmount(sum(shown, 'approvedCents'))} · 实际应付 ${reimbursementAmount(sum(shown, 'payableCents'))}`
      : `${shown.length} 项支出 · 申请合计 ${reimbursementAmount(sum(shown))} · 已登记打款 ${reimbursementAmount(sum(shown, 'paidCents'))}`;
    const selectAll = h('label', { class: 'row-2' }, pickBox(shown, '全选当前筛选可操作条目'), h('span', { text: '全选当前筛选' }));
    actionSlot.replaceChildren(selectAll, h('span', { text: `已选 ${selected.length} 项 · ${reimbursementAmount(sum(selected, active === 'payments' ? 'payableCents' : 'amountCents'))}` }));
    const action = button({ label: active === 'payments' ? '批量登记打款' : '调整所属活动', variant: 'primary', onClick: () => active === 'payments'
      ? financePaymentDialog(selected, payload.operator, { onDone: changed }) : moveSelected() });
    action.disabled = !selected.length || (active === 'payments' ? !payload.permissions.pay : !payload.permissions.edit); actionSlot.append(action);
    if (active === 'payments') actionSlot.append(h('span', { class: 't-caption', text: '先在报销单记录中登记经费到账，再确认打款。' }));
    const groups = new Map();
    for (const row of shown) {
      const key = groupBy.control.value === 'flat' ? '' : groupBy.control.value === 'owner' ? JSON.stringify([row.owner])
        : JSON.stringify([row.activityCategory, row.activityId, ...(groupBy.control.value === 'person' ? [row.owner] : [])]);
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row);
    }
    const labels = active === 'payments' ? ['', '活动', '支出项目', '申请人', '原申请金额', '核定金额', '实际应付', '状态', '操作']
      : ['', '活动名称', '支出项目', '申请金额', '活动类别', '状态', '申请人', '活动日期', '操作'];
    const body = [];
    for (const [key, rows] of groups) {
      if (key) body.push(h('tr', { class: 'finance-table__group' }, h('th', { colspan: labels.length, scope: 'rowgroup' }, h('div', { class: 'row-3 row-wrap' },
        pickBox(rows, `全选${groupBy.control.value === 'owner' ? rows[0].applicant : rows[0].activity}${groupBy.control.value === 'person' ? rows[0].applicant : ''}`),
        h('span', { text: groupBy.control.value === 'owner' ? `${rows[0].applicant} / 跨活动汇总`
          : `${rows[0].activityCategory} / ${rows[0].activity}${groupBy.control.value === 'person' ? ` / ${rows[0].applicant}` : ''}` }),
        h('span', { class: 't-caption', text: `${rows.length} 项 · ${reimbursementAmount(sum(rows, active === 'payments' ? 'payableCents' : 'amountCents'))}` })))));
      for (const row of rows) {
        const archive = payload.batches.find(batch => batch.id === row.summaryId);
        const operations = [button({ label: '查看材料', variant: 'ghost', size: 'sm', onClick: () => archive
          ? openMaterialPreview({ name: `${archive.code}.pdf`, url: archive.packetUrl }, { title: `${row.label} · 终审归档材料` }) : showRequest(row.requestId) })];
        if (active !== 'payments' && row.canSummarize && payload.permissions.edit) operations.push(button({ label: '修改信息', variant: 'ghost', size: 'sm', onClick: async () => {
          try { const { request } = await api.requestDetails(row.requestId); if (disposed) return;
            const editing = editFinanceRequest(request, { onDone: changed }); drawers.add(editing);
          } catch (error) { status.replaceChildren(notice(error.message, { tone: 'error' })); }
        } }));
        if (active === 'payments' && row.canPay && payload.permissions.pay) operations.push(button({ label: '登记打款', size: 'sm', onClick: () => financePaymentDialog([row], payload.operator, { onDone: changed }) }));
        else if (active === 'payments' && archive && payload.permissions.pay) operations.push(button({ label: '到账登记', size: 'sm', variant: 'ghost', onClick: () => fundingDialog(archive, { onDone: changed }) }));
        else if (row.canSummarize && payload.permissions.edit) operations.push(button({ label: '活动终审', size: 'sm', variant: 'ghost', href: `/console/reimbursements/summary?activity=${encodeURIComponent(row.activityId)}` }));
        const values = active === 'payments' ? [row.activity, row.label, row.applicant, reimbursementAmount(row.amountCents), reimbursementAmount(row.approvedCents), reimbursementAmount(row.payableCents), row.statusLabel]
          : [row.activity, row.label, reimbursementAmount(row.amountCents), row.activityCategory, row.statusLabel, row.applicant, row.expenseDate || '—'];
        body.push(h('tr', { data: { financeItem: row.itemId, financeRequest: row.requestId } }, h('td', {}, pickBox([row], `选择${row.label}`)),
          ...values.map((value, index) => index === (active === 'payments' ? 6 : 4) ? h('td', {}, h('span', { class: `finance-status is-${row.status}`, text: value })) : cell(value)),
          h('td', {}, h('div', { class: 'row-2' }, ...operations))));
      }
    }
    content.replaceChildren(financeTable(labels, body));
    if (!shown.length) content.append(h('p', { class: 't-secondary', text: '当前筛选没有条目。' }));
  }
  function renderActivities(records = false) {
    actionSlot.replaceChildren(); const items = filtered();
    if (!records && payload.permissions.edit) actionSlot.append(button({ label: '新建报销活动', variant: 'secondary', onClick: () => financeActivityDialog(null, { onDone: changed }) }));
    const groups = new Map(); items.forEach(row => { if (!groups.has(row.activityId)) groups.set(row.activityId, []); groups.get(row.activityId).push(row); });
    if (!records && !state.control.value) for (const a of payload.activities) {
      const needle = search.control.value.trim().toLocaleLowerCase();
      if (!a.catalogSource && !groups.has(a.id) && (!category.control.value || (a.category || '未分类') === category.control.value)
        && (!activity.control.value || a.id === activity.control.value) && (!needle || `${a.name} ${a.category || ''}`.toLocaleLowerCase().includes(needle))) groups.set(a.id, []);
    }
    const labels = records ? ['活动名称', '活动类别', '条目数', '申请总额', '进程', '材料提交', '经费到账', '打款进度', '报销单记录']
      : ['活动名称', '活动类别', '活动日期', '条目数', '申请总额', '待初审', '待终审', '操作'];
    totals.textContent = `${groups.size} 个活动 · ${items.length} 项支出 · 申请合计 ${reimbursementAmount(sum(items))}`;
    content.replaceChildren(financeTable(labels, [...groups].map(([id, rows]) => {
      const a = payload.activities.find(entry => entry.id === id), batches = payload.batches.filter(b => b.activity.id === id);
      const counts = stages.map(([key, label]) => { const n = rows.filter(r => r.status === key).length; return n ? `${label} ${n}` : ''; }).filter(Boolean).join(' · ');
      if (!records) return h('tr', {}, cell(a?.name || rows[0]?.activity || '未关联活动'), cell(a?.category || '未分类'), cell(a?.date || '—'), cell(rows.length), cell(reimbursementAmount(sum(rows))),
        cell(rows.filter(r => ['pending', 'initial_returned', 'returned'].includes(r.status)).length), cell(rows.filter(r => r.canSummarize).length),
        h('td', {}, h('div', { class: 'row-2' }, button({ label: '进入活动终审', variant: 'secondary', size: 'sm', href: `/console/reimbursements/summary?activity=${encodeURIComponent(id)}` }),
          payload.permissions.edit && a ? button({ label: '编辑活动', variant: 'ghost', size: 'sm', onClick: () => financeActivityDialog(a, { onDone: changed }) }) : null)));
      const approved = batches.filter(b => b.status === 'approved');
      const batchList = h('details', {}, h('summary', { text: `${batches.length} 份材料记录` }), h('div', { class: 'stack-3 finance-batch-list' }, ...batches.map(batch => {
        const controls = [button({ label: '查看材料', size: 'sm', variant: 'ghost', onClick: () => openMaterialPreview({ name: `${batch.code}.pdf`, url: batch.packetUrl }, { title: `${batch.activity.name} · ${batch.code}` }) }),
          button({ label: '下载报销表', size: 'sm', variant: 'ghost', href: batch.formUrl }), button({ label: '下载材料包', size: 'sm', variant: 'ghost', href: batch.packetUrl })];
        if (batch.status === 'draft' && payload.permissions.edit) controls.unshift(button({ label: '继续终审', size: 'sm', href: `/console/reimbursements/summary?activity=${encodeURIComponent(id)}&summary=${encodeURIComponent(batch.id)}` }));
        if (batch.status === 'approved' && payload.permissions.pay) controls.unshift(button({ label: '材料／到账登记', size: 'sm', onClick: () => fundingDialog(batch, { onDone: changed }) }));
        return h('div', { class: 'stack-2' }, h('b', { text: `${batch.code} · ${reimbursementAmount(batch.totalCents)} · ${batch.status === 'approved' ? '终审通过' : batch.status === 'returned' ? '已退回' : '待终审草稿'}` }),
          h('p', { class: 't-caption', text: `材料提交：${batch.funding?.submittedDate || '待登记'} · 到账：${batch.funding?.receivedDate || '待登记'}${batch.funding?.receivedDate ? ` / ${reimbursementAmount(batch.funding.receivedCents)}` : ''}` }), h('div', { class: 'row-2 row-wrap' }, ...controls));
      })));
      return h('tr', {}, cell(a?.name || rows[0].activity), cell(a?.category || '未分类'), cell(rows.length), cell(reimbursementAmount(sum(rows))), cell(counts),
        cell(approved.length ? `${approved.filter(b => b.funding?.submittedDate).length}/${approved.length} 批已登记` : '尚未终审'),
        cell(reimbursementAmount(approved.reduce((s, b) => s + (b.funding?.receivedCents || 0), 0))),
        cell(`${rows.filter(r => r.status === 'paid').length}/${rows.length} 项 · ${reimbursementAmount(sum(rows, 'paidCents'))}`), h('td', {}, batchList));
    })));
    if (!groups.size) content.append(h('p', { text: '暂无报销活动记录；申请提交后自动出现。', class: 't-secondary' }));
  }
  function render() { if (!payload) return; active === 'activities' || active === 'records' ? renderActivities(active === 'records') : renderItems(); }
  for (const entry of [category, activity, state, groupBy]) entry.control.addEventListener('change', () => { picked.clear(); render(); });
  search.control.addEventListener('input', () => { picked.clear(); render(); });
  groupBy.hidden = active === 'activities' || active === 'records';
  const node = h('div', { class: 'view wspad wspad--wide finance-workspace' }, materialServices('finance', { console: true }),
    pageHead({ label: '财务报销', title: '终审财务工作台', description: '按活动查看支出条目，整理报销材料并跟进到账与打款。', actions: [workflow?.permissions?.includes('initial') ? button({ label: '初审材料审核', variant: 'secondary', href: '/console/reimbursements?view=initial' }) : null, button({ label: 'Excel 总表与明细导出', variant: 'secondary', href: '/console/reimbursements/ledger' })] }),
    financeNavigation(active), h('section', { class: 'panel' }, h('div', { class: 'panel__body stack-4' },
      h('div', { class: 'finance-filters' }, category, activity, state, search, groupBy),
      h('div', { class: 'row-3 row-wrap' }, totals, button({ label: '刷新', variant: 'ghost', onClick: reload })), status, actionSlot, content)));
  const stop = watchMaterialChanges(reload, { types: ['reimbursement-created'] });
  const timer = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 30000);
  await reload();
  return { title: '终审财务工作台', crumb: '终审财务工作台', node,
    dispose() { disposed = true; sequence++; stop(); clearInterval(timer); drawers.forEach(drawer => drawer.close()); } };
}
