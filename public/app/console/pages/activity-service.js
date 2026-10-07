import { h, clear } from '../../core/dom.js';
import { request, downloadFile } from '../../core/api.js';
import { notify, reportError } from '../../core/toast.js';
import { openDrawer } from '../../ui/overlay.js';
import { button, badge, field, notice, emptyState, definitionList } from '../../ui/primitives.js';
import { serviceStatus, matchesServiceFilter, attendanceBlockReason, reviewBlockReason } from './activity-service-state.js';

const root = '/api/volunteer/workflow';
const tone = row => ['已批准', '已入账'].includes(row?.['状态']) ? 'success' : row?.['状态'] === '已退回' ? 'danger' : 'warning';

export function serviceWorkspace({ event, registrations, ledger, kind, actor, superAdmin, state, onSaved, onNavigate }) {
  const isReview = kind === 'hours';
  state.drafts ||= new Map();
  state.selected ||= new Set();
  state.search ||= '';
  state.membership ||= '';
  state.center ||= '';
  let members = new Map();
  state.filter ||= isReview && !ledger.some(row => row['状态'] === '待批准') && ledger.some(row => ['已批准', '已入账'].includes(row['状态'])) ? 'approved' : 'todo';
  state.sort ||= 'time';
  const node = h('section', { class: 'service-workspace stack-4', 'aria-label': isReview ? '时长审核与导出' : '签到核验与时长录入' });
  const content = h('div', { class: 'service-content' });
  const feedback = h('div', { 'aria-live': 'polite' });
  const memberFeedback = h('div', { 'aria-live': 'polite' });
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
    const member = members.get(registration._id);
    const text = `${registration['姓名']} ${registration['学号']} ${registration['院系'] || ''} ${registration['岗位'] || ''} ${member?.department || ''}`.toLowerCase();
    return (!query || text.includes(query)) && (!state.membership || (member?.membership || 'unknown') === state.membership)
      && (!state.center || member?.center === state.center)
      && matchesServiceFilter(state.filter, entry, isReview);
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
    if (!rows.length) { content.append(emptyState({ title: state.search || state.membership || state.center ? '没有找到匹配的参与者' : isReview ? '当前没有待处理的审核记录' : '当前没有需要核验或修改的记录', description: state.search || state.membership || state.center ? '清空搜索或调整红会身份、中心和状态筛选。' : isReview ? '已通过的名单可直接导出；新时长请先在④录入。也可以切换查看范围。' : '已提交的记录请到⑤审核；也可以切换查看范围，查看已提交名单。' })); updateSelection(); return; }
    const columns = isReview ? [...review.columns, '审核状态', '操作'] : ['参与者', '红会身份 / 中心', '签到依据', '服务 / 小时', '培训 / 小时', '交通 / 小时', '志愿者工作内容', '处理状态'];
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
        const member = members.get(registration._id);
        const evidence = h('div', { class: 'stack-1' }, h('small', { text: registration['签到照片ID'] ? '已提交照片' : blood ? '尚未提交照片' : '请核对记录或现场到场情况' }),
          button({ label: '查看签到详情', variant: 'secondary', size: 'sm', onClick: () => showAttendance(registration) }));
        row.append(cell('参与者', h('div', { class: 'stack-1' }, h('strong', { text: registration['姓名'] }), h('small', { text: registration['学号'] }))),
          cell('红会身份 / 中心', h('div', { class: 'stack-1' }, h('span', { text: member?.membership === 'member' ? '红会成员' : member?.membership === 'volunteer' ? '普通志愿者' : '身份待确认' }), h('small', { text: member?.department || '部门未确认' }))),
          cell('签到依据', evidence), cell('服务 / 小时', numberInput(registration, 'serviceHours', '服务时长', enabled)),
          cell('培训 / 小时', numberInput(registration, 'trainingHours', '培训时长', enabled)), cell('交通 / 小时', numberInput(registration, 'travelHours', '交通时长', enabled)),
          cell('志愿者工作内容', enabled ? h('textarea', { class: 'input service-work-input', rows: 2, maxlength: 500, disabled: busy,
            'aria-label': `${registration['姓名']} 工作内容`, text: value.work, on: { input: e => { value.work = e.target.value; } } }) : h('span', { text: value.work })),
          cell('处理状态', h('div', { class: 'stack-2' }, badge(serviceStatus(entry, false, registration, blood), { tone: tone(entry) }),
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
  async function showAttendance(registration) {
    const drawer = openDrawer({ title: `${registration['姓名']} · 签到详情`, width: 640, body: notice('正在读取签到记录…', { tone: 'neutral' }) });
    try {
      const detail = await request(`${root}/registrations/${registration._id}/attendance-detail`);
      const member = members.get(registration._id);
      const time = value => value ? new Date(value).toString() === 'Invalid Date' ? value : new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未记录';
      const items = [definitionList([['学号', detail.studentId], ['部门', member?.department || '待确认'], ['急救证', member?.certificate || '未记录'], ['院系 / 岗位', `${registration['院系'] || '未填写'} / ${registration['岗位'] || '未填写'}`], ['凭证提交时间', time(detail.submittedAt)],
        ['管理员核验', detail.verified ? `${detail.verified.by} · ${time(detail.verified.at)}` : '尚未核验'], ['核验说明', detail.verified?.note || '暂无']])];
      if (detail.hasPhoto) items.push(h('h3', { text: '本次提交的签到照片' }), h('img', { class: 'service-evidence', src: `${root}/registrations/${registration._id}/photo`, alt: '本次活动签到凭证', on: { error: e => e.target.replaceWith(notice('照片暂时无法加载，请刷新重试。', { tone: 'warning' })) } }));
      items.push(h('h3', { text: '旧签到表关联记录' }));
      if (!detail.legacy.length) items.push(h('p', { class: 't-caption', text: '未找到可唯一关联的旧表签到记录；这不代表同学一定未到场。' }));
      for (const record of detail.legacy) items.push(definitionList([['活动时间', time(record.time)], ['提交时间', time(record.submittedAt)], ['备注', record.note || '无'], ['原表核对状态', record.status || '未记录']]),
        ...record.photos.map((url, index) => h('a', { class: 'btn btn--secondary', text: `打开原表照片 ${index + 1}`, href: url, target: '_blank', rel: 'noopener noreferrer', data: { native: true } })));
      for (const warning of detail.warnings) items.push(notice(warning, { tone: 'warning' }));
      items.push(h('p', { class: 't-caption', text: '查看记录不会确认签到。核对到场情况及实际时长后，返回名单勾选并点击“确认签到并录入”。原表照片可能需要登录 NJUTable。' }));
      drawer.setBody(h('div', { class: 'stack-4' }, ...items));
    } catch (error) { drawer.setBody(notice(error.message || '签到记录加载失败，请关闭后重试。', { tone: 'warning' })); }
  }
  async function loadMembers() {
    try {
      const result = await request(`${root}/events/${event._id}/members`);
      members = new Map(result.people.map(person => [person.id, person]));
      clear(memberFeedback);
      if (result.warning) memberFeedback.append(notice(result.warning, { tone: 'warning' }));
      renderTable();
    } catch {
      clear(memberFeedback); memberFeedback.append(notice('成员资料暂时无法读取，身份显示待确认。', { tone: 'warning' }), button({ label: '重试成员资料', onClick: loadMembers }));
    }
  }
  async function previewTable() {
    const body = h('div', { class: 'stack-4' });
    const drawer = openDrawer({ title: '志愿时长录入表 · 在线预览', description: event['活动名称'], body, width: 1440 });
    body.append(notice('正在加载明细…', { tone: 'neutral' }));
    try {
      // Both endpoints are read-only. The export preview uses the same draft as the XLSX download.
      const current = await request(`${root}/events/${event._id}/hours-review`);
      const exported = current.entries.some(entry => ['已批准', '已入账'].includes(entry['状态']))
        ? await request(`${root}/events/${event._id}/export-preview`) : { rows: [] };
      const matched = sorted(registrations).filter(r => current.entries.some(entry => entry['报名行ID'] === r._id)
        && matches(r, current.entries.find(entry => entry['报名行ID'] === r._id)));
      const filtered = matched.map(r => current.rows.find(row => row['学号'] === r['学号'])).filter(Boolean);
      let scope = 'current';
      const tableArea = h('div');
      function renderPreview() {
        clear(tableArea);
        const rows = scope === 'export' ? exported.rows : filtered;
        tableArea.append(h('p', { class: 't-caption', text: scope === 'export'
          ? `共 ${rows.length} 人，与实际导出的 Excel 数据及顺序一致，包含全部已通过记录。`
          : `共 ${rows.length} 人，沿用页面当前的搜索、筛选和排序；未通过审核的记录不会导出。` }));
        if (!rows.length) { tableArea.append(notice('此范围暂无记录，请切换预览范围或返回调整筛选。', { tone: 'neutral' })); return; }
        tableArea.append(h('div', { class: 'service-sheet-scroll', tabindex: 0, 'aria-label': '在线预览明细，可上下左右滚动' },
          h('table', { class: 'service-sheet' }, h('caption', { class: 'sr-only', text: '志愿时长录入表，十列明细' }),
            h('thead', {}, h('tr', {}, ...current.columns.map(text => h('th', { scope: 'col', text })))),
            h('tbody', {}, ...rows.map(row => h('tr', {}, ...current.columns.map(column => h('td', { text: row[column] ?? '' }))))))));
      }
      clear(body);
      body.append(field({ label: '预览范围', value: scope, options: [
        { value: 'current', label: '当前筛选名单（审核前可看）' }, { value: 'export', label: '已通过名单（实际导出内容）' },
      ], onInput: e => { scope = e.target.value; renderPreview(); } }), tableArea);
      renderPreview();
    } catch (error) {
      drawer.setBody(notice(error.message || '预览加载失败，请关闭后重试。', { tone: 'warning' }));
    }
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
  const search = h('input', { class: 'input service-search', type: 'search', value: state.search, placeholder: '搜索姓名、学号或岗位', 'aria-label': '搜索参与者', on: { input: e => { state.search = e.target.value; renderTable(); } } });
  const filter = field({ label: '状态筛选', value: state.filter, options: isReview
    ? [{ value: 'todo', label: '待审核' }, { value: 'approved', label: '已通过' }, { value: 'returned', label: '退回待改' }, { value: 'all', label: '全部名单' }]
    : [{ value: 'todo', label: '待处理（核验 / 修改）' }, { value: 'submitted', label: '已提交' }, { value: 'all', label: '全部名单' }], onInput: e => { state.filter = e.target.value; renderTable(); } });
  const sort = field({ label: '排列方式', value: state.sort, options: [{ value: 'time', label: '报名时间' }, { value: 'name', label: '姓名' }, { value: 'id', label: '学号' }], onInput: e => { state.sort = e.target.value; renderTable(); } });
  const membership = field({ label: '红会身份', value: state.membership, options: [{ value: '', label: '全部身份' }, { value: 'member', label: '红会成员' }, { value: 'volunteer', label: '普通志愿者' }, { value: 'unknown', label: '待确认' }], onInput: e => { state.membership = e.target.value; renderTable(); } });
  const center = field({ label: '所属中心', value: state.center, options: [{ value: '', label: '全部中心' }, ...['博爱中心', '生命中心', '综事中心', '苏州', '主席团 / 指导组', '工作组'].map(value => ({ value, label: value }))], onInput: e => { state.center = e.target.value; renderTable(); } });
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
    h('p', { class: 't-caption', text: isReview ? '核对表格 → 勾选名单 → 审核通过并自动下载 Excel，交主任团录入第二课堂。' : '查看签到依据，核对到场情况和时长；勾选后一次确认签到并录入，提交到⑤审核。' })),
    h('div', { class: 'row-2 row-wrap' }, expand,
      isReview ? button({ label: '在线预览表', variant: 'secondary', onClick: previewTable }) : null,
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
  node.append(h('div', { class: 'service-tools' }, search, filter, membership, center, sort), memberFeedback, feedback,
    batchBar, content);
  failurePanel(state.result);
  if (isReview) void loadReview(); else renderTable();
  void loadMembers();
  return node;
}
