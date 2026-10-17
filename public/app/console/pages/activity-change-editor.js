import { h } from '../../core/dom.js';
import { request } from '../../core/api.js';
import { button, field, notice, badge } from '../../ui/primitives.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { protectDrawerDraft } from '../../ui/drawer-draft.js';
import { activityChangePatch, isActivityChangeSupported } from '../../shared/activity-change.js';
export { isActivityChangeSupported } from '../../shared/activity-change.js';

const pathFor = event => `/api/volunteer/workflow/events/${encodeURIComponent(event._id || event['活动ID'])}/change-request`;
const statusLabels = { pending: '待审核', applying: '应用结果待核实', approved: '变更已通过', returned: '已退回' };
function comparison(changes) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'activity-change-comparison' },
    h('caption', { class: 'sr-only', text: '活动修改前后对比' }),
    h('thead', {}, h('tr', {}, ...['修改项目', '修改前', '修改后'].map(text => h('th', { scope: 'col', text })))),
    h('tbody', {}, ...changes.map(change => h('tr', {}, h('th', { scope: 'row', text: change.field }),
      h('td', { text: String(change.before ?? '') || '未填写' }), h('td', { text: String(change.after ?? '') || '未填写' }))))));
}

export function openActivityChangeDrawer({ event, registrations = [], onSaved = async () => {} }) {
  const body = h('div', { class: 'activity-change-editor stack-4' });
  const feedback = h('p', { role: 'status', 'aria-label': '活动变更状态', 'aria-live': 'polite' });
  const footer = h('div', { class: 'row-2 row-wrap' });
  let closed = false, busy = false, protection;
  const drawer = openDrawer({ title: '活动变更申请', eyebrow: '活动管理 · 重新审核', width: 960,
    body, footer: [feedback, footer], beforeClose: () => !busy, onClose: () => { closed = true; } });
  async function changed() {
    try { await onSaved(); }
    catch { feedback.textContent = '操作已保存，页面刷新失败，请稍后重新加载活动。'; }
  }
  function protect() {
    protection = protectDrawerDraft(drawer, { isBusy: () => busy });
  }
  async function load(id) {
    body.replaceChildren(notice('正在读取正式活动与变更申请…', { tone: 'neutral' }));
    footer.replaceChildren();
    try {
      const result = await request(pathFor(event) + (id ? `?request=${encodeURIComponent(id)}` : ''), { fresh: true });
      if (closed) return;
      if (result.result) renderEntry(result.result);
      else if (result.canSubmit && isActivityChangeSupported(result.event)) renderForm(result.event, result.expectedDigest);
      else body.replaceChildren(notice('当前活动或账号不支持提交变更，请联系活动负责人。', { tone: 'neutral' }));
    } catch (error) {
      if (!closed) body.replaceChildren(notice(error.message || '变更申请读取失败', { tone: 'warning' }), button({ label: '重新读取变更', onClick: () => load(id) }));
    }
  }
  function renderEntry(entry) {
    const proposal = entry.proposal;
    body.replaceChildren(h('div', { class: 'row-2 row-wrap' }, badge(statusLabels[entry.status] || '状态待核对'), h('strong', { text: event['活动名称'] })),
      notice('审核通过前，正式活动和已有报名保持原状。', { tone: 'neutral' }), comparison(proposal.changes));
    if (entry.reason) body.append(notice(`审核说明：${entry.reason}`, { tone: 'neutral' }));
    footer.replaceChildren();
    if (entry.status === 'pending' && entry.canReview) {
      const reason = field({ label: '退回原因', multiline: true, rows: 2, maxlength: 500 });
      body.append(reason);
      const approve = button({ label: '通过变更', variant: 'primary', onClick: () => review('approve') });
      const reject = button({ label: '退回变更', onClick: () => review('return') });
      footer.append(approve, reject);
      async function review(decision) {
        if (busy) return;
        if (decision === 'return' && !reason.control.value.trim()) { feedback.textContent = '请填写退回原因。'; reason.control.focus(); return; }
        busy = true; approve.disabled = reject.disabled = true;
        try {
          if (!await confirmAction({ title: decision === 'approve' ? '通过活动变更？' : '退回活动变更？', description: decision === 'approve' ? '通过后更新正式活动，保留原活动编号和已有报名记录。' : '正式活动保持不变，申请人可核对后重新申请。', confirmLabel: decision === 'approve' ? '确认通过变更' : '确认退回变更' })) return;
          const result = await request(`${pathFor(event)}/${encodeURIComponent(proposal.id)}/review`, { method: 'POST', body: { version: entry.version, decision, reason: decision === 'return' ? reason.control.value.trim() : '' } });
          if (closed) return;
          renderEntry(result.result); feedback.textContent = decision === 'approve' ? '活动变更已通过。' : '活动变更已退回。';
          protection?.markSaved(); await changed();
        } catch (error) {
          if (!closed) { feedback.textContent = error.message || '审核结果待核实，请刷新申请状态。'; footer.append(button({ label: '核对申请状态', onClick: () => load(proposal.id) })); }
        } finally { busy = false; approve.disabled = reject.disabled = false; }
      }
    } else if (entry.status === 'applying') {
      body.append(notice('上一次应用结果尚未确认，请勿重复提交新申请。', { tone: 'warning' }));
      if (entry.canReview) footer.append(button({ label: '核对应用结果', onClick: async () => {
        if (busy) return; busy = true;
        try {
          const result = await request(`${pathFor(event)}/${encodeURIComponent(proposal.id)}/review`, { method: 'POST', body: { version: entry.version, decision: entry.decision, reason: entry.reason || '' } });
          if (!closed) { renderEntry(result.result); protection?.markSaved(); await changed(); }
        } catch (error) { if (!closed) feedback.textContent = error.message || '应用结果仍待核实。'; }
        finally { busy = false; }
      } }));
    } else if (entry.status === 'returned') {
      footer.append(button({ label: '重新填写变更申请', onClick: () => load() }));
    }
    footer.append(button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }));
    protect();
  }
  function renderForm(current, expectedDigest) {
    const config = JSON.parse(current['报名页配置'] || '{}'), hasRegistrations = registrations.length > 0;
    const controls = new Map();
    const definitions = [
      ['活动名称', 'text'], ['地点', 'text'], ['容量', 'number'], ['工作内容', 'text', true], ['通知草稿', 'text', true],
      ...(config.window ? [['windowStart', 'datetime-local'], ['windowEnd', 'datetime-local']] : [['报名日期', 'date'], ['报名时段', 'text']]),
      ['服务时长', 'number'], ['培训时长', 'number'], ['交通时长', 'number'],
    ];
    const form = h('div', { class: 'activity-change-fields' });
    const preview = h('div', { class: 'activity-change-preview' });
    let previewPatch, uncertain = false;
    const requestId = crypto.randomUUID();
    const submit = button({ label: '提交变更审核', variant: 'primary', onClick: async () => {
      if (busy || uncertain || !previewPatch) return;
      busy = true; submit.disabled = true; form.inert = true;
      try {
        await request(pathFor(current), { method: 'POST', body: { requestId, patch: previewPatch, expectedDigest } });
        if (closed) return;
        protection?.release(); feedback.textContent = '变更申请已提交，正式活动尚未修改。';
        await load(requestId); await changed();
      } catch (error) {
        if (closed) return;
        feedback.textContent = error.message || '提交失败，输入已保留。';
        if (!error.status || error.status >= 500 || error.status === 408) {
          uncertain = true; feedback.textContent = '提交结果待核实，输入已保留，请先核对申请状态。';
          footer.append(button({ label: '核对提交结果', onClick: async () => {
            try {
              const result = await request(`${pathFor(current)}?request=${encodeURIComponent(requestId)}`, { fresh: true });
              if (!closed && result.result) { renderEntry(result.result); protection?.markSaved(); await changed(); }
            } catch (readError) { if (!closed) feedback.textContent = readError.status === 404 ? '尚未查到申请，请保留当前输入，稍后再次核对。' : '暂时无法核实提交结果，请稍后再试。'; }
          } }));
        }
      } finally { busy = false; form.inert = false; submit.disabled = uncertain || !previewPatch; }
    } });
    submit.disabled = true;
    for (const [name, type, multiline] of definitions) {
      const scheduling = ['windowStart', 'windowEnd', '报名日期', '报名时段', '服务时长', '培训时长', '交通时长'].includes(name);
      const value = name === 'windowStart' ? config.window.start.slice(0, 19) : name === 'windowEnd' ? config.window.end.slice(0, 19) : current[name] ?? '';
      const node = field({ label: name === 'windowStart' ? '活动开始时间' : name === 'windowEnd' ? '活动结束时间' : name,
        value, type, multiline, rows: name === '通知草稿' ? 5 : 3, required: true });
      if (type === 'number') { node.control.min = name === '容量' ? '1' : '0'; node.control.step = name === '容量' ? '1' : 'any'; }
      if (type === 'datetime-local') node.control.step = '1';
      node.control.disabled = hasRegistrations && scheduling;
      node.control.addEventListener('input', () => { previewPatch = null; submit.disabled = true; preview.replaceChildren(); });
      controls.set(name, node.control); form.append(node);
    }
    const showPreview = button({ label: '预览变更对比', onClick: async () => {
      if (busy || uncertain || [...controls.values()].some(control => !control.disabled && !control.reportValidity())) return;
      busy = true; form.inert = true; showPreview.disabled = true; submit.disabled = true; previewPatch = null;
      try {
        const patch = activityChangePatch(current, Object.fromEntries([...controls].map(([key, control]) => [key, control.value])));
        if (!Object.keys(patch).length) { feedback.textContent = '尚未修改任何信息。'; return; }
        const result = await request(`${pathFor(current)}/preview`, { method: 'POST', body: { patch, expectedDigest } });
        if (closed) return;
        previewPatch = result.result.patch; preview.replaceChildren(comparison(result.result.changes));
        feedback.textContent = '请核对修改前后对比，再提交审核。'; submit.disabled = false;
      } catch (error) { feedback.textContent = error.message; }
      finally { busy = false; form.inert = false; showPreview.disabled = false; }
    } });
    body.replaceChildren(notice('这是变更草稿，提交后等待审核。审核通过前，公众端仍使用原活动信息。', { tone: 'neutral' }),
      ...(hasRegistrations ? [notice('已有报名记录，日期、时段和时长规则保持原样。', { tone: 'neutral' })] : []), form, preview);
    footer.replaceChildren(showPreview, submit, button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }));
    protect();
  }
  void load();
  return drawer;
}

export function activityChangePanel({ event, registrations = [], onSaved }) {
  const node = h('div', { class: 'activity-change-status' });
  request(pathFor(event), { fresh: true }).then(result => {
    if (!node.isConnected) return;
    if (result.result) node.append(notice(`活动有一份变更申请：${statusLabels[result.result.status] || '待核对'}。`, { tone: 'neutral' }),
      button({ label: '查看活动变更', size: 'sm', onClick: () => openActivityChangeDrawer({ event, registrations, onSaved }) }));
  }).catch(error => {
    if (node.isConnected && error.status !== 403) node.append(notice('活动变更状态暂时无法读取，可通过「活动信息修改」重试。', { tone: 'neutral' }));
  });
  return node;
}
