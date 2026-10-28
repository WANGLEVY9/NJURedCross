import { h } from '../../core/dom.js';
import { editFinanceRequest } from '../reimbursement-request-edit.js';
import { reimbursementCategoryOptions, reimbursementActivityCategory } from '../../shared/reimbursement-activities.js';
import { getAccountProfile } from '../../core/api.js';
import { button, field, checkbox, pageHead, notice, definitionList } from '../../ui/primitives.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { materialServices } from '../../shared/material-services.js';
import { materialEmpty, materialSection } from '../../shared/material-ui.js';
import { reimbursementsApi as api, reimbursementAmount, operationKey } from '../../shared/reimbursements-api.js';
import { pdfPreview } from '../../shared/pdf-preview.js';
import { REIMBURSEMENT_FORM_FUND_ACCOUNT } from '../../shared/reimbursement-form.js';
import { asyncRegion } from '../lib.js';
import { financeNavigation, financeRowKey, financeTable } from '../reimbursement-finance-nav.js';
import { reimbursementCrossChecks } from '../../shared/reimbursement-cross-checks.js';

function localDate() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }); }

export default async function summaryPage() {
  const initialConfig = await api.config(), useWorkspace = initialConfig.workflow?.financeWorkspace === true;
  if (useWorkspace && !new URLSearchParams(location.search).has('activity')) {
    const { default: financePage } = await import('./reimbursement-finance.js');
    return financePage({ view: 'activities' });
  }
  const activity = field({ label: '选择活动', name: 'summaryActivity', searchable: true, options: [{ value: '', label: '请选择活动' }] });
  const handlerName = field({ label: '经办人', name: 'summaryHandlerName', required: true, maxlength: 50 });
  const handlerPhone = field({ label: '联系电话', name: 'summaryHandlerPhone', required: true, maxlength: 50, hint: '自动使用终审账号联系电话；账号未填写时可在此补齐。' });
  const fillDate = field({ label: '填报日期', name: 'summaryFillDate', type: 'date', value: localDate(), required: true });
  const merge = checkbox({ label: '合并相同项目与备注', name: 'summaryMerge', description: '保留每行对应的原申请；不同备注仍分行。' });
  const feedback = h('div', { aria: { live: 'polite' } });
  const selectionCount = h('p', { class: 't-secondary', aria: { live: 'polite' } });
  const candidatesSlot = h('div', { class: 'material-finance-list' });
  const orderSlot = h('div', { class: 'stack-3 material-summary-order' });
  let itemOrder = [], activityReview = false, draftAttempt = null, financeItems = [], operator = {}, openedRecord = false;
  const settlements = new Map();
  const activityInfo = h('div');
  const historySlot = h('div', { class: 'material-finance-list' });
  let activities = [], requests = [], history = [], selected = new Set(), candidates = [], disposed = false;
  let mayGenerate = false, loaded = false;
  const preview = button({ label: '生成报销单和合并材料', variant: 'primary', onClick: openPreview });
  const currentActivity = () => activities.find(item => item.id === activity.control.value);
  const editHint = h('p', { id: 'summary-activity-edit-hint', class: 'material-summary-edit-hint', hidden: true, aria: { live: 'polite' } });
  const edit = button({ label: '编辑活动资料', variant: 'primary', onClick: () => {
    const item = currentActivity(); if (item) { clearEditHint(); editActivity(item); }
  } });
  const editEntry = h('div', { class: 'material-summary-edit-entry' }, edit, editHint);
  function clearEditHint() {
    editHint.hidden = true; editHint.textContent = ''; edit.classList.remove('is-attention'); edit.removeAttribute('aria-describedby');
  }
  function promptActivityEdit(message) {
    feedback.replaceChildren(notice(message, { tone: 'error', title: '暂不能生成汇总' }));
    editHint.textContent = '从这里补齐活动资料，再预览汇总表。'; editHint.hidden = false;
    edit.classList.add('is-attention'); edit.setAttribute('aria-describedby', editHint.id);
    editEntry.scrollIntoView({ behavior: 'smooth', block: 'center' }); edit.focus({ preventScroll: true });
  }
  const data = asyncRegion({ load: async () => {
    const [a, r, s, config] = await Promise.all([api.activities(), api.list(), api.summaries(), api.config()]);
    const finance = useWorkspace ? await api.finance() : { operator: {}, items: r.requests.flatMap(request => request.expenseItems.map(item => ({
      requestId: request.id, itemId: item.id, label: item.label, amountCents: item.amountCents, applicant: request.name,
      activityId: request.activityId, status: request.status, canSummarize: request.summaryEligibility?.eligible,
    }))) };
    financeItems = finance.items; operator = finance.operator;
    if (useWorkspace && !operator.phone) {
      try { operator.phone = (await getAccountProfile()).account?.phone || ''; } catch { /* Missing profile stays an explicit required field. */ }
    }
    handlerName.control.value = operator.name || handlerName.control.value; handlerName.control.readOnly = Boolean(operator.name);
    handlerPhone.control.value = operator.phone || handlerPhone.control.value; handlerPhone.control.readOnly = Boolean(operator.phone);
    mayGenerate = config.workflow?.permissions?.includes('final') === true; activityReview = config.workflow?.activityReview === true;
    merge.hidden = activityReview; if (activityReview) merge.control.checked = false;
    preview.hidden = !mayGenerate; edit.hidden = !mayGenerate;
    return { activities: a.activities, requests: r.requests, summaries: s.summaries };
  }, errorTitle: '活动汇总暂不可用', render: payload => {
    activities = payload.activities; requests = payload.requests; history = payload.summaries;
    const previousId = activity.control.value || new URLSearchParams(location.search).get('activity') || '';
    activity.control.replaceChildren(h('option', { value: '', text: '请选择活动' }),
      ...activities.map(item => h('option', { value: item.id, text: `${item.name}${item.date ? ` · ${item.date}` : ''}` })));
    activity.control.value = activities.some(item => item.id === previousId) ? previousId : activities[0]?.id || '';
    renderCandidates(!loaded); loaded = true;
    const linkedRecord = new URLSearchParams(location.search).get('summary');
    if (!openedRecord && linkedRecord) { openedRecord = true; const record = history.find(r => r.id === linkedRecord); if (record) queueMicrotask(() => showRecord(record)); }
    return [h('section', { class: 'panel material-summary-panel' },
      h('div', { class: 'panel__body stack-5' },
        h('div', { class: 'material-summary-toolbar' }, activity,
          editEntry, mayGenerate ? button({ label: '新建活动资料', variant: 'ghost', iconName: 'plus', onClick: () => editActivity() }) : null), activityInfo,
        materialSection('支出条目与材料顺序', '直接勾选具体支出；上移、下移同时调整报销表行和材料顺序。核定金额减少时须填写原因。'), candidatesSlot, orderSlot,
        h('div', { class: 'formgrid' }, handlerName, handlerPhone, fillDate), merge, feedback),
      h('footer', { class: 'panel__foot material-submit-bar' }, selectionCount, preview)),
    h('section', { class: 'stack-4' }, materialSection('已生成的汇总', '草稿可预览核对；终审通过后进入待打款，保留材料版本与排序。'), historySlot)];
  } });
  activity.control.addEventListener('change', () => { feedback.replaceChildren(); clearEditHint(); renderCandidates(true); });
  function updateCount() {
    const entries = financeItems.filter(row => selected.has(financeRowKey(row)));
    const total = entries.reduce((sum, row) => sum + Math.round(Number(settlements.get(financeRowKey(row))?.amount ?? row.amountCents / 100) * 100), 0);
    selectionCount.textContent = `已选择 ${entries.length} 项支出 · 核定合计 ${reimbursementAmount(total)}`;
    preview.disabled = !mayGenerate || !entries.length;
  }
  function renderCandidates(selectDefault = false) {
    const item = currentActivity();
    edit.disabled = !item;
    const eligibleRows = financeItems.filter(row => row.activityId === item?.id && row.canSummarize);
    candidates = requests.filter(request => eligibleRows.some(row => row.requestId === request.id));
    const allowed = new Set(eligibleRows.map(financeRowKey));
    selected = selectDefault ? new Set(eligibleRows.filter(row => candidates.slice(0, 20).some(r => r.id === row.requestId)).map(financeRowKey))
      : new Set([...selected].filter(key => allowed.has(key)));
    activityInfo.replaceChildren(item ? h('details', { class: 'material-originals finance-activity-info' }, h('summary', { class: 't-h4', text: `${item.name} · ${item.category || '未分类'} · 活动资料` }),
      definitionList([['活动名称', item.name], ['举办校区', item.campus || '待补充'], ['日期 / 地点', `${item.date || '待补充'} · ${item.location || '待补充'}`],
        ['活动人数', item.participantCount ?? '待补充'], ['目的与内容', item.description || '待补充']]))
      : notice('请先创建活动资料，后续申请使用同一个活动关联。', { tone: 'neutral' }));
    candidatesSlot.replaceChildren();
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
    if (activityReview) {
      const unfinished = financeItems.filter(row => row.activityId === item?.id && ['pending', 'initial_returned', 'returned'].includes(row.status));
      if (unfinished.length) candidatesSlot.append(notice(`本活动另有 ${unfinished.length} 项尚未完成初审，本批不会纳入，请确认是否等待材料齐全后再生成。`, { tone: 'warning' }));
    }
    renderOrder(); updateCount();
  }
  function renderOrder() {
    const entries = financeItems.filter(row => row.activityId === currentActivity()?.id && row.canSummarize);
    const key = financeRowKey;
    const valid = new Map(entries.map(entry => [key(entry), entry]));
    itemOrder = [...itemOrder.filter(item => valid.has(key(item))).map(item => valid.get(key(item))), ...entries.filter(item => !itemOrder.some(existing => key(existing) === key(item)))];
    const move = (index, direction) => { [itemOrder[index], itemOrder[index + direction]] = [itemOrder[index + direction], itemOrder[index]]; renderOrder(); };
    const crossChecks = new Map(candidates.map(request => [request.id, reimbursementCrossChecks(request, request.bundle, request.bundle.analyses || [])]));
    const rows = itemOrder.map((item, index) => {
      const rowKey = key(item), draft = settlements.get(rowKey) || { amount: (item.amountCents / 100).toFixed(2), reason: '' }; settlements.set(rowKey, draft);
      const choose = h('input', { type: 'checkbox', checked: selected.has(rowKey) || undefined, aria: { label: `纳入${item.label}` }, on: { change: event => {
        const keys = useWorkspace ? [rowKey] : entries.filter(row => row.requestId === item.requestId).map(key);
        keys.forEach(value => event.target.checked ? selected.add(value) : selected.delete(value));
        if (!useWorkspace) renderOrder(); updateCount();
      } } });
      const amount = field({ name: `summary-amount-${rowKey}`, label: '', type: 'number', min: 0, max: item.amountCents / 100, step: '.01', value: draft.amount });
      const reason = field({ name: `summary-reason-${rowKey}`, label: '', maxlength: 300, placeholder: '金额减少时必填原因', value: draft.reason });
      if (!useWorkspace) { amount.control.readOnly = true; reason.control.disabled = true; }
      amount.control.setAttribute('aria-label', `${item.label}核定金额`); reason.control.setAttribute('aria-label', `${item.label}核定原因`);
      amount.control.addEventListener('input', () => { draft.amount = amount.control.value; updateCount(); });
      reason.control.addEventListener('input', () => { draft.reason = reason.control.value; });
      const request = candidates.find(r => r.id === item.requestId), group = crossChecks.get(item.requestId)?.find(g => g.expenseItemId === item.itemId);
      const sharedInvoice = request?.materialRulesVersion === 1 && request.singleOrderConfirmed;
      const invoices = (request?.bundle.analyses || []).filter(a => a.materialKind !== 'supporting' && request.bundle.sources.some(s => s.kind === 'invoice' && (sharedInvoice || s.expenseItemId === item.itemId) && a.page >= s.startPage && a.page <= s.endPage));
      const invoiceSources = request?.bundle.sources.filter(s => s.kind === 'invoice' && (sharedInvoice || s.expenseItemId === item.itemId)) || [];
      const completeInvoices = invoiceSources.length && invoiceSources.every(source => Array.from({ length: source.endPage - source.startPage + 1 }, (_, index) => source.startPage + index).every(page => invoices.some(a => a.page === page)));
      const checked = (label, state) => h('span', { class: `finance-check is-${state}`,
        text: `${state === 'matched' ? '✓' : state === 'different' ? '✕' : '○'} ${label}${state === 'not-applicable' ? '无需核验' : state === 'matched' ? '' : state === 'different' ? '有异常' : '待核对'}` });
      const checks = h('div', { class: 'finance-checks' },
        checked('抬头', completeInvoices && invoices.every(a => a.buyer?.state === 'matched') ? 'matched' : invoices.some(a => a.buyer?.state === 'different') ? 'different' : 'unknown'),
        checked('疑似红章', completeInvoices && invoices.every(a => a.seal?.state === 'candidate') ? 'matched' : 'unknown'),
        checked(group?.amountScope === 'order' ? '订单总额（分摊需人工确认）' : '金额', group?.amount.state || 'unknown'), checked('物资名', group?.name.state || 'unknown'));
      const up = button({ label: '上移', variant: 'ghost', size: 'sm', onClick: () => move(index, -1) }); up.disabled = index === 0; up.setAttribute('aria-label', `上移${item.label}`);
      const down = button({ label: '下移', variant: 'ghost', size: 'sm', onClick: () => move(index, 1) }); down.disabled = index === itemOrder.length - 1; down.setAttribute('aria-label', `下移${item.label}`);
      return h('tr', { data: { summaryItem: item.itemId } }, h('td', {}, choose), h('td', { text: index + 1 }), h('td', { text: item.label }),
        h('td', { text: item.applicant }), h('td', { text: reimbursementAmount(item.amountCents) }), h('td', {}, amount), h('td', {}, reason), h('td', {}, checks),
        h('td', {}, button({ label: '查看材料', variant: 'ghost', size: 'sm', onClick: async () => {
          const { bundleDetails } = await import('../../shared/reimbursement-details.js');
          const request = requests.find(r => r.id === item.requestId), detail = bundleDetails(request.bundle, { request, originalsFirst: true, withPreview: true });
          openDrawer({ title: item.label, width: 1000, body: [detail], onClose: () => detail.dispose?.() });
        } })), h('td', {}, h('div', { class: 'row-2 row-wrap' }, up, down, useWorkspace && mayGenerate ? button({ label: '修改信息', variant: 'ghost', size: 'sm', onClick: () => {
          editFinanceRequest(request, { onDone: async () => { settlements.clear(); await data.reload(); } });
        } }) : null)));
    });
    orderSlot.replaceChildren(financeTable(['纳入', '顺序', '支出项目', '申请人', '原申请金额', '核定金额（元）', '核定原因', '核验提示', '材料', '排序'], rows));
    orderSlot.hidden = !itemOrder.length || !mayGenerate;
  }
  function editActivity(item = null) {
    const fields = {
      name: field({ label: '活动名称', name: 'activityName', value: item?.name || '', required: true, maxlength: 100 }),
      category: field({ label: '活动类别', name: 'activityCategory', value: item?.category ? reimbursementActivityCategory(item) : '',
        options: reimbursementCategoryOptions(item?.category ? reimbursementActivityCategory(item) : '') }),
      campus: field({ label: '活动举办校区', name: 'activityCampus', value: item?.campus || '', options: [{ value: '', label: '请选择校区' }, ...['苏州', '仙林', '鼓楼', '浦口'].map(value => ({ value, label: `${value}校区` }))] }),
      date: field({ label: '活动日期', name: 'activityDate', type: 'date', value: item?.date || '' }),
      location: field({ label: '活动地点', name: 'activityLocation', value: item?.location || '', maxlength: 100 }),
      participantCount: field({ label: '活动人数', name: 'activityParticipants', type: 'number', min: 1, max: 100000, step: 1, value: item?.participantCount ?? '' }),
      description: field({ label: '开展活动目的及内容', name: 'activityDescription', multiline: true, rows: 4, value: item?.description || '', maxlength: 1000 }),
    };
    const errorSlot = h('div', { aria: { live: 'polite' } });
    const save = button({ label: '保存活动资料', variant: 'primary', onClick: async () => {
      if (save.disabled) return;
      if (!fields.name.control.value.trim()) { fields.name.setError('请填写活动名称'); fields.name.control.focus(); return; }
      save.disabled = true; Object.values(fields).forEach(entry => { entry.control.disabled = true; });
      try {
        const body = Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, entry.control.value.trim()]));
        body.unitName = '南京大学红十字会'; body.fundAccount = REIMBURSEMENT_FORM_FUND_ACCOUNT;
        if (!useWorkspace) delete body.category;
        body.participantCount = body.participantCount === '' ? null : Number(body.participantCount);
        const result = await api.saveActivity({ ...body, ...(item ? { id: item.id, revision: item.revision } : {}) });
        if (disposed) return; activity.control.append(h('option', { value: result.activity.id, text: result.activity.name })); activity.control.value = result.activity.id;
        selected = new Set(); clearEditHint(); feedback.replaceChildren(); drawer.close(); await data.reload(); renderCandidates(true);
      } catch (error) { errorSlot.replaceChildren(notice(error.message, { tone: 'error' })); }
      finally { save.disabled = false; Object.values(fields).forEach(entry => { entry.control.disabled = false; }); }
    } });
    const drawer = openDrawer({ title: item ? '编辑活动资料' : '新建活动资料', width: 680, body: [h('div', { class: 'stack-4' },
      h('p', { class: 't-secondary', text: '可先保存名称；生成报销表前须补齐下列活动资料。' }), fields.name,
      h('div', { class: 'formgrid' }, fields.category, fields.campus, fields.date, fields.location, fields.participantCount), fields.description, errorSlot)], footer: [save] });
  }
  async function openPreview() {
    if (preview.disabled) return;
    const item = currentActivity(); if (!item) return;
    for (const entry of [handlerName, handlerPhone, fillDate]) {
      entry.setError(null); if (!entry.control.value.trim()) { entry.setError('请填写此项'); entry.control.focus(); return; }
    }
    const missing = [['date', '活动日期'], ['location', '活动地点'], ['participantCount', '活动人数'],
      ['description', '目的与内容'], ['unitName', '单位名称']].filter(([key]) => !item[key]).map(([, label]) => label);
    if (missing.length) { promptActivityEdit(`请先补齐：${missing.join('、')}。`); return; }
    clearEditHint();
    const chosenRows = itemOrder.filter(row => selected.has(financeRowKey(row)));
    const body = { itemOrder: chosenRows.map(({ requestId, itemId }) => ({ requestId, itemId })), activityId: item.id, activityRevision: item.revision,
      selections: candidates.filter(request => chosenRows.some(row => row.requestId === request.id)).map(request => ({ requestId: request.id, revision: request.revision,
        ...(useWorkspace ? { itemIds: chosenRows.filter(row => row.requestId === request.id).map(row => row.itemId) } : {}), ...(activityReview ? { stateVersion: request.stateVersion } : {}) })),
      ...(useWorkspace ? { settlements: chosenRows.map(row => ({ requestId: row.requestId, itemId: row.itemId, ...settlements.get(financeRowKey(row)) })) } : {}),
      mergeSameItems: merge.control.checked, form: { handlerName: handlerName.control.value.trim(), handlerPhone: handlerPhone.control.value.trim(), fillDate: fillDate.control.value }, idempotencyKey: operationKey() };
    preview.disabled = true; preview.dataset.loading = 'true'; feedback.replaceChildren();
    try {
      if (activityReview) {
        const fingerprint = JSON.stringify({ ...body, idempotencyKey: '' });
        if (draftAttempt?.fingerprint !== fingerprint) draftAttempt = { fingerprint, key: body.idempotencyKey };
        const result = await api.createSummary({ ...body, idempotencyKey: draftAttempt.key, duplicateMaterialsConfirmed: false });
        if (!disposed) { showRecord(result.summary); await data.reload(); } return;
      }
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
        h('p', { class: 't-secondary', text: `后附 ${summary.selections.length} 笔申请材料，共 ${summary.attachmentPages} 页。审批签字与公章栏留空。` }), materialDirectory(summary), unmergedLinks(summary), warnings],
      footer: [create], onClose: () => { closed = true; disposePreview(); } });
    } catch (error) {
      if (error.message.includes('请先补齐活动')) promptActivityEdit(error.message);
      else feedback.replaceChildren(notice(error.message, { tone: 'error', title: '暂不能生成汇总' }));
    }
    finally { delete preview.dataset.loading; updateCount(); }
  }
  function showRecord(record) {
    const display = recordBody(record), feedback = h('div', { aria: { live: 'polite' } });
    const checked = checkbox({ label: '已核对完整报销表及全部合并材料', name: 'activityFinalChecked' });
    const scope = checkbox({ label: '已确认本次活动申请范围和重复材料，不遗漏或重复申报', name: 'activityFinalScope' });
    const note = field({ label: '终审意见', name: 'activityFinalNote', multiline: true, maxlength: 1000, hint: '退回初审时必填。' });
    const actionable = record.protocolVersion === 2 && record.status === 'draft' && mayGenerate;
    const approve = button({ label: '终审通过，进入待打款', variant: 'primary', onClick: () => decide(true) });
    const back = button({ label: '退回初审', variant: 'secondary', onClick: () => decide(false) });
    const drawer = openDrawer({ title: `${record.activity.name} · ${record.code}`, width: 1050, body: [display,
      actionable ? h('section', { class: 'stack-4' }, checked, scope, note, feedback) : null], footer: actionable ? [back, approve] : [], onClose: () => display.dispose() });
    async function decide(passing) {
      if (approve.disabled) return;
      feedback.replaceChildren();
      if (passing && (!checked.control.checked || !scope.control.checked)) { feedback.append(notice('请先核对完整材料并确认本次申请范围。', { tone: 'warning' })); return; }
      if (!passing && !note.control.value.trim()) { note.setError('请填写退回初审的原因'); note.control.focus(); return; }
      approve.disabled = back.disabled = true;
      try {
        if (!await confirmAction({ title: passing ? '确认本次活动终审通过？' : '将本批申请退回各自初审人？', description: `${record.selections.length} 笔申请 · ${reimbursementAmount(record.totalCents)}，通过后仍需实际打款及登记。`, confirmLabel: passing ? '确认终审通过' : '确认退回' })) return;
        await api.reviewSummary(record.id, { action: passing ? 'approve' : 'return', stateVersion: record.stateVersion,
          materialsChecked: checked.control.checked, scopeConfirmed: scope.control.checked, note: note.control.value.trim() });
        drawer.close(); await data.reload();
      } catch (error) { feedback.replaceChildren(notice(error.message, { tone: 'error' })); }
      finally { approve.disabled = back.disabled = false; }
    }
  }

  return { title: '活动报销汇总', crumb: '活动报销汇总', node: h('div', { class: 'view wspad wspad--wide material-summary' },
    materialServices('finance', { console: true }), pageHead({ label: '财务报销', title: '活动终审', description: '按支出条目核定金额与材料顺序，预览完整 PDF 后确认终审。',
      actions: [button({ label: '返回活动列表', variant: 'secondary', href: '/console/reimbursements?view=activities' })] }), useWorkspace ? financeNavigation('activities') : null, data), dispose: () => { disposed = true; } };
}

