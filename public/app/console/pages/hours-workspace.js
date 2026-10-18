import { h, clear } from '../../core/dom.js';
import { request, downloadFile } from '../../core/api.js';
import { notify, reportError } from '../../core/toast.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { button, field, notice, emptyState, badge } from '../../ui/primitives.js';
import { reviewBlockReason } from './activity-service-state.js';
import { hoursFields, entryValues } from './hours-fields.js';
import { bulkHoursFields } from './bulk-hours-fields.js';
import { serviceRecords } from './service-records.js';
import { searchField } from '../../ui/search-field.js';
import { recordTable } from '../lib.js';
import {canReviewHours} from './activity-approval.js';
import {supportsHoursSubmission} from '../../shared/hours-submission.js';

// The review page groups displayed rows; all edits and approvals retain individual ledger identities.
export function hoursWorkspace({ event, actor, superAdmin, state, onSaved }) {
  const root = `/api/volunteer/workflow/events/${encodeURIComponent(event._id)}`;
  let blood = false;
  try { blood = Boolean(JSON.parse(event['报名页配置'] || '{}').blood); } catch { /* Ordinary event. */ }
  state.month ??= blood ? String(event['报名日期']).slice(0, 7) : '';
  state.filter ||= 'todo'; state.sort ||= 'time'; state.sortDirection ||= 'asc'; state.search ||= '';
  if (state.filter === 'returned') state.filter = 'all';
  state.selected ||= new Set();
  let retryIds = null;
  let review, visible = [], busy = false, sequence = 0, focusPending = false;
  const content = h('div', { class: 'service-content' }), feedback = h('div', { 'aria-live': 'polite' });
  const counts = h('p', { class: 't-caption' }), selectedText = h('span');
  const query = () => state.month ? `?month=${encodeURIComponent(state.month)}` : '';
  const approved = e => ['已批准', '已入账'].includes(e['状态']);
  const reason = e => !canReviewHours(event,actor,superAdmin)?'仅指定审核人可修改或批准时长。':event['状态']==='已结束'&&supportsHoursSubmission(event)?'活动已结束，仅可查看。':event.hoursSubmission&&event.hoursSubmission.phase!=='submitted'?'整份时长表尚未提交或已退回。':reviewBlockReason(e, actor, superAdmin);
  const canEdit = e => !reason(e);
  const byId = id => review.entries.find(e => e._id === id);
  function groupEntries(group) { return group.ids.map(byId); }
  function statusText(entries) {
    return [['待批准', '待审核'], ['已退回', '待重新录入']].flatMap(([state, label]) => {
      const count = entries.filter(e => e['状态'] === state).length; return count ? [count > 1 ? `${label} ${count} 次` : label] : [];
    }).concat(entries.some(approved) ? ['已通过'] : []).join('\n');
  }
  function groups() {
    const result = review.rows.map((row, i) => ({ row, ids: review.groups[i].ids, index: i }));
    const direction = state.sortDirection === 'desc' ? -1 : 1;
    return result.filter(group => {
      const entries = groupEntries(group);
      const wanted = state.filter === 'all' || entries.some(e => state.filter === 'approved' ? approved(e) : e['状态'] === '待批准');
      const text = `${group.row.姓名} ${group.row.学号} ${group.row.院系}`;
      return wanted && text.includes(state.search.trim());
    }).sort((a, b) => direction * (state.sort === 'name' ? a.row.姓名.localeCompare(b.row.姓名, 'zh-CN')
      : state.sort === 'id' ? a.row.学号.localeCompare(b.row.学号)
        : state.sort === 'service' ? Number(a.row.服务时长 || 0) - Number(b.row.服务时长 || 0)
          : state.sort === 'training' ? Number(a.row.培训时长 || 0) - Number(b.row.培训时长 || 0)
            : state.sort === 'travel' ? Number(a.row.交通时长 || 0) - Number(b.row.交通时长 || 0) : a.index - b.index));
  }
  function updateSelected() {
    content.querySelector('.service-mobile-records')?.syncSelection(busy);
    selectedText.textContent = `已选 ${state.selected.size} 人`;
    selectedText.setAttribute('aria-label', `已选 ${state.selected.size} 人，仅处理其中待审核记录`);
    approveButton.hidden = clearSelection.hidden = bulkEdit.hidden = !state.selected.size;
    approveButton.querySelector('span').textContent = retryIds?.size ? '重试未通过记录' : '审核通过'; approveButton.disabled = busy || !state.selected.size; selectAll.disabled = busy; clearSelection.disabled = busy || !state.selected.size; bulkEdit.disabled = busy || !state.selected.size; if (monthField) monthField.control.disabled = busy;
  }
  function setSort(key) {
    if (state.sort === key) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    else { state.sort = key; state.sortDirection = 'asc'; }
    sort.control.value = state.sort;
    sortDirection.querySelector('span').textContent = state.sortDirection === 'asc' ? '升序 ↑' : '降序 ↓';
    render();
  }
  function sortHeader(label, key) {
    const active = state.sort === key;
    return h('th', { scope: 'col' }, h('button', { class: 'service-sort-button', type: 'button', 'aria-pressed': active ? 'true' : 'false',
      'aria-label': `按${label}${active && state.sortDirection === 'asc' ? '降序' : '升序'}排列`, on: { click: () => setSort(key) } },
    h('span', { text: label }), h('span', { class: 'service-sort-arrow', text: active ? state.sortDirection === 'asc' ? '↑' : '↓' : '↕' })));
  }
  function render() {
    const previousScroll = content.querySelector('.service-table-scroll');
    const scrollLeft = previousScroll?.scrollLeft || 0, scrollTop = previousScroll?.scrollTop || 0;
    clear(content);
    if (!review) { content.append(notice('正在加载复核表…', { tone: 'neutral' })); return; }
    visible = groups();
    const allowed = new Set(visible.filter(g => groupEntries(g).some(canEdit)).map(g => g.ids[0]));
    for (const id of state.selected) if (!allowed.has(id)) state.selected.delete(id);
    counts.textContent = `${state.month ? `${state.month} 献血车全部场次` : '本次活动'} · ${review.rows.length} 人 / ${review.entries.length} 条服务记录。${review.grouping === 'student' ? '同一姓名和学号合并为一行，三项时长分别累计。' : ''} 导出仅含已通过且服务时长大于 0 的记录。`;
    if (!visible.length) { content.append(emptyState({ title: '当前没有符合条件的记录', description: '可切换状态、月份或清空筛选。' })); updateSelected(); return; }
    const rows = visible.map(group => {
      const entries = groupEntries(group), editable = entries.some(canEdit), key = group.ids[0];
      const edit = button({ label: editable ? '编辑信息' : '查看明细', size: 'sm', onClick: () => editGroup(group) });
      if (editable) edit.classList.add('service-edit-button');
      return h('tr', { class: group.ids.length > 1 ? 'is-aggregated' : '' }, h('td', { 'data-label': '选择' }, editable ? h('input', { type: 'checkbox', checked: state.selected.has(key), 'aria-label': `选择${group.row.姓名}`, on: { change: e => { retryIds = null; if (e.target.checked) state.selected.add(key); else state.selected.delete(key); updateSelected(); } } }) : '—'),
        h('td', { 'data-label': '姓名' }, h('div', { class: 'stack-1' }, h('strong', { text: group.row.姓名 }), group.ids.length > 1 ? h('span', { class: 'service-aggregate-mark', text: `合并 ${group.ids.length} 次` }) : null)),
        h('td', { 'data-label': '学号' }, h('span', { class: 'service-student-id', text: group.row.学号 })),
        h('td', { 'data-label': '院系', text: group.row.院系 || '未填写' }),
        h('td', { 'data-label': '具体工作地点', text: group.row.具体工作地点 }),
        h('td', { 'data-label': '正式工作日期', text: group.row.正式工作日期 }),
        h('td', { 'data-label': '服务时长', class: 'service-duration-value', text: group.row.服务时长 ?? 0 }),
        h('td', { 'data-label': '培训时长', class: 'service-duration-value', text: group.row.培训时长 ?? 0 }),
        h('td', { 'data-label': '交通时长', class: 'service-duration-value', text: group.row.交通时长 ?? 0 }),
        h('td', { 'data-label': '志愿者工作内容', text: group.row.志愿者具体工作内容 }),
        h('td', { 'data-label': '备注', text: group.row.备注 || '—' }),
        h('td', { 'data-label': '状态' }, badge(statusText(entries), { tone: entries.every(approved) ? 'success' : 'warning' })),
        h('td', { 'data-label': '操作' }, edit));
    });
    content.append(serviceRecords({ rows: visible.map(group => ({ id: group.ids[0], group, name: group.row.姓名,
      studentId: group.row.学号, context: group.ids.length > 1 ? `合并 ${group.ids.length} 次服务` : '',
      status: statusText(groupEntries(group)), tone: groupEntries(group).every(approved) ? 'success' : 'warning',
      hours: { serviceHours: group.row.服务时长, trainingHours: group.row.培训时长, travelHours: group.row.交通时长 },
      enabled: groupEntries(group).some(canEdit), action: groupEntries(group).some(canEdit) ? '编辑信息' : '查看明细' })),
      selected: state.selected, busy, open: row => editGroup(row.group),
      onSelect: (id, checked) => { retryIds = null; if (checked) state.selected.add(id); else state.selected.delete(id); updateSelected(); } }));
    content.append(h('div', { class: 'service-table-scroll service-table-scroll--review service-desktop-records', tabindex: 0, 'aria-label': '时长复核汇总表' },
      h('table', { class: 'service-table service-review-table service-table--fit' }, h('colgroup', {}, ...[3, 6, 8, 8, 8, 12, 6, 6, 6, 15, 5, 7, 10].map(width => h('col', { vars: { 'column-width': `${width}%` } }))), h('thead', {}, h('tr', {},
        h('th', { scope: 'col', text: '选择' }), sortHeader('姓名', 'name'), sortHeader('学号', 'id'), h('th', { scope: 'col', text: '院系' }), h('th', { scope: 'col', text: '具体工作地点' }), h('th', { scope: 'col', text: '正式工作日期' }),
        sortHeader('服务时长', 'service'), sortHeader('培训时长', 'training'), sortHeader('交通时长', 'travel'), h('th', { scope: 'col', text: '志愿者工作内容' }), h('th', { scope: 'col', text: '备注' }), h('th', { scope: 'col', text: '状态' }), h('th', { scope: 'col', text: '操作' }))), h('tbody', {}, ...rows))));
    const scroller = content.querySelector('.service-table-scroll'); if (scroller) { scroller.scrollLeft = scrollLeft; scroller.scrollTop = scrollTop; }
    updateSelected();
  }
  async function load(preserve = false) {
    const current = ++sequence, suffix = query(); if (!preserve) { review = null; state.selected.clear(); retryIds = null; } render();
    try {
      const result = await request(`${root}/hours-review${suffix}`, { fresh: true });
      if (current !== sequence) return;
      review = result; render();
      if (focusPending) { node.scrollIntoView({ block: 'start' }); focusPending = false; }
    } catch (error) { if (current === sequence) { review = null; state.selected.clear(); updateSelected(); clear(content); content.append(notice(error.message || '加载失败', { tone: 'warning' }), button({ label: '重试', onClick: load })); } }
  }
  async function download() {
    await downloadFile(`${root}/hours-export${query()}`, `${state.month ? `${state.month}献血车` : event['活动名称']}-志愿时长录入表.xlsx`);
  }
  async function approveSelection() {
    if (busy || !review) return;
    const items = visible.filter(g => state.selected.has(g.ids[0])).flatMap(groupEntries).filter(e => canEdit(e) && (!retryIds || retryIds.has(e._id))).map(e => ({ id: e._id, expectedDigest: e['核对摘要'] }));
    if (!items.length) { notify.warning('请先勾选需要审核的名单'); return; }
    if (items.length > 200) { notify.warning('一次最多审核200条服务记录，请减少勾选人数'); return; }
    busy = true; updateSelected();
    try {
      const out = await request(`${root}/hours-approve`, { method: 'POST', body: { items, month: state.month } });
      clear(feedback); feedback.append(notice(`通过 ${out.succeeded} 条服务记录，${out.failed} 条未完成。${out.results.filter(r => !r.ok).map(r => r.message).join('；')}`, { tone: out.failed ? 'warning' : 'success' }));
      retryIds = out.failed ? new Set(out.results.filter(r => !r.ok).map(r => r.id)) : null;
      if (out.failed) {
        feedback.append(h('ul', { class: 'service-failures' }, ...out.results.filter(r => !r.ok).map(r => h('li', { text: `${byId(r.id)?.['姓名'] || r.id}：${r.message}` }))));
        for (const g of visible) if (!g.ids.some(id => retryIds.has(id))) state.selected.delete(g.ids[0]);
      } else state.selected.clear();
      if (out.succeeded && !out.failed) { state.filter = 'approved'; filter.control.value = 'approved'; }
      if (out.failed) notify.warning('部分记录未通过', out.results.filter(r => !r.ok).map(r => r.message).join('；'));
      else notify.success(`已通过 ${out.succeeded} 条服务记录`);
      await onSaved?.(); await load(true);
    } catch (error) { reportError(error, '审核未完成'); }
    finally { busy = false; updateSelected(); }
  }
  function editGroup(group) {
    const entries = groupEntries(group), forms = [], body = h('div', { class: 'field-inspector stack-4' }), errors = h('div', { role: 'status' });
    body.append(notice(`${group.row.姓名} · ${group.row.院系} · ${group.row.学号}。身份信息不可编辑。多次服务逐条修改，保存后自动重新汇总，避免把总时长重复写入每次服务。`, { tone: 'neutral' }));
    for (const entry of entries) {
      const registration = review.registrations.find(r => r._id === entry['报名行ID']);
      const sourceEvent = review.events.find(e => e['活动ID'] === entry['活动ID']);
      const values = entryValues(entry, registration, sourceEvent), editable = canEdit(entry);
      const section = h('section', { class: 'stack-3' }, h('h3', { text: `${registration['报名日期']} ${registration['报名时段']}` }), h('p', { class: 't-caption', text: sourceEvent['活动名称'] }));
      if (editable) {
        const form = hoursFields(values); forms.push({ id: entry._id, expectedDigest: entry['核对摘要'], form, initial: form.values() }); section.append(form.node);
      } else section.append(notice(reason(entry), { tone: 'neutral' }), h('pre', { class: 'service-detail-text', text: `${values.location}\n${values.dates}\n培训 ${values.trainingHours} / 交通 ${values.travelHours} / 服务 ${values.serviceHours} 小时\n${values.work}\n${values.remark}` }));
      if (entry['修订人']) section.append(h('small', { text: `最近修改：${entry['修订人']} · ${entry['修订时间']}` }));
      body.append(section);
    }
    body.append(errors);
    let saving = false, discarded = false;
    const dirty = () => !discarded && forms.some(f => JSON.stringify(f.form.values()) !== JSON.stringify(f.initial));
    const save = button({ label: '保存修改', variant: 'primary', onClick: async () => {
      if (saving || !forms.every(f => f.form.valid())) return;
      const changed = forms.filter(f => JSON.stringify(f.form.values()) !== JSON.stringify(f.initial));
      if (!changed.length) { drawer.close(); return; }
      const controls = [...body.querySelectorAll('input, textarea, select, button')].filter(control => !control.disabled);
      saving = true; save.disabled = true; controls.forEach(control => { control.disabled = true; });
      try {
        const out = await request(`${root}/hours-edit`, { method: 'POST', body: { month: state.month, items: changed.map(f => ({ id: f.id, expectedDigest: f.expectedDigest, details: f.form.values() })) } });
        for (const result of out.results.filter(r => r.ok)) { const f = forms.find(f => f.id === result.id); f.expectedDigest = result.result['核对摘要']; f.initial = f.form.values(); }
        clear(errors); if (out.failed) errors.append(notice(`已保存 ${out.succeeded} 条，以下记录未完成`, { tone: 'warning' }), h('ul', {}, ...out.results.filter(r => !r.ok).map(r => h('li', { text: `${byId(r.id)?.['姓名'] || r.id}：${r.message}` }))));
        if (out.failed) notify.warning(`已保存 ${out.succeeded} 条，${out.failed} 条未保存`, out.results.filter(r => !r.ok).map(r => r.message).join('；'));
        else { saving = false; drawer.close(); notify.success('已保存修改，汇总与预览已更新，仍待审核'); }
        state.selected.clear(); await onSaved?.(); await load(true);
      } catch (error) { reportError(error, '保存未完成，输入已保留'); }
      finally { saving = false; save.disabled = false; controls.forEach(control => { control.disabled = false; }); }
    } });
    const drawer = openDrawer({ title: `${group.row.姓名} · 服务明细`, width: 880, workspace: true, body, footer: forms.length ? [save] : [], beforeClose: async () => !saving && (!dirty() || await confirmAction({ title: '放弃未保存的时长修改？', description: '已保存明细不受影响。', confirmLabel: '放弃修改' })) });
    drawer.surface.classList.add('field-edit-dialog'); drawer.surface.hasUnsaved = () => saving || dirty(); drawer.surface.isSaving = () => saving; drawer.surface.discard = () => { discarded = true; };
  }
  function editSelected() {
    if (!review) return;
    const entries = visible.filter(group => state.selected.has(group.ids[0])).flatMap(groupEntries).filter(canEdit);
    if (!entries.length) { notify.warning('请先勾选需要批量修改的名单'); return; }
    if (entries.length > 200) { notify.warning('每次最多修改200条服务记录，请减少勾选人数'); return; }
    const first = entries[0], firstRegistration = review.registrations.find(row => row._id === first['报名行ID']);
    const firstEvent = review.events.find(row => row['活动ID'] === first['活动ID']);
    const firstGroup = visible.find(group => state.selected.has(group.ids[0]));
    const form = bulkHoursFields({ ...entryValues(first, firstRegistration, firstEvent), dates: firstGroup.row.正式工作日期 });
    const pending = new Map(entries.map(entry => [entry._id, { id: entry._id, expectedDigest: entry['核对摘要'],
      details: entryValues(entry, review.registrations.find(row => row._id === entry['报名行ID']), review.events.find(row => row['活动ID'] === entry['活动ID'])) }]));
    let saving = false;
    const save = button({ label: `保存 ${entries.length} 条修改`, variant: 'primary', onClick: async () => {
      if (saving || !form.valid()) return;
      saving = true; save.disabled = true;
      const patch = form.patch();
      const items = [...pending.values()].map(entry => ({ ...entry, details: { ...entry.details, ...patch } }));
      try {
        const out = await request(`${root}/hours-edit`, { method: 'POST', body: { month: state.month, items } });
        for (const result of out.results) if (result.ok) pending.delete(result.id);
        save.querySelector('span').textContent = `保存 ${pending.size} 条修改`;
        if (out.failed) notify.warning(`已保存 ${out.succeeded} 条，${out.failed} 条未保存`, out.results.filter(row => !row.ok).map(row => row.message).join('；'));
        else { drawer.close(); notify.success(`已批量保存 ${out.succeeded} 条修改，仍待审核`); }
        state.selected.clear(); await onSaved?.(); await load(true);
      } catch (error) { reportError(error, '批量修改未完成，输入已保留'); }
      finally { saving = false; save.disabled = false; }
    } });
    const drawer = openDrawer({ title: `批量修改 ${entries.length} 条服务记录`, description: '只覆盖勾选字段。日期列表会应用到每条所选待审核明细；合并关系和未勾选的时长保持不变。', width: 720, body: form.node, footer: [save] });
  }
  async function preview() {
    if (!review) return;
    const area = h('div'), drawer = openDrawer({ title: '志愿时长录入表 · 在线预览', width: 1440, body: area });
    let selectedScope = 'current', revision = 0;
    const table = h('div');
    async function show() {
      const requestId = ++revision; clear(table);
      try {
        const rows = selectedScope === 'export' ? (await request(`${root}/export-preview${query()}`)).rows : groups().map(g => g.row);
        if (requestId !== revision) return;
        table.append(h('p', { text: `共 ${rows.length} 人，每人一行。${selectedScope === 'export' ? '与实际Excel导出内容一致。' : '当前筛选范围，含尚未通过的记录。'}` }), recordTable({
          rows, getKey: row => `${row.姓名}:${row.学号}`, searchable: false,
          columns: review.columns.map(key => ({ key, label: key, strong: key === '姓名', sortable: false })),
        }));
      } catch (error) { if (requestId === revision) table.append(notice(error.message, { tone: 'warning' })); }
    }
    area.append(field({ label: '预览范围', value: selectedScope, options: [{ value: 'current', label: '当前筛选名单（审核前可看）' }, { value: 'export', label: '已通过名单（实际导出内容）' }], onInput: e => { selectedScope = e.target.value; void show(); } }), table); await show();
  }
  const filter = field({ label: '状态筛选', value: state.filter, options: [{ value: 'todo', label: '待审核' }, { value: 'approved', label: '已通过' }, { value: 'all', label: '全部名单' }], onInput: e => { state.filter = e.target.value; render(); } });
  const search = searchField({ label: '记录搜索', value: state.search, placeholder: '姓名、学号或院系', onSearch: value => { state.search = value; render(); } });
  const sort = field({ label: '排列方式', value: state.sort, options: [{ value: 'time', label: '原始录入顺序' }, { value: 'name', label: '姓名' }, { value: 'id', label: '学号' },
    { value: 'service', label: '服务时长' }, { value: 'training', label: '培训时长' }, { value: 'travel', label: '交通时长' }], onInput: e => { state.sort = e.target.value; render(); } });
  const sortDirection = button({ label: state.sortDirection === 'asc' ? '升序 ↑' : '降序 ↓', variant: 'secondary', onClick: () => {
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    sortDirection.querySelector('span').textContent = state.sortDirection === 'asc' ? '升序 ↑' : '降序 ↓'; render();
  } });
  const selectAll = button({ label: '全选当前可审核名单', onClick: () => { retryIds = null; for (const group of visible) if (groupEntries(group).some(canEdit)) state.selected.add(group.ids[0]); render(); } });
  const clearSelection = button({ label: '取消选择', variant: 'ghost', onClick: () => { retryIds = null; state.selected.clear(); render(); } });
  const bulkEdit = button({ label: '批量修改', variant: 'secondary', onClick: editSelected });
  bulkEdit.classList.add('service-edit-button');
  const approveButton = button({ label: '审核通过', variant: 'primary', onClick: approveSelection });
  const monthField = blood ? field({ label: '献血车汇总月份', type: 'month', value: state.month, required: true, onInput: e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) { state.month = e.target.value; void load(); } } }) : null;
  const exportButton=button({label:'导出 Excel',onClick:async()=>{try{await download();}catch(error){reportError(error,'暂不可下载');}}});
  exportButton.hidden=!canReviewHours(event,actor,superAdmin);
  const node = h('section', { class: 'service-workspace stack-4', 'aria-label': '时长审核与导出' },
    h('header', { class: 'service-heading service-review-heading' }, h('div', { class: 'stack-2' }, h('h3', { text: '⑤ 时长审核与导出' }), h('p', { class: 't-caption', text: '核对汇总表 → 如有问题直接修改 → 勾选审核 → 导出给主任团录入第二课堂。' })),
      h('div', { class: 'service-primary-actions' }, monthField, button({ label: '在线预览', onClick: preview }),exportButton)),
    counts, h('div', { class: 'service-table-operations' }, h('div', { class: 'service-tools service-tools--review' }, search, filter, h('details', { class: 'service-sort-options' }, h('summary', { text: '调整排列' }), sort, sortDirection)),
    h('div', { class: 'service-selection-tools' }, selectedText, selectAll, clearSelection, bulkEdit, approveButton)),
    feedback, content);
  node.isSaving = () => busy;
  node.hasUnsaved = () => busy;
  node.focusWorkspace = () => { if (review) node.scrollIntoView({ block: 'start' }); else focusPending = true; };
  void load(); return node;
}
