import { h, clear } from '../../core/dom.js';
import { request, downloadFile } from '../../core/api.js';
import { notify, reportError } from '../../core/toast.js';
import { openDrawer } from '../../ui/overlay.js';
import { button, badge, field, notice, emptyState } from '../../ui/primitives.js';
import { serviceStatus, matchesServiceFilter, attendanceBlockReason, reviewBlockReason } from './activity-service-state.js';

const root = '/api/volunteer/workflow';
const tone = row => ['已批准', '已入账'].includes(row?.['状态']) ? 'success' : row?.['状态'] === '已退回' ? 'danger' : 'warning';

export function serviceWorkspace({ event, registrations, ledger, kind, actor, superAdmin, state, onSaved, onNavigate }) {
  const isReview = kind === 'hours';
  state.drafts ||= new Map();
  state.selected ||= new Set();
  state.search ||= '';
  state.filter ||= isReview && !ledger.some(row => row['状态'] === '待批准') && ledger.some(row => ['已批准', '已入账'].includes(row['状态'])) ? 'approved' : 'todo';
  state.sort ||= 'time';
  const node = h('section', { class: 'service-workspace stack-4', 'aria-label': isReview ? '时长审核与导出' : '签到核验与时长录入' });
  const content = h('div', { class: 'service-content' });
  const feedback = h('div', { 'aria-live': 'polite' });
  let busy = false, review = null, selectedText, primary, selectAll, batchBar, selectionHint, selectVisible, clearSelection, visible = [], focusRequested = false;
  node.focusWorkspace = () => {
    if (isReview && !review) { focusRequested = true; return; }
    node.scrollIntoView({ block: 'start' });
    focusRequested = false;
  };
  const ownLedger = registration => ledger.find(row => row['报名行ID'] === registration._id);
  let blood = false;
  try { blood = Boolean(JSON.parse(event['报名页配置'] || '{}').blood); } catch { /* Missing configuration is checked by the server. */ }
  function eligible(registration) {
    return !attendanceBlockReason(registration, ownLedger(registration), blood);
  }
  function canApprove(entry) {
    return !reviewBlockReason(entry, actor, superAdmin);
  }
  function draft(registration) {
    const entry = ownLedger(registration), key = registration._id;
    const version = entry?.['核对摘要'] || entry?.['状态'] || '';
    if (!state.drafts.has(key) || state.drafts.get(key).version !== version) {
      state.drafts.set(key, { version, serviceHours: entry?.['服务时长'] ?? event['服务时长'], trainingHours: entry?.['培训时长'] ?? event['培训时长'],
        travelHours: entry?.['交通时长'] ?? event['交通时长'], work: entry?.['工作内容'] || event['工作内容'], expectedDigest: entry?.['核对摘要'] });
    }
    return state.drafts.get(key);
  }
  function failurePanel(result) {
    clear(feedback);
    if (result?.succeeded && !result.failed) feedback.append(notice(isReview
      ? `${result.succeeded} 人审核通过。已发起 Excel 下载；也可点击「导出已通过名单」再次下载。`
      : `${result.succeeded} 人已确认签到并录入时长，请到「时长审核与导出」复核。`, { tone: 'success' }));
    if (result?.failed) feedback.append(notice(`已完成 ${result.succeeded} 人，${result.failed} 人需要处理。`, { tone: 'warning' }),
      h('ul', { class: 'service-failures' }, ...result.results.filter(row => !row.ok).map(row => {
        const registration = registrations.find(r => r._id === row.id);
        const entry = ledger.find(l => l._id === row.id);
        return h('li', { text: `${registration?.['姓名'] || entry?.['姓名'] || '所选记录'}：${row.message}` });
      })));
  }
  function updateSelection() {
    const selectable = visible.filter(item => item.enabled);
    if (selectAll) {
      selectAll.checked = selectable.length > 0 && selectable.every(item => state.selected.has(item.id));
      selectAll.indeterminate = selectable.some(item => state.selected.has(item.id)) && !selectAll.checked;
      selectAll.disabled = busy || !selectable.length;
    }
    if (selectedText) selectedText.textContent = `已选 ${state.selected.size} 人`;
    if (batchBar) batchBar.hidden = !selectable.length;
    if (selectionHint) selectionHint.textContent = state.selected.size
      ? `将${isReview ? '审核' : '提交'}所选 ${state.selected.size} 人；切换筛选会取消隐藏记录的选择。`
      : `请先勾选名单左侧的方框，也可以全选当前可${isReview ? '审核' : '提交'}的 ${selectable.length} 人。`;
    if (selectVisible) { selectVisible.disabled = busy; selectVisible.textContent = `全选这 ${selectable.length} 人`; }
    if (clearSelection) { clearSelection.hidden = !state.selected.size; clearSelection.disabled = busy; }
    if (primary) { primary.disabled = busy; primary.textContent = busy ? '正在处理…' : isReview ? '审核通过并导出 Excel' : '确认签到并录入'; }
  }
  function checkbox(id, enabled) {
    if (!enabled) return h('span', { class: 't-caption', text: '—' });
    const input = h('input', { type: 'checkbox', disabled: !enabled || busy, 'aria-label': '选择此记录', on: { change: () => {
      if (input.checked) state.selected.add(id); else state.selected.delete(id);
      input.closest('tr')?.classList.toggle('is-selected', input.checked); updateSelection();
    } } });
    input.checked = state.selected.has(id);
    return input;
  }
  function numberInput(registration, key, label, enabled) {
    const value = draft(registration);
    if (!enabled) return h('span', { text: value[key] });
    return h('input', { class: 'input service-hour-input', type: 'number', min: key === 'serviceHours' ? '0.01' : '0', step: 'any',
      value: value[key], disabled: !enabled || busy, 'aria-label': `${registration['姓名']} ${label}`, on: { input: e => { value[key] = e.target.value; } } });
  }
  function cell(label, value, className = '') { return h('td', { 'data-label': label, class: className }, value); }
  function sorted(rows) {
    return [...rows].sort((a, b) => state.sort === 'name' ? a['姓名'].localeCompare(b['姓名'], 'zh-CN')
      : state.sort === 'id' ? a['学号'].localeCompare(b['学号']) : String(a['创建时间'] || '').localeCompare(String(b['创建时间'] || '')));
  }
  function matches(registration, entry) {
    const query = state.search.trim().toLowerCase();
    const text = `${registration['姓名']} ${registration['学号']} ${registration['院系'] || ''} ${registration['岗位'] || ''}`.toLowerCase();
    return (!query || text.includes(query)) && matchesServiceFilter(state.filter, entry, isReview);
  }
  function tableHead(columns) {
    if (!visible.some(row => row.enabled)) { selectAll = null; return h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: '—' }), ...columns.map(text => h('th', { scope: 'col', text })))); }
    selectAll = h('input', { type: 'checkbox', 'aria-label': '选择当前筛选结果', on: { change: () => {
      for (const item of visible.filter(row => row.enabled)) { if (selectAll.checked) state.selected.add(item.id); else state.selected.delete(item.id); }
      renderTable();
    } } });
    return h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, selectAll), ...columns.map(text => h('th', { scope: 'col', text }))));
  }
  function renderTable() {
    clear(content); visible = [];
    if (isReview && !review) { content.append(notice('正在加载时长审核表…', { tone: 'neutral' })); updateSelection(); return; }
    const rows = sorted(registrations).filter(r => (isReview ? review.entries.some(l => l['报名行ID'] === r._id) : ['已确认', '已签到'].includes(r['报名状态']))
      && matches(r, isReview ? review.entries.find(l => l['报名行ID'] === r._id) : ownLedger(r)));
    // A batch always applies to visible results; filtering must not retain hidden selections.
    const currentIds = new Set(rows.flatMap(r => {
      const entry = isReview ? review.entries.find(l => l['报名行ID'] === r._id) : null;
      return (isReview ? canApprove(entry) : eligible(r)) ? [isReview ? entry._id : r._id] : [];
    }));
    for (const id of state.selected) if (!currentIds.has(id)) state.selected.delete(id);
    if (!rows.length) { content.append(emptyState({ title: state.search ? '没有找到匹配的参与者' : isReview ? '当前没有待处理的审核记录' : '当前没有需要签到或修改的记录', description: state.search ? '清空搜索或调整查看范围。' : isReview ? '已通过的名单可直接导出；新时长请先在④录入。也可以切换查看范围。' : '已提交的记录请到⑤审核；也可以切换查看范围，查看已提交名单。' })); updateSelection(); return; }
    const columns = isReview ? [...review.columns, '审核状态', '操作'] : ['参与者', '院系 / 岗位', '签到凭证', '服务 / 小时', '培训 / 小时', '交通 / 小时', '志愿者工作内容', '录入状态'];
    const tbody = h('tbody');
    for (const registration of rows) {
      const entry = isReview ? review.entries.find(l => l['报名行ID'] === registration._id) : ownLedger(registration);
      const enabled = isReview ? canApprove(entry) : eligible(registration);
      const id = isReview ? entry._id : registration._id; visible.push({ id, enabled });
      const row = h('tr', { class: state.selected.has(id) ? 'is-selected' : '' }, cell('选择', checkbox(id, enabled), 'service-select-cell'));
      if (isReview) {
        const exportRow = review.rows.find(r => r['学号'] === registration['学号']);
        for (const column of review.columns) row.append(cell(column, h('span', { text: exportRow?.[column] ?? '' })));
        row.append(cell('审核状态', h('div', { class: 'stack-2' }, badge(serviceStatus(entry, true), { tone: tone(entry) }), entry['退回原因'] ? h('small', { text: entry['退回原因'] }) : null)),
          cell('操作', enabled ? button({ label: '退回修改', variant: 'ghost', size: 'sm', onClick: () => returnEntry(entry) })
            : h('span', { class: 't-caption', text: reviewBlockReason(entry, actor, superAdmin) })));
      } else {
        const value = draft(registration);
        const evidence = registration['签到照片ID'] ? button({ label: '查看凭证', variant: 'secondary', size: 'sm', onClick: () => {
          openDrawer({ title: `${registration['姓名']} · 签到凭证`, body: [h('img', { class: 'service-evidence', src: `${root}/registrations/${registration._id}/photo`, alt: '现场签到照片', on: { error: e => { e.target.replaceWith(notice('凭证暂时无法加载，请刷新重试。', { tone: 'warning' })); } } })] });
        } }) : h('span', { class: 't-caption', text: blood ? '等待提交照片' : '现场人工核验' });
        row.append(cell('参与者', h('div', { class: 'stack-1' }, h('strong', { text: registration['姓名'] }), h('small', { text: registration['学号'] }))),
          cell('院系 / 岗位', h('div', { class: 'stack-1' }, h('span', { text: registration['院系'] || '未填写院系' }), h('small', { text: registration['岗位'] }))),
          cell('签到凭证', evidence), cell('服务 / 小时', numberInput(registration, 'serviceHours', '服务时长', enabled)),
          cell('培训 / 小时', numberInput(registration, 'trainingHours', '培训时长', enabled)), cell('交通 / 小时', numberInput(registration, 'travelHours', '交通时长', enabled)),
          cell('志愿者工作内容', enabled ? h('textarea', { class: 'input service-work-input', rows: 2, maxlength: 500, disabled: busy,
            'aria-label': `${registration['姓名']} 工作内容`, text: value.work, on: { input: e => { value.work = e.target.value; } } }) : h('span', { text: value.work })),
          cell('录入状态', h('div', { class: 'stack-2' }, badge(serviceStatus(entry, false), { tone: tone(entry) }),
            !enabled ? h('small', { text: attendanceBlockReason(registration, entry, blood) }) : entry?.['退回原因'] ? h('small', { text: entry['退回原因'] }) : null)));
      }
      tbody.append(row);
    }
    content.append(h('div', { class: `service-table-scroll ${isReview ? 'service-table-scroll--review' : ''}`, tabindex: 0, 'aria-label': isReview ? '第二课堂时长明细表，可左右滚动' : '签到核验表，可左右滚动' },
      h('table', { class: 'service-table' }, h('caption', { class: 'sr-only', text: isReview ? '志愿时长录入表' : '签到及实际时长录入表' }), tableHead(columns), tbody)));
    updateSelection();
  }
  async function loadReview() {
    try { review = await request(`${root}/events/${event._id}/hours-review`); renderTable(); if (focusRequested) node.focusWorkspace(); }
    catch (error) { clear(content); content.append(notice(error.message || '审核表加载失败', { tone: 'warning' }), button({ label: '重新加载', onClick: loadReview })); }
  }
  async function save() {
    if (busy) return;
    if (!state.selected.size) { notify.warning('请先勾选名单', '勾选左侧方框，或点击“全选这几人”，再提交。'); selectAll?.focus(); return; }
    const selected = [...state.selected];
    const items = selected.map(id => isReview ? { id, expectedDigest: review.entries.find(row => row._id === id)['核对摘要'] }
      : { id, hours: Object.fromEntries(Object.entries(draft(registrations.find(row => row._id === id))).filter(([key]) => key !== 'version' && (key !== 'expectedDigest' || ownLedger(registrations.find(row => row._id === id))))) });
    if (items.length > 200) { notify.warning('每次最多处理 200 人，请减少所选记录。'); return; }
    busy = true; renderTable();
    try {
      const result = await request(`${root}/events/${event._id}/${isReview ? 'hours-approve' : 'attendance-batch'}`, { method: 'POST', body: { items } });
      state.result = result;
      if (isReview && result.succeeded && !result.failed) state.filter = 'approved';
      for (const row of result.results) if (row.ok) { state.selected.delete(row.id); state.drafts.delete(row.id); }
      failurePanel(result);
      if (result.succeeded) notify.success(isReview ? `${result.succeeded} 人时长审核通过` : `${result.succeeded} 人已确认签到并录入时长`);
      await onSaved();
      if (isReview && result.succeeded && !result.failed) {
        try { await download(); } catch (error) { notify.warning('审核已通过，Excel 下载未完成', '请点击下载按钮重试，无需重复审核。'); reportError(error, '下载未完成'); }
      }
    } catch (error) { reportError(error, '批量操作未完成'); }
    finally { busy = false; renderTable(); }
  }
  async function download() {
    await downloadFile(`${root}/events/${event._id}/hours-export`, `${event['活动名称']}-志愿时长录入表.xlsx`);
  }
  function returnEntry(entry) {
    const reason = field({ label: '修改说明', required: true, multiline: true, rows: 3, maxlength: 500 });
    let drawer, returning = false;
    const submit = button({ label: '确认退回', variant: 'primary', onClick: async () => {
      if (returning || !reason.control.reportValidity()) return;
      returning = true; submit.disabled = true;
      try { await request(`${root}/hours/${entry._id}/return`, { method: 'POST', body: { reason: reason.control.value, expectedDigest: entry['核对摘要'] } });
        drawer.close(); notify.success('已退回，请在签到核验页修改后重新提交'); await onSaved();
      } catch (error) { reportError(error, '退回未完成'); } finally { returning = false; submit.disabled = false; }
    } });
    drawer = openDrawer({ title: `退回修改 · ${entry['姓名']}`, body: [reason], footer: [submit] });
  }
  const search = h('input', { class: 'input service-search', type: 'search', value: state.search, placeholder: '搜索姓名、学号、院系或岗位', 'aria-label': '搜索参与者', on: { input: e => { state.search = e.target.value; renderTable(); } } });
  const filter = field({ label: '查看名单', value: state.filter, options: isReview
    ? [{ value: 'todo', label: '待审核' }, { value: 'approved', label: '已通过' }, { value: 'returned', label: '退回待改' }, { value: 'all', label: '全部名单' }]
    : [{ value: 'todo', label: '待处理（签到 / 修改）' }, { value: 'submitted', label: '已提交' }, { value: 'all', label: '全部名单' }], onInput: e => { state.filter = e.target.value; renderTable(); } });
  const sort = field({ label: '排列方式', value: state.sort, options: [{ value: 'time', label: '报名时间' }, { value: 'name', label: '姓名' }, { value: 'id', label: '学号' }], onInput: e => { state.sort = e.target.value; renderTable(); } });
  primary = button({ label: isReview ? '审核通过并导出 Excel' : '确认签到并录入', variant: 'primary', onClick: save });
  selectedText = h('strong', { text: '已选 0 人' });
  const expand = button({ label: state.expanded ? '显示活动列表' : '收起活动列表', variant: 'ghost', size: 'sm', onClick: () => {
    state.expanded = !state.expanded;
    node.closest('.activity-workspace')?.classList.toggle('is-service-focused', state.expanded);
    expand.textContent = state.expanded ? '显示活动列表' : '收起活动列表';
  } });
  const pending = ledger.filter(row => row['状态'] === '待批准').length;
  const approved = ledger.filter(row => ['已批准', '已入账'].includes(row['状态']));
  node.append(h('header', { class: 'service-heading' }, h('div', { class: 'stack-2' },
    h('h3', { class: 't-h3', text: isReview ? '⑤ 时长审核与导出' : '④ 签到核验' }),
    h('p', { class: 't-caption', text: isReview ? '核对表格 → 勾选名单 → 审核通过并自动下载 Excel，交主任团录入第二课堂。' : '确认到场 → 调整实际时长 → 勾选名单 → 确认签到并录入。提交后到⑤审核。' })),
    h('div', { class: 'row-2 row-wrap' }, expand,
      isReview && approved.length ? button({ label: `导出已通过名单（${approved.length} 人）`, variant: 'secondary', onClick: async () => { try { await download(); } catch (error) { reportError(error, '暂不可下载'); } } }) : null,
      !isReview && onNavigate ? button({ label: '去⑤审核时长 →', variant: 'secondary', onClick: () => onNavigate('hours') }) : null,
      isReview && onNavigate ? button({ label: '← 返回④签到录入', variant: 'ghost', size: 'sm', onClick: () => onNavigate('checkins') }) : null)));
  node.append(h('p', { class: 'service-counts', text: isReview
    ? `待审核 ${pending} 人 · 退回待改 ${ledger.filter(r => r['状态'] === '已退回').length} 人 · 已通过 ${approved.length} 人。导出包含全部已通过记录，按报名时间排列。`
    : `待处理 ${registrations.filter(r => ['已确认', '已签到'].includes(r['报名状态']) && matchesServiceFilter('todo', ownLedger(r), false)).length} 人 · 已提交 ${pending + approved.length} 人。退回的记录按修改说明调整后，再次提交。` }));
  selectionHint = h('small');
  selectVisible = button({ label: '全选当前名单', variant: 'secondary', onClick: () => { if (busy) return; for (const item of visible.filter(row => row.enabled)) state.selected.add(item.id); renderTable(); } });
  clearSelection = button({ label: '取消选择', variant: 'ghost', onClick: () => { state.selected.clear(); renderTable(); } });
  batchBar = h('div', { class: 'service-batch-bar' }, h('div', { class: 'stack-1' }, selectedText, selectionHint),
    h('div', { class: 'row-2 row-wrap' }, selectVisible, clearSelection, primary));
  node.append(h('div', { class: 'service-tools' }, search, filter, sort), feedback,
    batchBar, content);
  failurePanel(state.result);
  if (isReview) void loadReview(); else renderTable();
  return node;
}
