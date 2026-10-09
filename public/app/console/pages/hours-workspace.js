import { h, clear } from '../../core/dom.js';
import { request, downloadFile } from '../../core/api.js';
import { notify, reportError } from '../../core/toast.js';
import { openDrawer } from '../../ui/overlay.js';
import { button, field, notice, emptyState, badge } from '../../ui/primitives.js';
import { reviewBlockReason } from './activity-service-state.js';
import { hoursFields, entryValues } from './hours-fields.js';

// The review page groups displayed rows; all edits and approvals retain individual ledger identities.
export function hoursWorkspace({ event, actor, superAdmin, state, onSaved, onNavigate }) {
  const root = `/api/volunteer/workflow/events/${encodeURIComponent(event._id)}`;
  let blood = false;
  try { blood = Boolean(JSON.parse(event['报名页配置'] || '{}').blood); } catch { /* Ordinary event. */ }
  state.month ??= blood ? String(event['报名日期']).slice(0, 7) : '';
  state.filter ||= 'todo'; state.sort ||= 'time'; state.search ||= ''; state.membership ||= ''; state.center ||= '';
  state.selected = new Set();
  let review, members = new Map(), visible = [], busy = false, sequence = 0, focusPending = false;
  const content = h('div'), feedback = h('div', { 'aria-live': 'polite' }), memberFeedback = h('div');
  const counts = h('p', { class: 't-caption' }), selectedText = h('span');
  const query = () => state.month ? `?month=${encodeURIComponent(state.month)}` : '';
  const approved = e => ['已批准', '已入账'].includes(e['状态']);
  const reason = e => reviewBlockReason(e, actor, superAdmin);
  const canEdit = e => !reason(e);
  const byId = id => review.entries.find(e => e._id === id);
  function groupEntries(group) { return group.ids.map(byId); }
  function statusText(entries) {
    return [['待批准', '待审核'], ['已退回', '退回待改']].flatMap(([state, label]) => {
      const count = entries.filter(e => e['状态'] === state).length; return count ? [`${label} ${count} 次`] : [];
    }).concat(entries.some(approved) ? [`已通过 ${entries.filter(approved).length} 次`] : []).join(' · ');
  }
  function groups() {
    const result = review.rows.map((row, i) => ({ row, ids: review.groups[i].ids }));
    return result.filter(group => {
      const entries = groupEntries(group), member = members.get(entries[0]['报名行ID']);
      const wanted = state.filter === 'all' || entries.some(e => state.filter === 'approved' ? approved(e) : e['状态'] === (state.filter === 'returned' ? '已退回' : '待批准'));
      const text = `${group.row.姓名} ${group.row.学号} ${group.row.院系} ${member?.department || ''}`;
      return wanted && text.includes(state.search.trim()) && (!state.membership || (member?.membership || 'unknown') === state.membership) && (!state.center || member?.center === state.center);
    }).sort((a, b) => state.sort === 'name' ? a.row.姓名.localeCompare(b.row.姓名, 'zh-CN') : state.sort === 'id' ? a.row.学号.localeCompare(b.row.学号) : 0);
  }
  function updateSelected() {
    selectedText.textContent = `已选 ${state.selected.size} 人（仅处理其中待审核记录）`;
    approveButton.disabled = busy; selectAll.disabled = busy; if (monthField) monthField.control.disabled = busy;
  }
  function render() {
    clear(content);
    if (!review) { content.append(notice('正在加载复核表…', { tone: 'neutral' })); return; }
    visible = groups();
    const allowed = new Set(visible.filter(g => groupEntries(g).some(canEdit)).map(g => g.ids[0]));
    for (const id of state.selected) if (!allowed.has(id)) state.selected.delete(id);
    counts.textContent = `${state.month ? `${state.month} 献血车全部场次` : '本次活动'} · ${review.rows.length} 人 / ${review.entries.length} 条服务记录。${review.grouping === 'student' ? '同一姓名和学号合并为一行，三项时长分别累计。' : ''} 导出仅含已通过且服务时长大于 0 的记录。`;
    if (!visible.length) { content.append(emptyState({ title: '当前没有符合条件的记录', description: '可切换状态、月份或清空筛选。' })); updateSelected(); return; }
    const rows = visible.map(group => {
      const entries = groupEntries(group), editable = entries.some(canEdit), key = group.ids[0];
      return h('tr', {}, h('td', { 'data-label': '选择' }, editable ? h('input', { type: 'checkbox', checked: state.selected.has(key), 'aria-label': `选择${group.row.姓名}`, on: { change: e => { if (e.target.checked) state.selected.add(key); else state.selected.delete(key); updateSelected(); } } }) : '—'),
        ...review.columns.map(column => h('td', { 'data-label': column, text: group.row[column] ?? '' })),
        h('td', { 'data-label': '审核状态' }, badge(statusText(entries), { tone: entries.every(approved) ? 'success' : 'neutral' })),
        h('td', { 'data-label': '操作' }, h('div', { class: 'stack-2' }, button({ label: editable ? '编辑明细' : '查看明细', size: 'sm', onClick: () => editGroup(group) }),
          ...[...new Set(entries.map(reason).filter(Boolean))].map(text => h('small', { text })))));
    });
    content.append(h('div', { class: 'service-table-scroll service-table-scroll--review', tabindex: 0, 'aria-label': '时长复核汇总表，可左右滚动' },
      h('table', { class: 'service-table service-review-table' }, h('thead', {}, h('tr', {}, ...['选择', ...review.columns, '审核状态', '操作'].map(text => h('th', { text })))), h('tbody', {}, ...rows))));
    updateSelected();
  }
  async function load() {
    const current = ++sequence, suffix = query(); review = null; members = new Map(); state.selected.clear(); render();
    clear(memberFeedback);
    try {
      const result = await request(`${root}/hours-review${suffix}`);
      if (current !== sequence) return;
      review = result; render();
      if (focusPending) { node.scrollIntoView({ block: 'start' }); focusPending = false; }
      try {
        const context = await request(`${root}/members${suffix}`);
        if (current !== sequence) return;
        members = new Map(context.people.map(p => [p.id, p]));
        if (context.warning) memberFeedback.append(notice(context.warning, { tone: 'warning' }));
        render();
      } catch { if (current === sequence) memberFeedback.append(notice('成员资料暂不可用，身份筛选中的缺失资料显示待确认。', { tone: 'warning' })); }
    } catch (error) { if (current === sequence) { clear(content); content.append(notice(error.message || '加载失败', { tone: 'warning' }), button({ label: '重试', onClick: load })); } }
  }
  async function download() {
    await downloadFile(`${root}/hours-export${query()}`, `${state.month ? `${state.month}献血车` : event['活动名称']}-志愿时长录入表.xlsx`);
  }
  async function approveSelection() {
    if (busy || !review) return;
    const items = visible.filter(g => state.selected.has(g.ids[0])).flatMap(groupEntries).filter(canEdit).map(e => ({ id: e._id, expectedDigest: e['核对摘要'] }));
    if (!items.length) { notify.warning('请先勾选需要审核的名单'); return; }
    if (items.length > 200) { notify.warning('一次最多审核200条服务记录，请减少勾选人数'); return; }
    busy = true; updateSelected();
    try {
      const out = await request(`${root}/hours-approve`, { method: 'POST', body: { items, month: state.month } });
      clear(feedback); feedback.append(notice(`通过 ${out.succeeded} 条服务记录，${out.failed} 条未完成。${out.results.filter(r => !r.ok).map(r => r.message).join('；')}`, { tone: out.failed ? 'warning' : 'success' }));
      state.selected.clear();
      if (out.succeeded && !out.failed) { state.filter = 'approved'; filter.control.value = 'approved'; }
      if (out.failed) notify.warning('部分记录未通过', out.results.filter(r => !r.ok).map(r => r.message).join('；'));
      else notify.success(`已通过 ${out.succeeded} 条服务记录`);
      if (out.succeeded && !out.failed) {
        try { await download(); } catch (error) { reportError(error, '审核已完成，下载未完成；可点击导出重试'); }
      }
      if (!await onSaved()) await load();
    } catch (error) { reportError(error, '审核未完成'); }
    finally { busy = false; updateSelected(); }
  }
  function editGroup(group) {
    const entries = groupEntries(group), forms = [], body = h('div', { class: 'stack-4' });
    body.append(notice(`${group.row.姓名} · ${group.row.院系} · ${group.row.学号}。身份信息不可编辑。多次服务逐条修改，保存后自动重新汇总，避免把总时长重复写入每次服务。`, { tone: 'neutral' }));
    for (const entry of entries) {
      const registration = review.registrations.find(r => r._id === entry['报名行ID']);
      const sourceEvent = review.events.find(e => e['活动ID'] === entry['活动ID']);
      const values = entryValues(entry, registration, sourceEvent), editable = canEdit(entry);
      const section = h('section', { class: 'stack-3' }, h('h3', { text: `${registration['报名日期']} ${registration['报名时段']}` }), h('p', { class: 't-caption', text: sourceEvent['活动名称'] }));
      if (editable) {
        const form = hoursFields(values); forms.push({ id: entry._id, expectedDigest: entry['核对摘要'], form, initial: form.values() }); section.append(form.node);
        section.append(button({ label: '退回修改', variant: 'ghost', size: 'sm', onClick: () => returnEntry(entry, drawer) }));
      } else section.append(notice(reason(entry), { tone: 'neutral' }), h('pre', { class: 'service-detail-text', text: `${values.location}\n${values.dates}\n培训 ${values.trainingHours} / 交通 ${values.travelHours} / 服务 ${values.serviceHours} 小时\n${values.work}\n${values.remark}` }));
      if (entry['修订人']) section.append(h('small', { text: `最近修改：${entry['修订人']} · ${entry['修订时间']}` }));
      body.append(section);
    }
    let saving = false;
    const save = button({ label: '保存修改', variant: 'primary', onClick: async () => {
      if (saving || !forms.every(f => f.form.valid())) return;
      const changed = forms.filter(f => JSON.stringify(f.form.values()) !== JSON.stringify(f.initial));
      if (!changed.length) { drawer.close(); return; }
      saving = true; save.disabled = true;
      try {
        const out = await request(`${root}/hours-edit`, { method: 'POST', body: { month: state.month, items: changed.map(f => ({ id: f.id, expectedDigest: f.expectedDigest, details: f.form.values() })) } });
        for (const result of out.results.filter(r => r.ok)) { const f = forms.find(f => f.id === result.id); f.expectedDigest = result.result['核对摘要']; f.initial = f.form.values(); }
        if (out.failed) notify.warning(`已保存 ${out.succeeded} 条，${out.failed} 条未保存`, out.results.filter(r => !r.ok).map(r => r.message).join('；'));
        else { drawer.close(); notify.success('已保存修改，汇总与预览已更新，仍待审核'); }
        state.selected.clear(); if (!await onSaved()) await load();
      } catch (error) { reportError(error, '保存未完成，输入已保留'); }
      finally { saving = false; save.disabled = false; }
    } });
    const drawer = openDrawer({ title: `${group.row.姓名} · 服务明细`, width: 760, body, footer: forms.length ? [save] : [] });
  }
  function returnEntry(entry, parent) {
    const reason = field({ label: '修改说明', required: true, multiline: true, maxlength: 500 });
    let returning = false;
    const submit = button({ label: '确认退回', onClick: async () => {
      if (returning || !reason.control.reportValidity()) return;
      returning = true; submit.disabled = true;
      try { await request(`/api/volunteer/workflow/hours/${entry._id}/return`, { method: 'POST', body: { reason: reason.control.value, expectedDigest: entry['核对摘要'] } }); drawer.close(); parent.close(); if (!await onSaved()) await load(); }
      catch (error) { reportError(error, '退回未完成'); }
      finally { returning = false; submit.disabled = false; }
    } });
    const drawer = openDrawer({ title: '退回修改', body: reason, footer: [submit] });
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
        table.append(h('p', { text: `共 ${rows.length} 人，每人一行。${selectedScope === 'export' ? '与实际Excel导出内容一致。' : '当前筛选范围，含尚未通过的记录。'}` }), h('div', { class: 'service-sheet-scroll', tabindex: 0 },
          h('table', { class: 'service-sheet' }, h('thead', {}, h('tr', {}, ...review.columns.map(text => h('th', { text })))), h('tbody', {}, ...rows.map(row => h('tr', {}, ...review.columns.map(column => h('td', { text: row[column] ?? '' }))))))));
      } catch (error) { if (requestId === revision) table.append(notice(error.message, { tone: 'warning' })); }
    }
    area.append(field({ label: '预览范围', value: selectedScope, options: [{ value: 'current', label: '当前筛选名单（审核前可看）' }, { value: 'export', label: '已通过名单（实际导出内容）' }], onInput: e => { selectedScope = e.target.value; void show(); } }), table); await show();
  }
  const filter = field({ label: '状态筛选', value: state.filter, options: [{ value: 'todo', label: '待审核' }, { value: 'approved', label: '已通过' }, { value: 'returned', label: '退回待改' }, { value: 'all', label: '全部名单' }], onInput: e => { state.filter = e.target.value; render(); } });
  const choice = (label, key, options) => field({ label, value: state[key], options, onInput: e => { state[key] = e.target.value; render(); } });
  const selectAll = button({ label: '全选当前可审核名单', onClick: () => { for (const group of visible) if (groupEntries(group).some(canEdit)) state.selected.add(group.ids[0]); render(); } });
  const approveButton = button({ label: '审核通过并导出 Excel', variant: 'primary', onClick: approveSelection });
  const monthField = blood ? field({ label: '献血车汇总月份', type: 'month', value: state.month, required: true, onInput: e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) { state.month = e.target.value; void load(); } } }) : null;
  const node = h('section', { class: 'service-workspace stack-4', 'aria-label': '时长审核与导出' },
    h('h3', { text: '⑤ 时长审核与导出' }), h('p', { class: 't-caption', text: '核对汇总表 → 如有问题直接编辑明细 → 勾选审核 → 导出给主任团录入第二课堂。' }),
    h('div', { class: 'row-2 row-wrap' }, button({ label: '在线预览表', onClick: preview }), button({ label: '导出已通过名单', onClick: async () => { try { await download(); } catch (error) { reportError(error, '暂不可下载'); } } }), button({ label: '← 返回④签到录入', variant: 'ghost', onClick: () => onNavigate('checkins') })),
    monthField,
    counts, h('div', { class: 'service-tools' }, h('input', { class: 'input', type: 'search', 'aria-label': '搜索参与者', placeholder: '搜索姓名、学号或院系', value: state.search, on: { input: e => { state.search = e.target.value; render(); } } }), filter,
      choice('红会身份', 'membership', [{ value: '', label: '全部身份' }, { value: 'member', label: '红会成员' }, { value: 'volunteer', label: '普通志愿者' }, { value: 'unknown', label: '待确认' }]),
      choice('所属中心', 'center', [{ value: '', label: '全部中心' }, ...['博爱中心', '生命中心', '综事中心', '苏州', '主席团 / 指导组', '工作组'].map(value => ({ value, label: value }))]),
      choice('排列方式', 'sort', [{ value: 'time', label: '报名时间' }, { value: 'name', label: '姓名' }, { value: 'id', label: '学号' }])),
    memberFeedback, feedback, h('div', { class: 'service-batch-bar' }, selectedText, selectAll, button({ label: '取消选择', variant: 'ghost', onClick: () => { state.selected.clear(); render(); } }), approveButton), content);
  node.focusWorkspace = () => { if (review) node.scrollIntoView({ block: 'start' }); else focusPending = true; };
  void load(); return node;
}
