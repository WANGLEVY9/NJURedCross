import { h, clear } from '../../core/dom.js';
import { request } from '../../core/api.js';
import { notify, reportError } from '../../core/toast.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { button, badge, field, checkbox as checkControl, notice, emptyState, definitionList } from '../../ui/primitives.js';
import { serviceStatus, matchesServiceFilter, attendanceBlockReason, serviceSession, matchesServiceContext } from './activity-service-state.js';
import { hoursWorkspace } from './hours-workspace.js';
import { hoursFields, entryValues } from './hours-fields.js';
import { bulkHoursFields } from './bulk-hours-fields.js';
import { attendanceEvidenceState } from './attendance-evidence-state.js';
import { createPositionLabels } from '../../shared/position-labels.js';
import {hoursLocked,supportsHoursSubmission} from '../../shared/hours-submission.js';

const root = '/api/volunteer/workflow';
const tone = row => ['已批准', '已入账'].includes(row?.['状态']) ? 'success' : 'warning';

export function serviceWorkspace({ event, events = [event], registrations, ledger, kind, actor, superAdmin, state, onSaved, onNavigate }) {
  if (kind === 'hours') return hoursWorkspace({ event, actor, superAdmin, state, onSaved, onNavigate });
  state.drafts ||= new Map();
  state.selected ||= new Set();
  state.search ||= '';
  let members = new Map();
  state.filter ||= 'todo';
  state.registrationStatus ??= 'ready';
  const positionLabels = createPositionLabels({ event, events, registrations });
  state.sort ||= 'time';
  state.sortDirection ||= 'asc';
  const node = h('section', { class: 'service-workspace field-attendance stack-4', 'aria-label': '签到核验与时长录入' });
  const content = h('div', { class: 'service-content' });
  const feedback = h('div', { 'aria-live': 'polite' });
  const memberFeedback = h('div', { 'aria-live': 'polite' });
  const submitted = new Set();
  let busy = false, selectedText, primary, selectAll, selectVisible, clearSelection, bulkEdit, visible = [];
  const attendanceDetails = new Map();
  function loadAttendanceDetail(registration) {
    const id = registration._id;
    if (!attendanceDetails.has(id)) attendanceDetails.set(id,
      request(`${root}/registrations/${encodeURIComponent(id)}/attendance-detail`).catch(error => { attendanceDetails.delete(id); throw error; }));
    return attendanceDetails.get(id);
  }
  function renderEvidence(registration) {
    const evidence = attendanceEvidenceState(registration, undefined, sessionFor(registration).blood);
    return h('div', { class: 'service-evidence-summary stack-1' }, h('span', { text: registration['签到照片ID'] ? evidence.label : '查看到场依据' }),
      button({ label: '查看签到记录', variant: 'secondary', size: 'sm', onClick: () => showAttendance(registration) }));
  }
  node.hasUnsaved = () => [...state.drafts.values()].some(value => value.dirty);
  node.isSaving = () => busy;
  node.discard = () => state.drafts.clear();
  node.focusWorkspace = () => node.scrollIntoView({ block: 'start' });
  const ledgerByRegistration = new Map(ledger.map(row => [row['报名行ID'], row]));
  const ownLedger = registration => ledgerByRegistration.get(registration._id);
  const locked=hoursLocked(event)||event['状态']==='已结束'&&supportsHoursSubmission(event);
  const blockReason=(registration,entry)=>locked?'整份时长表已提交或活动已结束，当前只读。':event.hoursSubmission?.absences?.[registration._id]?'已标记缺席，请先取消缺席。':attendanceBlockReason(registration,entry,sessionFor(registration).blood,{draft:!!event.hoursSubmission&&!locked});
  const sessionFor = registration => serviceSession(registration, events, event);
  const positionOf = registration => positionLabels.labelFor(registration);
  function eligible(registration) {
    return !submitted.has(registration._id) && !blockReason(registration, ownLedger(registration));
  }
  function memberLabel(member) {
    if (member?.center === '主席团 / 指导组') return '主席团成员';
    if (member?.center === '苏州') return '苏州分部';
    if (['生命中心', '博爱中心', '综事中心'].includes(member?.center)) return member.center;
    return !member || member.membership === 'unknown' ? '待确认' : '志愿者';
  }
  function draft(registration) {
    const entry = ownLedger(registration), key = registration._id;
    const version = entry?.['核对摘要'] || entry?.['状态'] || '';
    if (!state.drafts.has(key) || state.drafts.get(key).version !== version) {
      const session = events.find(row => row['活动ID'] === registration['活动ID']) || event;
      state.drafts.set(key, { version, ...entryValues(entry, registration, session), expectedDigest: entry?.['核对摘要'] });
    }
    return state.drafts.get(key);
  }
  function failurePanel(result) {
    clear(feedback);
    if (result?.succeeded && !result.failed) feedback.append(notice(`${result.succeeded} 人已核验并保存时长；全部处理后提交整份时长表。`, { tone: 'success' }));
    if (result?.failed) feedback.append(notice(`已完成 ${result.succeeded} 人，${result.failed} 人需要处理；未完成记录可能已核验签到，请按原因核对时长状态。`, { tone: 'warning' }),
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
    if (selectedText) selectedText.textContent = `筛选结果 ${visible.length} 条 · 可核验 ${selectable.length} 条 · 已选 ${state.selected.size} 条`;
    if (selectVisible) selectVisible.disabled = busy || !selectable.length;
    if (clearSelection) { clearSelection.disabled = busy || !state.selected.size; clearSelection.hidden = !state.selected.size; }
    if (bulkEdit) { bulkEdit.disabled = busy || !state.selected.size; bulkEdit.hidden = !state.selected.size; }
    if (primary) { primary.hidden = !state.selected.size; primary.disabled = busy || !state.selected.size; primary.textContent = busy ? '正在处理…' : '确认签到并录入'; }
  }
  function checkbox(id, enabled, name) {
    if (!enabled) return h('span', { class: 't-caption', text: '—' });
    const input = h('input', { type: 'checkbox', disabled: !enabled || busy, 'aria-label': `选择${name}的签到记录`, on: { change: () => {
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
      value: value[key], disabled: !enabled || busy, 'aria-label': `${registration['姓名']} ${label}`, on: { input: e => { value[key] = e.target.value; value.dirty = true; } } });
  }
  function cell(label, value, className = '') { return h('td', { 'data-label': label, class: className }, value); }
  function sorted(rows) {
    const direction = state.sortDirection === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => direction * (state.sort === 'name' ? a['姓名'].localeCompare(b['姓名'], 'zh-CN')
      : state.sort === 'id' ? a['学号'].localeCompare(b['学号']) : String(a['创建时间'] || '').localeCompare(String(b['创建时间'] || ''))));
  }
  function matches(registration, entry) {
    const query = state.search.trim().toLowerCase();
    const member = members.get(registration._id);
    const text = `${registration['姓名']} ${registration['学号']} ${registration['岗位'] || ''} ${positionOf(registration)} ${member?.department || ''}`.toLowerCase();
    return (!query || text.includes(query)) && matchesServiceFilter(state.filter, entry, false) && matchesServiceContext(state, sessionFor(registration), registration);
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
    const previousScroll = content.querySelector('.service-table-scroll');
    const scrollLeft = previousScroll?.scrollLeft || 0, scrollTop = previousScroll?.scrollTop || 0;
    clear(content); visible = [];
    const rows = sorted(registrations).filter(r => matches(r, ownLedger(r)));
    const currentIds = new Set(rows.filter(eligible).map(r => r._id));
    for (const id of state.selected) if (!currentIds.has(id)) state.selected.delete(id);
    if (!rows.length) { content.append(emptyState({ title: '当前没有符合条件的记录', description: '已提交记录请到⑤复核，也可调整筛选查看。' })); updateSelection(); return; }
    const columns = ['姓名', '场次 / 岗位', '学号', '签到依据', '服务时长', '培训时长', '交通时长', '志愿者工作内容', '状态', '操作'];
    const tbody = h('tbody');
    for (const registration of rows) {
      const entry = ownLedger(registration), enabled = eligible(registration), id = registration._id;
      visible.push({ id, enabled });
      const row = h('tr', { data: { registrationId: id }, class: state.selected.has(id) ? 'is-selected' : '' }, cell('选择', checkbox(id, enabled, registration['姓名']), 'service-select-cell'));
        const value = draft(registration);
        const evidence = renderEvidence(registration);
        const edit = enabled ? button({ label: '核验并录入', variant: 'secondary', size: 'sm', onClick: () => showAttendance(registration) }) : null;
        edit?.classList.add('service-edit-button');
        const session = sessionFor(registration);
        row.append(cell('姓名', h('strong', { text: registration['姓名'] }), 'service-name-cell'),
          cell('场次 / 岗位', h('div', { class: 'stack-1' }, h('span', { text: `${session.date} ${session.slot}` }), h('small', { text: session.location }), h('small', { title: session.position, text: positionLabels.labelFor(registration) })), 'service-session-cell'),
          cell('学号', h('span', { class: 'service-student-id', text: registration['学号'] })),
          cell('签到依据', evidence),
          cell('服务时长', numberInput(registration, 'serviceHours', '服务时长', enabled), 'service-hours-cell'),
          cell('培训时长', numberInput(registration, 'trainingHours', '培训时长', enabled), 'service-hours-cell'),
          cell('交通时长', numberInput(registration, 'travelHours', '交通时长', enabled), 'service-hours-cell'),
          cell('志愿者工作内容', enabled ? h('textarea', { class: 'input service-work-input', rows: 2, maxlength: 500, disabled: busy,
            'aria-label': `${registration['姓名']} 工作内容`, text: value.work, on: { input: e => { value.work = e.target.value; value.dirty = true; } } }) : h('span', { text: value.work })),
          cell('状态', h('div', { class: 'stack-2' }, badge(event.hoursSubmission?.absences?.[id]?'缺席':entry?.['状态']==='待批准'&&!locked?'已录入，待整表提交':serviceStatus(entry, false, registration, session.blood), { tone: tone(entry) }))),
          cell('操作', edit || h('div', { class: 'stack-2' }, h('small', { text: submitted.has(id) ? '已录入，请刷新查看最新记录' : blockReason(registration, entry) }), button({ label: '查看签到详情', size: 'sm', onClick: () => showAttendance(registration) }))));
      tbody.append(row);
    }
    content.append(h('div', { class: 'service-table-scroll', tabindex: 0, 'aria-label': '签到核验表' },
      h('table', { class: 'service-table service-table--fit' }, h('caption', { class: 'sr-only', text: '签到及实际时长录入表' }), h('colgroup', {}, ...[3, 10, 17, 9, 11, 6, 6, 6, 13, 9, 10].map(width => h('col', { vars: { 'column-width': `${width}%` } }))), tableHead(columns), tbody)));
    const scroller = content.querySelector('.service-table-scroll'); if (scroller) { scroller.scrollLeft = scrollLeft; scroller.scrollTop = scrollTop; }
    updateSelection();
  }
  async function save() {
    if (busy) return;
    renderTable();
    if (!state.selected.size) { notify.warning('请先勾选名单'); return; }
    const items = [...state.selected].map(id => ({ id, hours: Object.fromEntries(Object.entries(draft(registrations.find(r => r._id === id))).filter(([key]) => !['version','dirty'].includes(key))) }));
    if (items.length > 200) { notify.warning('每次最多处理200条记录'); return; }
    if (!await confirmAction({ title: `确认 ${items.length} 人的到场与实际时长？`, description: '请先逐人核对签到依据。提交后仅进入时长复核，不代表时长已批准。', confirmLabel: '确认签到并录入' })) return;
    busy = true; renderTable();
    try {
      const result = await request(`${root}/events/${event._id}/attendance-batch`, { method: 'POST', body: { items } });
      state.result = result;
      for (const row of result.results) if (row.ok) { submitted.add(row.id); state.selected.delete(row.id); state.drafts.delete(row.id); }
      failurePanel(result); await onSaved();
    } catch (error) { reportError(error, '确认签到并录入未完成'); }
    finally { busy = false; renderTable(); }
  }
  async function showAttendance(registration) {
    const evidenceBody = h('div', { class: 'stack-3' }, notice('正在读取签到记录…', { tone: 'neutral' }));
    const value = draft(registration), form = hoursFields(value), enabled = eligible(registration);
    const initial = JSON.stringify(form.values());
    let saving = false, done = false;
    const feedback = h('div', { 'aria-live': 'polite' });
    const checked = checkControl({ label: '已核对签到依据与实际到场情况' });
    const submit = button({ label: '确认签到并录入时长', variant: 'primary', onClick: async () => {
      if (saving || !eligible(registration) || !checked.control.checked || !form.valid()) return;
      saving = true; submit.disabled = true;
      form.node.querySelectorAll('input,textarea,button').forEach(control => { control.disabled = true; });
      const hours = { ...form.values(), expectedDigest: value.expectedDigest };
      try {
        const out = await request(`${root}/events/${event._id}/attendance-batch`, { method: 'POST', body: { items: [{ id: registration._id, hours }] } });
        const result = out.results.find(row => row.id === registration._id);
        if (!result?.ok) { clear(feedback); feedback.append(notice(result?.message || '未完成，请核对记录后重试', { tone: 'warning' })); return; }
        submitted.add(registration._id); state.selected.delete(registration._id); state.drafts.delete(registration._id);
        done = true; saving = false; drawer.close();
        notify.success('签到及实际时长已提交，等待复核'); await onSaved(); renderTable();
      } catch (error) { clear(feedback); feedback.append(notice(error.message || '提交未完成，输入已保留；请核对最新状态后重试', { tone: 'warning' })); }
      finally { saving = false; submit.disabled = !checked.control.checked; form.node.querySelectorAll('input,textarea,button').forEach(control => { control.disabled = false; }); }
    } });
    submit.disabled = true;
    checked.control.addEventListener('change', () => { submit.disabled = saving || !checked.control.checked; });
    const body = h('div', { class: 'field-inspector stack-4' }, evidenceBody, enabled ? h('section', { class: 'stack-3' }, h('h3', { text: '实际服务信息' }), form.node, checked, notice('提交进入待复核，不会自动批准时长。', { tone: 'neutral' }), feedback) : definitionList([['服务时长', value.serviceHours], ['培训时长', value.trainingHours], ['交通时长', value.travelHours], ['具体工作地点', value.location], ['正式工作日期', value.dates], ['工作内容', value.work], ['备注', value.remark || '无']]));
    const drawer = openDrawer({ title: `${registration['姓名']} · 签到详情`, width: 880, workspace: true, body,
      beforeClose: async () => !saving && (done || JSON.stringify(form.values()) === initial || await confirmAction({ title: '放弃未提交的服务信息？', description: '已提交记录不受影响。', confirmLabel: '放弃修改' })), footer: enabled ? [submit] : [] });
    drawer.surface.classList.add('field-edit-dialog');
    drawer.surface.hasUnsaved = () => saving || !done && JSON.stringify(form.values()) !== initial;
    drawer.surface.isSaving = () => saving;
    drawer.surface.discard = () => { done = true; };
    try {
      const detail = await loadAttendanceDetail(registration);

      const member = members.get(registration._id);
      const time = value => value ? new Date(value).toString() === 'Invalid Date' ? value : new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未记录';
      const items = [definitionList([['学号', detail.studentId], ['院系', registration['院系'] || '未填写'], ['部门', member?.department || '待确认'], ['红会身份', memberLabel(member)], ['急救证', member?.certificate || '未记录'], ['岗位', `${positionOf(registration)} · ${registration['岗位'] || sessionFor(registration).position || '未填写'}`], ['凭证提交时间', time(detail.submittedAt)],
        ['管理员核验', detail.verified ? `${detail.verified.by} · ${time(detail.verified.at)}` : '尚未核验'], ['核验说明', detail.verified?.note || '暂无']])];
      if (detail.hasPhoto) items.push(h('h3', { text: '本次提交的签到照片' }), h('img', { class: 'service-evidence', src: `${root}/registrations/${registration._id}/photo`, alt: '本次活动签到凭证', on: { error: e => { const image=e.target; const retry=h('div', { class: 'stack-2' }, notice('照片暂时无法加载，不能据此判断是否到场。', { tone: 'warning' }), button({ label: '重新加载照片', onClick: () => { retry.replaceWith(image); image.src = `${root}/registrations/${registration._id}/photo?retry=${Date.now()}`; } })); image.replaceWith(retry); } } }));
      items.push(h('h3', { text: '旧签到表关联记录' }));
      if (!detail.legacy.length) items.push(h('p', { class: 't-caption', text: '未找到可唯一关联的旧表签到记录；这不代表同学一定未到场。' }));
      for (const record of detail.legacy) items.push(definitionList([['活动时间', time(record.time)], ['提交时间', time(record.submittedAt)], ['备注', record.note || '无'], ['原表核对状态', record.status || '未记录']]),
        ...record.photos.map((url, index) => h('a', { class: 'btn btn--secondary', text: `打开原表照片 ${index + 1}`, href: url, target: '_blank', rel: 'noopener noreferrer', data: { native: true } })));
      for (const warning of detail.warnings) items.push(notice(warning, { tone: 'warning' }));
      items.push(h('p', { class: 't-caption', text: '查看记录不会确认签到。原表照片可能需要登录 NJUTable。' }));
      evidenceBody.replaceChildren(...items);
    } catch (error) { evidenceBody.replaceChildren(notice(error.message || '签到记录加载失败，请重新打开核对。', { tone: 'warning' })); }
  }
  function editSelected() {
    const registrationsToEdit = registrations.filter(registration => state.selected.has(registration._id) && eligible(registration) && matches(registration, ownLedger(registration)));
    if (!registrationsToEdit.length) { notify.warning('请先勾选需要批量修改的名单'); return; }
    const form = bulkHoursFields(draft(registrationsToEdit[0]));
    const drawer = openDrawer({ title: `批量修改 ${registrationsToEdit.length} 人`, description: '修改先保留在当前页面，确认签到并录入后才会提交。', width: 680, body: form.node,
      footer: [button({ label: '应用到所选名单', variant: 'primary', onClick: () => {
        if (!form.valid()) return;
        const patch = form.patch();
        for (const registration of registrationsToEdit) Object.assign(draft(registration), patch, { dirty: true });
        drawer.close(); renderTable(); notify.success(`已批量更新 ${registrationsToEdit.length} 人，请确认后提交`);
      } })] });
  }
  async function loadMembers() {
    try {
      const result = await request(`${root}/events/${event._id}/members`);
      members = new Map(result.people.map(person => [person.id, person]));
      clear(memberFeedback);
      if (result.warning) memberFeedback.append(notice(result.warning, { tone: 'warning' }));
    } catch {
      clear(memberFeedback); memberFeedback.append(notice('成员资料暂时无法读取，身份显示待确认。', { tone: 'warning' }), button({ label: '重试成员资料', onClick: loadMembers }));
    }
  }
  const search = field({ label: '记录搜索', type: 'search', value: state.search, placeholder: '姓名、学号或岗位', onInput: e => { state.search = e.target.value; renderTable(); } });
  const filter = field({ label: '状态筛选', value: state.filter, options: [{ value: 'todo', label: '待核验 / 录入' }, { value: 'submitted', label: '已录入' }, { value: 'all', label: '全部名单' }], onInput: e => { state.filter = e.target.value; renderTable(); } });
  const contextFilter = (key, label, values) => field({ label, value: state[key] || '', options: [{ value: '', label: `全部${label}` }, ...values], onInput: e => { state[key] = e.target.value; renderTable(); } });
  const contexts = registrations.map(sessionFor);
  const options = key => [...new Set(contexts.map(row => row[key]).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'zh-CN')).map(value => ({ value, label: value }));
  const dateFilter = contextFilter('date', '日期', options('date'));
  const positionFilter = contextFilter('position', '岗位', options('position'));
  const sessions = [...new Map(contexts.map(row => [row.id, { value: row.id, label: `${row.date} ${row.slot} ${row.location}` }])).values()];
  const sessionFilter = contextFilter('session', '场次', sessions);
  const registrationFilter = field({ label: '报名状态', value: state.registrationStatus, options: [
    { value: 'ready', label: '已确认 / 已签到' }, { value: 'all', label: '全部报名状态' },
    ...[...new Set(['已确认', '已签到', '待筛选', ...registrations.map(row => row['报名状态']).filter(Boolean)])].map(value => ({ value, label: value === '待筛选' ? '待审批（不能签到）' : value })),
  ], onInput: e => { state.registrationStatus = e.target.value; renderTable(); } });
  const resetFilters = button({ label: '清除筛选', variant: 'ghost', onClick: () => {
    state.search = ''; state.filter = 'todo'; state.registrationStatus = 'ready';
    for (const key of ['date', 'position', 'session']) state[key] = '';
    search.control.value = ''; filter.control.value = 'todo'; registrationFilter.control.value = 'ready';
    for (const control of [dateFilter, positionFilter, sessionFilter]) control.control.value = '';
    renderTable(); search.control.focus();
  } });
  const sort = field({ label: '排列方式', value: state.sort, options: [{ value: 'time', label: '报名时间' }, { value: 'name', label: '姓名' }, { value: 'id', label: '学号' }], onInput: e => { state.sort = e.target.value; renderTable(); } });
  const sortDirection = button({ label: state.sortDirection === 'asc' ? '升序 ↑' : '降序 ↓', variant: 'secondary', onClick: () => {
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    sortDirection.querySelector('span').textContent = state.sortDirection === 'asc' ? '升序 ↑' : '降序 ↓'; renderTable();
  } });
  primary = button({ label: '确认签到并录入', variant: 'primary', onClick: save });
  selectedText = h('span', { text: '已选 0 人', 'aria-live': 'polite' });
  const pending = ledger.filter(row => row['状态'] === '待批准').length;
  const approved = ledger.filter(row => ['已批准', '已入账'].includes(row['状态']));
  node.append(h('header', { class: 'service-heading' }, h('div', { class: 'stack-2' }, h('h3', { class: 't-h3', text: '④ 签到与时长录入' }),
    h('p', { class: 't-caption', text: '默认仅显示已确认或已签到人员。待审批报名不能签到，可通过报名状态筛选查看；请先在志愿者报名中处理，再核对到场依据与时长。全部处理后提交整份时长表，再进入⑤复核。' }),
    positionLabels.entries.length ? h('p', { class: 't-caption service-position-legend', 'aria-label': '岗位编号说明', text: positionLabels.legend }) : null),
    h('div', { class: 'service-primary-actions' }, onNavigate ? button({ label: '去⑤审核时长 →', onClick: () => onNavigate('hours') }) : null)));
  node.append(h('p', { class: 'service-counts', text: `待处理 ${registrations.filter(r => ['已确认', '已签到'].includes(r['报名状态']) && matchesServiceFilter('todo', ownLedger(r), false)).length} 人 · 已录入 ${pending + approved.length} 人。` }));
  selectVisible = button({ label: '全选当前名单', variant: 'secondary', onClick: () => { if (busy) return; for (const item of visible.filter(row => row.enabled)) state.selected.add(item.id); renderTable(); } });
  clearSelection = button({ label: '取消选择', variant: 'ghost', onClick: () => { state.selected.clear(); renderTable(); } });
  bulkEdit = button({ label: '批量修改', variant: 'secondary', onClick: editSelected });
  bulkEdit.classList.add('service-edit-button');
  node.append(h('div', { class: 'service-table-operations' },
    h('div', { class: 'service-tools service-tools--attendance service-context-filters' }, search, dateFilter, positionFilter, sessionFilter, registrationFilter, filter, resetFilters, h('details', { class: 'service-sort-options' }, h('summary', { text: '调整排列' }), sort, sortDirection)),
    h('div', { class: 'service-selection-tools' }, selectedText, selectVisible, clearSelection, bulkEdit, primary)), memberFeedback, feedback, content);
  failurePanel(state.result);
  renderTable();
  void loadMembers();
  return node;
}
