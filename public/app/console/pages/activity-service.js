import { h, clear } from '../../core/dom.js';
import { request } from '../../core/api.js';
import { notify, reportError } from '../../core/toast.js';
import { openDrawer } from '../../ui/overlay.js';
import { button, badge, field, notice, emptyState, definitionList } from '../../ui/primitives.js';
import { serviceStatus, matchesServiceFilter, attendanceBlockReason } from './activity-service-state.js';
import { hoursWorkspace } from './hours-workspace.js';
import { hoursFields, entryValues } from './hours-fields.js';

const root = '/api/volunteer/workflow';
const tone = row => ['已批准', '已入账'].includes(row?.['状态']) ? 'success' : row?.['状态'] === '已退回' ? 'danger' : 'warning';

export function serviceWorkspace({ event, registrations, ledger, kind, actor, superAdmin, state, onSaved, onNavigate }) {
  if (kind === 'hours') return hoursWorkspace({ event, actor, superAdmin, state, onSaved, onNavigate });
  state.drafts ||= new Map();
  state.selected ||= new Set();
  state.search ||= '';
  state.membership ||= '';
  state.center ||= '';
  let members = new Map();
  state.filter ||= 'todo';
  state.sort ||= 'time';
  const node = h('section', { class: 'service-workspace stack-4', 'aria-label': '签到核验与时长录入' });
  const content = h('div', { class: 'service-content' });
  const feedback = h('div', { 'aria-live': 'polite' });
  const memberFeedback = h('div', { 'aria-live': 'polite' });
  let busy = false, selectedText, primary, selectAll, batchBar, selectionHint, selectVisible, clearSelection, visible = [];
  node.focusWorkspace = () => node.scrollIntoView({ block: 'start' });
  const ownLedger = registration => ledger.find(row => row['报名行ID'] === registration._id);
  let blood = false;
  try { blood = Boolean(JSON.parse(event['报名页配置'] || '{}').blood); } catch { /* Missing configuration is checked by the server. */ }
  function eligible(registration) {
    return !attendanceBlockReason(registration, ownLedger(registration), blood);
  }
  function draft(registration) {
    const entry = ownLedger(registration), key = registration._id;
    const version = entry?.['核对摘要'] || entry?.['状态'] || '';
    if (!state.drafts.has(key) || state.drafts.get(key).version !== version) {
      state.drafts.set(key, { version, ...entryValues(entry, registration, event), expectedDigest: entry?.['核对摘要'] });
    }
    return state.drafts.get(key);
  }
  function failurePanel(result) {
    clear(feedback);
    if (result?.succeeded && !result.failed) feedback.append(notice(`${result.succeeded} 人已确认签到并录入时长，请到⑤复核。`, { tone: 'success' }));
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
      ? `将提交所选 ${state.selected.size} 人；切换筛选会取消隐藏记录的选择。`
      : `请先勾选名单左侧的方框，也可以全选当前可提交的 ${selectable.length} 人。`;
    if (selectVisible) { selectVisible.disabled = busy; selectVisible.textContent = `全选这 ${selectable.length} 人`; }
    if (clearSelection) { clearSelection.hidden = !state.selected.size; clearSelection.disabled = busy; }
    if (primary) { primary.disabled = busy; primary.textContent = busy ? '正在处理…' : '确认签到并录入'; }
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
    return h('input', { class: 'input service-hour-input', type: 'number', min: '0', step: 'any',
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
      && matchesServiceFilter(state.filter, entry, false);
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
    const rows = sorted(registrations).filter(r => ['已确认', '已签到'].includes(r['报名状态']) && matches(r, ownLedger(r)));
    const currentIds = new Set(rows.filter(eligible).map(r => r._id));
    for (const id of state.selected) if (!currentIds.has(id)) state.selected.delete(id);
    if (!rows.length) { content.append(emptyState({ title: '当前没有符合条件的记录', description: '已提交记录请到⑤复核，也可调整筛选查看。' })); updateSelection(); return; }
    const columns = ['参与者', '红会身份 / 中心', '签到依据', '时长 / 小时', '志愿者工作内容', '处理状态'];
    const tbody = h('tbody');
    for (const registration of rows) {
      const entry = ownLedger(registration), enabled = eligible(registration), id = registration._id;
      visible.push({ id, enabled });
      const row = h('tr', { class: state.selected.has(id) ? 'is-selected' : '' }, cell('选择', checkbox(id, enabled), 'service-select-cell'));
        const value = draft(registration);
        const member = members.get(registration._id);
        const evidence = h('div', { class: 'stack-1' }, h('small', { text: registration['签到照片ID'] ? '已提交照片' : blood ? '尚未提交照片' : '请核对记录或现场到场情况' }),
          button({ label: '查看签到详情', variant: 'secondary', size: 'sm', onClick: () => showAttendance(registration) }),
          enabled ? button({ label: '编辑服务信息', variant: 'ghost', size: 'sm', onClick: () => editAttendance(registration) }) : null);
        row.append(cell('参与者', h('div', { class: 'stack-1' }, h('strong', { text: registration['姓名'] }), h('small', { text: registration['学号'] }))),
          cell('红会身份 / 中心', h('div', { class: 'stack-1' }, h('span', { text: member?.membership === 'member' ? '红会成员' : member?.membership === 'volunteer' ? '普通志愿者' : '身份待确认' }), h('small', { text: member?.department || '部门未确认' }))),
          cell('签到依据', evidence), cell('时长 / 小时', h('div', { class: 'stack-1' }, ...[['serviceHours', '服务'], ['trainingHours', '培训'], ['travelHours', '交通']].map(([key, label]) => h('label', { class: 'service-hour-line' }, h('span', { text: label }), numberInput(registration, key, `${label}时长`, enabled))))),
          cell('志愿者工作内容', enabled ? h('textarea', { class: 'input service-work-input', rows: 2, maxlength: 500, disabled: busy,
            'aria-label': `${registration['姓名']} 工作内容`, text: value.work, on: { input: e => { value.work = e.target.value; } } }) : h('span', { text: value.work })),
          cell('处理状态', h('div', { class: 'stack-2' }, badge(serviceStatus(entry, false, registration, blood), { tone: tone(entry) }),
            !enabled ? h('small', { text: attendanceBlockReason(registration, entry, blood) }) : entry?.['退回原因'] ? h('small', { text: entry['退回原因'] }) : null)));
      tbody.append(row);
    }
    content.append(h('div', { class: 'service-table-scroll', tabindex: 0, 'aria-label': '签到核验表' },
      h('table', { class: 'service-table service-table--fit' }, h('caption', { class: 'sr-only', text: '签到及实际时长录入表' }), h('colgroup', {}, ...[4, 14, 13, 18, 14, 22, 15].map(width => h('col', { vars: { 'column-width': `${width}%` } }))), tableHead(columns), tbody)));
    updateSelection();
  }
  async function save() {
    if (busy) return;
    if (!state.selected.size) { notify.warning('请先勾选名单'); return; }
    const items = [...state.selected].map(id => ({ id, hours: Object.fromEntries(Object.entries(draft(registrations.find(r => r._id === id))).filter(([key]) => key !== 'version')) }));
    if (items.length > 200) { notify.warning('每次最多处理200条记录'); return; }
    busy = true; renderTable();
    try {
      const result = await request(`${root}/events/${event._id}/attendance-batch`, { method: 'POST', body: { items } });
      state.result = result;
      for (const row of result.results) if (row.ok) { state.selected.delete(row.id); state.drafts.delete(row.id); }
      failurePanel(result); await onSaved();
    } catch (error) { reportError(error, '确认签到并录入未完成'); }
    finally { busy = false; renderTable(); }
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
  function editAttendance(registration) {
    const value = draft(registration), form = hoursFields(value);
    const drawer = openDrawer({ title: `${registration['姓名']} · 服务信息`, description: `${registration['院系'] || ''} · ${registration['学号']}（身份信息不可编辑）`, width: 640, body: form.node,
      footer: [button({ label: '保留修改', variant: 'primary', onClick: () => { if (!form.valid()) return; Object.assign(value, form.values()); drawer.close(); renderTable(); notify.success('修改已保留，请勾选后确认签到并录入'); } })] });
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
  const search = h('input', { class: 'input service-search', type: 'search', value: state.search, placeholder: '搜索姓名、学号或岗位', 'aria-label': '搜索参与者', on: { input: e => { state.search = e.target.value; renderTable(); } } });
  const filter = field({ label: '状态筛选', value: state.filter, options: [{ value: 'todo', label: '待处理（核验 / 修改）' }, { value: 'submitted', label: '已提交' }, { value: 'all', label: '全部名单' }], onInput: e => { state.filter = e.target.value; renderTable(); } });
  const sort = field({ label: '排列方式', value: state.sort, options: [{ value: 'time', label: '报名时间' }, { value: 'name', label: '姓名' }, { value: 'id', label: '学号' }], onInput: e => { state.sort = e.target.value; renderTable(); } });
  const membership = field({ label: '红会身份', value: state.membership, options: [{ value: '', label: '全部身份' }, { value: 'member', label: '红会成员' }, { value: 'volunteer', label: '普通志愿者' }, { value: 'unknown', label: '待确认' }], onInput: e => { state.membership = e.target.value; renderTable(); } });
  const center = field({ label: '所属中心', value: state.center, options: [{ value: '', label: '全部中心' }, ...['博爱中心', '生命中心', '综事中心', '苏州', '主席团 / 指导组', '工作组'].map(value => ({ value, label: value }))], onInput: e => { state.center = e.target.value; renderTable(); } });
  primary = button({ label: '确认签到并录入', variant: 'primary', onClick: save });
  selectedText = h('strong', { text: '已选 0 人' });
  const expand = button({ label: state.expanded ? '显示活动列表' : '收起活动列表', variant: 'ghost', size: 'sm', onClick: () => {
    state.expanded = !state.expanded;
    node.closest('.activity-workspace')?.classList.toggle('is-service-focused', state.expanded);
    expand.textContent = state.expanded ? '显示活动列表' : '收起活动列表';
  } });
  const pending = ledger.filter(row => row['状态'] === '待批准').length;
  const approved = ledger.filter(row => ['已批准', '已入账'].includes(row['状态']));
  node.append(h('header', { class: 'service-heading' }, h('div', { class: 'stack-2' }, h('h3', { class: 't-h3', text: '④ 签到核验' }),
    h('p', { class: 't-caption', text: '查看签到依据，核对到场情况和时长；勾选后一次确认签到并录入，提交到⑤复核。' })),
    h('div', { class: 'row-2 row-wrap' }, expand, onNavigate ? button({ label: '去⑤审核时长 →', onClick: () => onNavigate('hours') }) : null)));
  node.append(h('p', { class: 'service-counts', text: `待处理 ${registrations.filter(r => ['已确认', '已签到'].includes(r['报名状态']) && matchesServiceFilter('todo', ownLedger(r), false)).length} 人 · 已提交 ${pending + approved.length} 人。` }));
  selectionHint = h('small');
  selectVisible = button({ label: '全选当前名单', variant: 'secondary', onClick: () => { if (busy) return; for (const item of visible.filter(row => row.enabled)) state.selected.add(item.id); renderTable(); } });
  clearSelection = button({ label: '取消选择', variant: 'ghost', onClick: () => { state.selected.clear(); renderTable(); } });
  batchBar = h('div', { class: 'service-batch-bar' }, h('div', { class: 'stack-1' }, selectedText, selectionHint),
    h('div', { class: 'row-2 row-wrap' }, selectVisible, clearSelection, primary));
  node.append(h('div', { class: 'service-tools' }, search, filter, membership, center, sort), memberFeedback, feedback,
    batchBar, content);
  failurePanel(state.result);
  renderTable();
  void loadMembers();
  return node;
}
