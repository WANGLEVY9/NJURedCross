import { h } from '../../core/dom.js';
import { button, field, checkbox, pageHead, notice, definitionList } from '../../ui/primitives.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { materialServices } from '../../shared/material-services.js';
import { materialEmpty, materialSection } from '../../shared/material-ui.js';
import { reimbursementsApi as api, reimbursementAmount, operationKey } from '../../shared/reimbursements-api.js';
import { pdfPreview } from '../../shared/pdf-preview.js';
import { asyncRegion } from '../lib.js';

function localDate() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }); }

export default async function summaryPage() {
  const activity = field({ label: '选择活动', name: 'summaryActivity', searchable: true, options: [{ value: '', label: '请选择活动' }] });
  const handlerName = field({ label: '经办人', name: 'summaryHandlerName', required: true, maxlength: 50 });
  const handlerPhone = field({ label: '联系电话', name: 'summaryHandlerPhone', required: true, maxlength: 50 });
  const fillDate = field({ label: '填报日期', name: 'summaryFillDate', type: 'date', value: localDate(), required: true });
  const merge = checkbox({ label: '合并相同项目与备注', name: 'summaryMerge', description: '保留每行对应的原申请；不同备注仍分行。' });
  const feedback = h('div', { aria: { live: 'polite' } });
  const selectionCount = h('p', { class: 't-secondary', aria: { live: 'polite' } });
  const candidatesSlot = h('div', { class: 'material-finance-list' });
  const activityInfo = h('div');
  const historySlot = h('div', { class: 'material-finance-list' });
  let activities = [], requests = [], history = [], selected = new Set(), candidates = [], disposed = false;
  const preview = button({ label: '预览汇总表', variant: 'primary', onClick: openPreview });
  const currentActivity = () => activities.find(item => item.id === activity.control.value);
  const data = asyncRegion({ load: async () => {
    const [a, r, s] = await Promise.all([api.activities(), api.list(), api.summaries()]); return { activities: a.activities, requests: r.requests, summaries: s.summaries };
  }, errorTitle: '活动汇总暂不可用', render: payload => {
    activities = payload.activities; requests = payload.requests; history = payload.summaries;
    const previousId = activity.control.value;
    activity.control.replaceChildren(h('option', { value: '', text: '请选择活动' }),
      ...activities.map(item => h('option', { value: item.id, text: `${item.name}${item.date ? ` · ${item.date}` : ''}` })));
    activity.control.value = activities.some(item => item.id === previousId) ? previousId : activities[0]?.id || '';
    renderCandidates(!previousId);
    return [h('section', { class: 'panel material-summary-panel' },
      h('div', { class: 'panel__body stack-5' },
        h('div', { class: 'material-summary-toolbar' }, activity,
          button({ label: '新建活动资料', variant: 'secondary', iconName: 'plus', onClick: () => editActivity() }),
          button({ label: '编辑活动资料', variant: 'ghost', onClick: () => { const item = currentActivity(); if (item) editActivity(item); } })), activityInfo,
        materialSection('选择已审核申请', '默认勾选本活动尚未汇总的申请，可按需要调整。'), candidatesSlot,
        h('div', { class: 'formgrid' }, handlerName, handlerPhone, fillDate), merge, feedback),
      h('footer', { class: 'panel__foot material-submit-bar' }, selectionCount, preview)),
    h('section', { class: 'stack-4' }, materialSection('已生成的汇总', '生成后保留申请与材料版本，可重新下载。'), historySlot)];
  } });
  activity.control.addEventListener('change', () => { feedback.replaceChildren(); renderCandidates(true); });
  function updateCount() {
    const chosen = candidates.filter(item => selected.has(item.id));
    selectionCount.textContent = `已选择 ${chosen.length} 笔 · ${reimbursementAmount(chosen.reduce((sum, item) => sum + item.amountCents, 0))}`;
    preview.disabled = !chosen.length;
  }
  function renderCandidates(selectDefault = false) {
    const item = currentActivity();
    candidates = requests.filter(request => request.activityId === item?.id && request.summaryEligibility?.eligible);
    selected = selectDefault ? new Set(candidates.slice(0, 20).map(request => request.id)) : new Set([...selected].filter(id => candidates.some(request => request.id === id)));
    activityInfo.replaceChildren(item ? h('details', { class: 'material-originals' }, h('summary', { text: '查看活动资料' }),
      definitionList([['活动名称', item.name], ['日期 / 地点', `${item.date || '待补充'} · ${item.location || '待补充'}`],
        ['活动人数', item.participantCount ?? '待补充'], ['目的与内容', item.description || '待补充'],
        ['单位名称', item.unitName || '待补充'], ['经费卡号', item.fundAccount || '待补充']]))
      : notice('请先创建活动资料，后续申请使用同一个活动关联。', { tone: 'neutral' }));
    candidatesSlot.replaceChildren(...candidates.map(request => {
      const choose = checkbox({ name: `summary-${request.id}`, label: `${request.name} · ${reimbursementAmount(request.amountCents)}`,
        description: `${request.code} · ${request.purpose}`, checked: selected.has(request.id), onChange: value => {
          if (value && selected.size >= 20) { choose.control.checked = false; choose.dataset.checked = 'false'; feedback.replaceChildren(notice('一次最多汇总 20 笔，请分批处理。', { tone: 'warning' })); return; }
          if (value) selected.add(request.id); else selected.delete(request.id); updateCount();
        } });
      return h('div', { class: 'material-summary-candidate' }, choose,
        h('details', {}, h('summary', { class: 't-caption', text: `${request.expenseItems.length} 项支出明细` }),
          ...request.expenseItems.map(row => h('p', { class: 't-secondary', text: `${row.label} · ${reimbursementAmount(row.amountCents)}${row.note ? ` · ${row.note}` : ''}` }))));
    }));
    if (!candidates.length) candidatesSlot.append(materialEmpty(item ? '暂无可汇总申请' : '先选择活动', item
      ? '本活动尚无审核通过且明细完整、未纳入汇总的申请。' : '创建或选择活动后查看可汇总申请。', 'file'));
    const unlinked = requests.filter(request => !request.activityId || !request.expenseItems?.length).length;
    if (unlinked) candidatesSlot.append(notice(`${unlinked} 笔申请缺少活动关联或明细，待用户端对接后再参与汇总。`, { tone: 'neutral' }));
    if (candidates.length > 20) candidatesSlot.append(notice('可汇总申请超过 20 笔，本次默认勾选前 20 笔。', { tone: 'neutral' }));
    historySlot.replaceChildren(...history.filter(record => !item || record.activity.id === item.id).map(record => h('div', { class: 'material-finance-row' },
      h('div', { class: 'material-finance-row__body' }, h('b', { text: `${record.activity.name} · ${reimbursementAmount(record.totalCents)}` }),
        h('p', { class: 't-caption', text: `${record.code} · ${record.selections.length} 笔申请 · ${record.rows.length} 行支出` })),
      button({ label: '查看与下载', variant: 'secondary', onClick: () => showRecord(record) }))));
    if (!historySlot.childElementCount) historySlot.append(h('p', { class: 't-secondary', text: '尚未生成汇总表。' }));
    updateCount();
  }
  function editActivity(item = null) {
    const fields = {
      name: field({ label: '活动名称', name: 'activityName', value: item?.name || '', required: true, maxlength: 100 }),
      date: field({ label: '活动日期', name: 'activityDate', type: 'date', value: item?.date || '' }),
      location: field({ label: '活动地点', name: 'activityLocation', value: item?.location || '', maxlength: 100 }),
      participantCount: field({ label: '活动人数', name: 'activityParticipants', type: 'number', min: 1, max: 100000, step: 1, value: item?.participantCount ?? '' }),
      unitName: field({ label: '单位名称', name: 'activityUnit', value: item?.unitName || '南京大学红十字会', maxlength: 100 }),
      fundAccount: field({ label: '经费卡号', name: 'activityFund', value: item?.fundAccount || '', maxlength: 80 }),
      description: field({ label: '开展活动目的及内容', name: 'activityDescription', multiline: true, rows: 4, value: item?.description || '', maxlength: 1000 }),
    };
    const errorSlot = h('div', { aria: { live: 'polite' } });
    const save = button({ label: '保存活动资料', variant: 'primary', onClick: async () => {
      if (save.disabled) return;
      if (!fields.name.control.value.trim()) { fields.name.setError('请填写活动名称'); fields.name.control.focus(); return; }
      save.disabled = true; Object.values(fields).forEach(entry => { entry.control.disabled = true; });
      try {
        const body = Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, entry.control.value.trim()]));
        body.participantCount = body.participantCount === '' ? null : Number(body.participantCount);
        const result = await api.saveActivity({ ...body, ...(item ? { id: item.id, revision: item.revision } : {}) });
        if (disposed) return; activity.control.append(h('option', { value: result.activity.id, text: result.activity.name })); activity.control.value = result.activity.id;
        selected = new Set(); drawer.close(); await data.reload(); renderCandidates(true);
      } catch (error) { errorSlot.replaceChildren(notice(error.message, { tone: 'error' })); }
      finally { save.disabled = false; Object.values(fields).forEach(entry => { entry.control.disabled = false; }); }
    } });
    const drawer = openDrawer({ title: item ? '编辑活动资料' : '新建活动资料', width: 680, body: [h('div', { class: 'stack-4' },
      h('p', { class: 't-secondary', text: '可先保存名称；生成报销表前须补齐下列活动资料。' }), fields.name,
      h('div', { class: 'formgrid' }, fields.date, fields.location, fields.participantCount, fields.unitName, fields.fundAccount), fields.description, errorSlot)], footer: [save] });
  }
  async function openPreview() {
    if (preview.disabled) return;
    const item = currentActivity(); if (!item) return;
    for (const entry of [handlerName, handlerPhone, fillDate]) {
      entry.setError(null); if (!entry.control.value.trim()) { entry.setError('请填写此项'); entry.control.focus(); return; }
    }
    const body = { activityId: item.id, activityRevision: item.revision, selections: candidates.filter(request => selected.has(request.id)).map(request => ({ requestId: request.id, revision: request.revision })),
      mergeSameItems: merge.control.checked, form: { handlerName: handlerName.control.value.trim(), handlerPhone: handlerPhone.control.value.trim(), fillDate: fillDate.control.value }, idempotencyKey: operationKey() };
    preview.disabled = true; preview.dataset.loading = 'true'; feedback.replaceChildren();
    try {
      const result = await api.previewSummary(body); if (disposed) return;
      const summary = result.summary, warnings = h('div', { aria: { live: 'polite' } });
      let closed = false;
      const duplicateCheck = checkbox({ name: 'summaryDuplicateCheck', label: '已人工核对相同材料，没有重复申报金额' });
      const create = button({ label: '生成报销表与材料包', variant: 'primary', onClick: async () => {
        if (create.disabled) return;
        if (summary.duplicateMaterials.length && !duplicateCheck.control.checked) { warnings.replaceChildren(notice('请先核对重复材料并勾选确认。', { tone: 'warning' })); duplicateCheck.control.focus(); return; }
        create.disabled = true; create.dataset.loading = 'true'; duplicateCheck.control.disabled = true;
        try {
          const confirmed = await confirmAction({ title: '确认生成活动汇总？', description: `${summary.activity.name} · ${summary.selections.length} 笔 · ${reimbursementAmount(summary.totalCents)}。生成后标记为已纳入汇总，不表示付款完成。`, confirmLabel: '确认生成' });
          if (!confirmed || closed || disposed) return;
          const generated = await api.createSummary({ ...body, duplicateMaterialsConfirmed: duplicateCheck.control.checked });
          if (closed || disposed) { if (!disposed) await data.reload(); return; }
          const display = recordBody(generated.summary); drawer.setBody(display); drawer.setFooter(button({ label: '完成', variant: 'secondary', onClick: () => drawer.close() }));
          disposePreview = () => display.dispose(); await data.reload();
        } catch (error) { warnings.replaceChildren(notice(error.message, { tone: 'error', title: '生成未完成，申请未重复纳入' })); }
        finally { create.disabled = false; delete create.dataset.loading; duplicateCheck.control.disabled = false; }
      } });
      let disposePreview = () => {};
      const drawer = openDrawer({ title: '活动报销表预览', width: 860, body: [formTable(summary),
        summary.duplicateMaterials.length ? h('div', { class: 'stack-3 material-summary' },
          notice(`有 ${summary.duplicateMaterials.length} 份字节相同的材料出现在多笔申请中，请核对是否重复申报或合理分摊。`, { tone: 'warning' }), duplicateCheck) : null,
        h('p', { class: 't-secondary', text: `后附 ${summary.selections.length} 笔申请材料，共 ${summary.attachmentPages} 页。审批签字与公章栏留空。` }), warnings],
      footer: [create], onClose: () => { closed = true; disposePreview(); } });
    } catch (error) { feedback.replaceChildren(notice(error.message, { tone: 'error', title: '暂不能生成汇总' })); }
    finally { delete preview.dataset.loading; updateCount(); }
  }
  function showRecord(record) {
    const display = recordBody(record);
    openDrawer({ title: `${record.activity.name} · ${record.code}`, width: 860, body: [display], onClose: () => display.dispose() });
  }
  return { title: '活动报销汇总', crumb: '活动报销汇总', node: h('div', { class: 'view wspad wspad--wide material-summary' },
    materialServices('finance', { console: true }), pageHead({ label: '财务报销', title: '活动报销汇总', description: '将同一活动的多笔已审核申请汇总为一张报销表，并合并对应材料。',
      actions: [button({ label: '返回报销审核', variant: 'secondary', href: '/console/reimbursements' })] }), data), dispose: () => { disposed = true; } };
}

