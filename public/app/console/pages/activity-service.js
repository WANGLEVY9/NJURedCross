import { h, clear } from '../../core/dom.js';
import { request, downloadFile } from '../../core/api.js';
import { notify, reportError } from '../../core/toast.js';
import { openDrawer } from '../../ui/overlay.js';
import { button, badge, field, notice, emptyState } from '../../ui/primitives.js';

const root = '/api/volunteer/workflow';
const statusName = row => ({ 待批准: '待审核', 已批准: '审核通过', 已入账: '已同步', 已退回: '已退回' }[row?.['状态']] || '待核验');
const tone = row => ['已批准', '已入账'].includes(row?.['状态']) ? 'success' : row?.['状态'] === '已退回' ? 'danger' : 'warning';

export function serviceWorkspace({ event, registrations, ledger, kind, actor, superAdmin, state, onSaved }) {
  state.drafts ||= new Map();
  state.selected ||= new Set();
  state.search ||= '';
  state.filter ||= 'all';
  state.sort ||= 'time';
  const isReview = kind === 'hours';
  const node = h('section', { class: 'service-workspace stack-4', 'aria-label': isReview ? '时长审核与导出' : '签到核验与时长录入' });
  const content = h('div', { class: 'service-content' });
  const feedback = h('div', { 'aria-live': 'polite' });
  let busy = false, review = null, selectedText, primary, selectAll, visible = [], focusRequested = false;
  node.focusWorkspace = () => {
    if (isReview && !review) { focusRequested = true; return; }
    node.scrollIntoView({ block: 'start' });
    focusRequested = false;
  };
  const ownLedger = registration => ledger.find(row => row['报名行ID'] === registration._id);
  let blood = false;
  try { blood = Boolean(JSON.parse(event['报名页配置'] || '{}').blood); } catch { /* Missing configuration is checked by the server. */ }
  function eligible(registration) {
    const entry = ownLedger(registration);
    return ['已确认', '已签到'].includes(registration['报名状态']) && registration['请假状态'] !== '待审批'
      && !['已批准', '已入账'].includes(entry?.['状态']) && (!blood || Boolean(registration['签到照片ID']));
  }
  function canApprove(entry) {
    return entry['状态'] === '待批准' && (superAdmin || (entry['核对人'] !== actor && entry['账号ID'] !== actor));
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
      ? `${result.succeeded} 人审核通过。已发起 Excel 下载；如未收到文件，可点击「下载已审 Excel」。`
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
    if (primary) { primary.disabled = busy || !state.selected.size; primary.textContent = busy ? '正在处理…' : isReview ? '审核通过并导出 Excel' : '确认签到并录入'; }
  }
  function checkbox(id, enabled) {
    const input = h('input', { type: 'checkbox', disabled: !enabled || busy, 'aria-label': '选择此记录', on: { change: () => {
      if (input.checked) state.selected.add(id); else state.selected.delete(id);
      input.closest('tr')?.classList.toggle('is-selected', input.checked); updateSelection();
    } } });
    input.checked = state.selected.has(id);
    return input;
  }
  function numberInput(registration, key, label, enabled) {
    const value = draft(registration);
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
    return (!query || text.includes(query)) && (state.filter === 'all' || statusName(entry) === state.filter);
  }
  function tableHead(columns) {
    selectAll = h('input', { type: 'checkbox', 'aria-label': '选择当前筛选结果', on: { change: () => {
      for (const item of visible.filter(row => row.enabled)) { if (selectAll.checked) state.selected.add(item.id); else state.selected.delete(item.id); }
      renderTable();
    } } });
    return h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, selectAll), ...columns.map(text => h('th', { scope: 'col', text }))));
  }
  function renderTable() {
    clear(content); visible = [];
    if (isReview && !review) { content.append(notice('正在加载时长审核表…', { tone: 'neutral' })); return; }
    const rows = sorted(registrations).filter(r => (isReview ? review.entries.some(l => l['报名行ID'] === r._id) : ['已确认', '已签到'].includes(r['报名状态']))
      && matches(r, isReview ? review.entries.find(l => l['报名行ID'] === r._id) : ownLedger(r)));
    // A batch always applies to visible results; filtering must not retain hidden selections.
    const currentIds = new Set(rows.flatMap(r => {
      const entry = isReview ? review.entries.find(l => l['报名行ID'] === r._id) : null;
      return (isReview ? canApprove(entry) : eligible(r)) ? [isReview ? entry._id : r._id] : [];
    }));
    for (const id of state.selected) if (!currentIds.has(id)) state.selected.delete(id);
    if (!rows.length) { content.append(emptyState({ title: isReview ? '暂无符合条件的时长明细' : '暂无符合条件的参与者', description: isReview ? '先在签到核验页确认到场并录入时长，或调整筛选条件。' : '名单确认后，参与者会显示在这里。' })); updateSelection(); return; }
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
        row.append(cell('审核状态', h('div', { class: 'stack-2' }, badge(statusName(entry), { tone: tone(entry) }), entry['退回原因'] ? h('small', { text: entry['退回原因'] }) : null)),
          cell('操作', enabled ? button({ label: '退回修改', variant: 'ghost', size: 'sm', onClick: () => returnEntry(entry) })
            : entry['状态'] === '待批准' ? h('span', { class: 't-caption', text: '由另一位审核人处理' }) : h('span', { text: '—' })));
      } else {
        const value = draft(registration);
        const evidence = registration['签到照片ID'] ? button({ label: '查看凭证', variant: 'secondary', size: 'sm', onClick: () => {
          openDrawer({ title: `${registration['姓名']} · 签到凭证`, body: [h('img', { class: 'service-evidence', src: `${root}/registrations/${registration._id}/photo`, alt: '现场签到照片', on: { error: e => { e.target.replaceWith(notice('凭证暂时无法加载，请刷新重试。', { tone: 'warning' })); } } })] });
        } }) : h('span', { class: 't-caption', text: blood ? '等待提交照片' : '现场人工核验' });
        row.append(cell('参与者', h('div', { class: 'stack-1' }, h('strong', { text: registration['姓名'] }), h('small', { text: registration['学号'] }))),
          cell('院系 / 岗位', h('div', { class: 'stack-1' }, h('span', { text: registration['院系'] || '未填写院系' }), h('small', { text: registration['岗位'] }))),
          cell('签到凭证', evidence), cell('服务 / 小时', numberInput(registration, 'serviceHours', '服务时长', enabled)),
          cell('培训 / 小时', numberInput(registration, 'trainingHours', '培训时长', enabled)), cell('交通 / 小时', numberInput(registration, 'travelHours', '交通时长', enabled)),
          cell('志愿者工作内容', h('textarea', { class: 'input service-work-input', rows: 2, maxlength: 500, disabled: !enabled || busy,
            'aria-label': `${registration['姓名']} 工作内容`, text: value.work, on: { input: e => { value.work = e.target.value; } } })),
          cell('录入状态', h('div', { class: 'stack-2' }, badge(statusName(entry), { tone: tone(entry) }), registration['请假状态'] === '待审批' ? h('small', { text: '请假待处理' }) : entry?.['退回原因'] ? h('small', { text: entry['退回原因'] }) : null)));
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
    if (busy || !state.selected.size) return;
    const selected = [...state.selected];
    const items = selected.map(id => isReview ? { id, expectedDigest: review.entries.find(row => row._id === id)['核对摘要'] }
      : { id, hours: Object.fromEntries(Object.entries(draft(registrations.find(row => row._id === id))).filter(([key]) => key !== 'version' && (key !== 'expectedDigest' || ownLedger(registrations.find(row => row._id === id))))) });
    if (items.length > 200) { notify.warning('每次最多处理 200 人，请减少所选记录。'); return; }
    busy = true; renderTable();
    try {
      const result = await request(`${root}/events/${event._id}/${isReview ? 'hours-approve' : 'attendance-batch'}`, { method: 'POST', body: { items } });
      state.result = result;
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
  const filter = field({ label: '处理状态', value: state.filter, options: [{ value: 'all', label: '全部状态' }, ...['待核验', '待审核', '已退回', '审核通过', '已同步'].map(label => ({ value: label, label }))], onInput: e => { state.filter = e.target.value; renderTable(); } });
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
    h('p', { class: 't-caption', text: isReview ? '核对下方十列明细，审核通过后自动下载 Excel，交由主任团录入第二课堂。' : '时长已按活动规则预填，可逐人调整。确认后交由审核人复核。' })),
    h('div', { class: 'row-2 row-wrap' }, expand,
      isReview ? button({ label: '下载已审 Excel', variant: 'secondary', disabled: !approved.length, onClick: async () => { try { await download(); } catch (error) { reportError(error, '暂不可下载'); } } }) : null)));
  node.append(h('p', { class: 'service-counts', text: isReview
    ? `待审核 ${pending} 人 · 已退回 ${ledger.filter(r => r['状态'] === '已退回').length} 人 · 已通过 ${approved.length} 人`
    : `待核验 ${registrations.filter(r => r['报名状态'] === '已确认').length} 人 · 已录入 ${ledger.length} 人 · 已退回 ${ledger.filter(r => r['状态'] === '已退回').length} 人` }));
  node.append(h('div', { class: 'service-tools' }, search, filter, sort), feedback,
    h('div', { class: 'service-batch-bar' }, h('div', { class: 'stack-1' }, selectedText, h('small', { text: '仅处理当前筛选结果，隐藏的记录会取消选择' })),
      h('div', { class: 'row-2 row-wrap' }, button({ label: '全选当前结果', variant: 'ghost', onClick: () => { if (busy) return; for (const item of visible.filter(row => row.enabled)) state.selected.add(item.id); renderTable(); } }),
        button({ label: '清空选择', variant: 'ghost', onClick: () => { state.selected.clear(); renderTable(); } }), primary)), content);
  if (isReview && approved.length) node.append(h('details', { class: 'service-extra' }, h('summary', { text: '其他操作：同步个人时长' }), button({ label: '同步已审时长到个人记录', variant: 'ghost', onClick: async () => {
    if (busy) return; busy = true; updateSelection();
    try { for (const entry of approved) await request(`${root}/hours/${entry._id}/post`, { method: 'POST', body: {} }); notify.success('已同步个人时长'); await onSaved(); }
    catch (error) { reportError(error, '部分记录尚未同步，请刷新后重试'); } finally { busy = false; updateSelection(); }
  } })));
  failurePanel(state.result);
  if (isReview) void loadReview(); else renderTable();
  return node;
}