function formTable(summary) {
  const item = summary.activity;
  const cells = values => h('tr', {}, ...values.map(value => h('td', { text: value })));
  return h('div', { class: 'material-summary-form stack-4' }, h('h2', { class: 't-h2', text: '南京大学活动费报销表' }),
    h('p', { class: 't-secondary', text: `经办人：${summary.form.handlerName} · 联系电话：${summary.form.handlerPhone} · 填报日期：${summary.form.fillDate}` }),
    h('table', { class: 'material-summary-meta' }, h('tbody', {}, cells(['单位名称', item.unitName, '经费卡号', REIMBURSEMENT_FORM_FUND_ACCOUNT]),
      cells(['活动名称', item.name, '活动日期', item.date]), cells(['活动人数', String(item.participantCount), '活动地点', item.location]),
      h('tr', {}, h('td', { text: '开展活动目的及内容' }), h('td', { colspan: 3, text: item.description })))),
    h('table', { class: 'material-summary-lines' }, h('thead', {}, h('tr', {}, ...['支出项目', '金额（元）', '备注'].map(label => h('th', { scope: 'col', text: label })))),
      h('tbody', {}, ...summary.rows.map(row => cells([row.category ? `${row.category} · ${row.label}` : row.label, (row.amountCents / 100).toFixed(2), row.note])), cells(['合计金额', (summary.totalCents / 100).toFixed(2), `大写：${summary.amountUpper}`]))),
    h('div', { class: 'material-summary-signatures' }, h('span', { text: '单位负责人审批：' }), h('span', { text: '单位公章：' })),
    h('details', { class: 'material-originals' }, h('summary', { text: `查看 ${summary.selections.length} 笔来源申请` }),
      ...summary.selections.map(selection => h('p', { class: 't-secondary', text: `${selection.code} · ${selection.applicant} · 第 ${selection.revision} 版 · ${reimbursementAmount(selection.amountCents)}` }))));
}
function recordBody(record) {
  const pdf = pdfPreview(record.packetUrl);
  const links = [button({ label: '下载活动报销表', variant: 'secondary', iconName: 'download', href: record.formUrl }),
    button({ label: record.unmergedAttachments?.length ? '下载 PDF 材料合集' : '下载完整材料包', variant: 'primary', iconName: 'download', href: record.packetUrl })];
  links.forEach(link => link.setAttribute('download', ''));
  const node = h('div', { class: 'stack-4' }, notice(record.protocolVersion === 2 ? record.status === 'approved' ? '活动终审已通过，待实际打款。' : record.status === 'returned' ? '本批材料已退回初审，此文件保留为历史版本。' : '完整 PDF 已生成供核对，尚未终审通过。' : `汇总已生成：${record.code}，不登记付款。`, { tone: record.status === 'draft' ? 'neutral' : 'success' }),
    h('div', { class: 'row-3 row-wrap' }, ...links), record.outstanding?.length ? notice(`本批未纳入：${record.outstanding.map(item => item.code).join('、')}。请确认这些申请的处理进度。`, { tone: 'warning' }) : null, record.duplicateMaterials?.length ? notice(`存在 ${record.duplicateMaterials.length} 组相同材料，请核对是否重复申报。`, { tone: 'warning' }) : null, materialDirectory(record), unmergedLinks(record), pdf,
    h('details', { class: 'material-originals' }, h('summary', { text: '查看汇总明细与来源' }), formTable(record),
      ...(record.materialGroups ? [] : record.attachments || []).map(source => h('p', { class: 't-secondary', text: `${record.selections.find(selection => selection.requestId === source.requestId)?.code || ''} · ${source.startPage ? `材料包第 ${source.startPage}–${source.endPage} 页` : '仅有 Word 原件，请分别下载'}` }))));
  node.dispose = () => pdf.dispose(); return node;
}