function formTable(summary) {
  const item = summary.activity;
  const cells = values => h('tr', {}, ...values.map(value => h('td', { text: value })));
  return h('div', { class: 'material-summary-form stack-4' }, h('h2', { class: 't-h2', text: '南京大学活动费报销表' }),
    h('p', { class: 't-secondary', text: `经办人：${summary.form.handlerName} · 联系电话：${summary.form.handlerPhone} · 填报日期：${summary.form.fillDate}` }),
    h('table', { class: 'material-summary-meta' }, h('tbody', {}, cells(['单位名称', item.unitName, '经费卡号', item.fundAccount]),
      cells(['活动名称', item.name, '活动日期', item.date]), cells(['活动人数', String(item.participantCount), '活动地点', item.location]),
      h('tr', {}, h('td', { text: '开展活动目的及内容' }), h('td', { colspan: 3, text: item.description })))),
    h('table', { class: 'material-summary-lines' }, h('thead', {}, h('tr', {}, ...['支出项目', '金额（元）', '备注'].map(label => h('th', { scope: 'col', text: label })))),
      h('tbody', {}, ...summary.rows.map(row => cells([row.label, (row.amountCents / 100).toFixed(2), row.note])), cells(['合计金额', (summary.totalCents / 100).toFixed(2), `大写：${summary.amountUpper}`]))),
    h('div', { class: 'material-summary-signatures' }, h('span', { text: '单位负责人审批：' }), h('span', { text: '单位公章：' })),
    h('details', { class: 'material-originals' }, h('summary', { text: `查看 ${summary.selections.length} 笔来源申请` }),
      ...summary.selections.map(selection => h('p', { class: 't-secondary', text: `${selection.code} · ${selection.applicant} · 第 ${selection.revision} 版 · ${reimbursementAmount(selection.amountCents)}` }))));
}
function recordBody(record) {
  const pdf = pdfPreview(record.formUrl);
  const links = [button({ label: '下载活动报销表', variant: 'secondary', iconName: 'download', href: record.formUrl }),
    button({ label: '下载完整材料包', variant: 'primary', iconName: 'download', href: record.packetUrl })];
  links.forEach(link => link.setAttribute('download', ''));
  const node = h('div', { class: 'stack-4' }, notice(`汇总已生成：${record.code}。仅纳入审核通过材料，不登记付款。`, { tone: 'success' }),
    h('div', { class: 'row-3 row-wrap' }, ...links), pdf,
    h('details', { class: 'material-originals' }, h('summary', { text: '查看汇总明细与来源' }), formTable(record),
      ...(record.attachments || []).map(source => h('p', { class: 't-secondary', text: `${record.selections.find(selection => selection.requestId === source.requestId)?.code || ''} · 材料包第 ${source.startPage}–${source.endPage} 页` }))));
  node.dispose = () => pdf.dispose(); return node;
}