function materialDirectory(record) {
  if (!record.materialGroups?.length) return null;
  return h('section', { class: 'stack-3 material-summary-directory' },
    h('p', { class: 't-secondary', text: '材料与报销表条目顺序一致；项目内依次为发票、订单及付款、其他材料。共用材料只附一次，Word 原件另附。' }),
    h('details', { class: 'material-originals' }, h('summary', { text: `查看按项目材料目录（${record.materialGroups.length} 组）` }),
      ...record.materialGroups.map(group => {
        const selection = record.selections.find(item => item.requestId === group.requestId);
        const attachment = record.attachments?.find(item => item.requestId === group.requestId && item.groupIndex === group.groupIndex);
        const pages = attachment?.startPage ? `材料包第 ${attachment.startPage}–${attachment.endPage} 页`
          : group.pageCount ? `${group.pageCount} 页` : 'Word 原件另附';
        return h('p', { class: 't-secondary', text: `${selection?.code || ''} · ${selection?.applicant || ''} · ${group.label} · ${pages}` });
      })));
}

function unmergedLinks(record) {
  if (!record.unmergedAttachments?.length) return null;
  return h('section', { class: 'stack-3 material-originals' },
    h('p', { class: 't-secondary', text: `另有 ${record.unmergedAttachments.length} 份 Word 原件，不在合并 PDF 内，请分别下载并随汇总材料一同保存。` }),
    ...record.unmergedAttachments.map(file => h('a', { class: 'btn btn--ghost', href: file.url, download: file.name, text: file.name })));
}
