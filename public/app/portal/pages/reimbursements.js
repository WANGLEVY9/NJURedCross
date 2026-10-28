import { h, icon } from '../../core/dom.js';
import { hasPermission, getSessionState } from '../../core/api.js';
import { isSignedIn, loginRequiredPanel } from '../auth-gate.js';
import { button, field, checkbox, notice, receipt } from '../../ui/primitives.js';
import { openDrawer } from '../../ui/overlay.js';
import { materialServices } from '../../shared/material-services.js';
import { reimbursementsApi as api, operationKey, reimbursementAmount } from '../../shared/reimbursements-api.js';
import { bundleDetails, requestInfo } from '../../shared/reimbursement-details.js';
import { materialEmpty, materialSection, reimbursementStatus } from '../../shared/material-ui.js';
import { UPLOAD_LIMITS, MB } from '../../shared/reimbursement-limits.js';
import { announceMaterialChange } from '../../shared/materials-sync.js';
import { materialFilename, materialExtension, SUPPORTING_MATERIAL_TYPES } from '../../shared/reimbursement-files.js';
import { reimbursementCampus, reimbursementActivityCategory, recentReimbursementActivities, reimbursementCategoryOptions } from '../../shared/reimbursement-activities.js';
import { retainedMaterialEntries, materialUploadForm } from '../reimbursement-retained-materials.js';
import { REIMBURSEMENT_CATEGORIES, requiredReimbursementMaterials, reimbursementMaterialHint, reimbursementMaterialIssues } from '../../shared/reimbursement-material-rules.js';
import { railJourneyFields } from '../../shared/reimbursement-rail-journey.js';

export default async function reimbursementsPage() {
  if (!isSignedIn()) return { title: '财务报销', node: h('div', { class: 'view formpage' }, materialServices('finance'), loginRequiredPanel({ what: '报销申请' })) };
  const status = h('div', { aria: { live: 'polite' } });
  const work = h('div', { class: 'stack-5' });
  const mine = h('div', { class: 'material-finance-list material-my-requests' });
  const node = h('div', { class: 'view formpage material-finance-page' }, materialServices('finance'),
    h('header', { class: 'stack-3' }, h('h1', { class: 't-h1', text: '财务报销' }),
      h('p', { class: 't-prose', text: '整理材料、提交申请，随后在这里查看审核意见。' })), status, work);
  let files = [], bundle = null, resubmitId = null, key = operationKey(), busy = false, disposed = false, filesReady = false, typedUploads = false;
  let supportingFormats = ['pdf'];
  let resubmitContext = null, retainOnServer = false, linkedOpened = false, rulesVersion = 1;
  const name = field({ label: '申请人姓名', name: 'reimbursementName', required: true, maxlength: 50 });
  const amount = field({ label: '报销金额（元）', name: 'reimbursementAmount', type: 'text', required: true, placeholder: '例如 128.50' });
  amount.control.readOnly = true;
  name.control.value = getSessionState().user?.realName || '';
  name.control.readOnly = getSessionState().user?.localPreview !== true;
  const activity = field({ label: '关联活动', name: 'reimbursementActivity', searchable: true, required: true, options: [{ value: '', label: '正在读取活动目录' }] });
  const campus = field({ label: '活动校区', name: 'reimbursementCampus', required: true,
    options: [{ value: '', label: '请选择活动校区' }, '南京', '苏州'] });
  const activityCategory = field({ label: '活动类别', name: 'reimbursementActivityCategory', required: true,
    options: [{ value: '', label: '请先选择活动校区' }], disabled: true });
  const activityExtras = h('p', { class: 't-caption', aria: { live: 'polite' }, text: '仅可选择近 30 天内的活动；请先选择校区和活动类别。' });
  let originalActivity = null, activityGrouping = false;
  const recentActivities = () => recentReimbursementActivities(activities, new Date(), { requireCampus: activityGrouping });
  function availableActivities() {
    const recent = recentActivities();
    // A returned application retains its original association, without reopening the old catalogue.
    return originalActivity && !recent.some(item => item.id === originalActivity.id) ? [...recent, originalActivity] : recent;
  }
  function renderActivityOptions() {
    const previous = activity.control.value;
    const visible = availableActivities().filter(item => !activityGrouping || reimbursementCampus(item.campus) === campus.control.value
      && reimbursementActivityCategory(item) === activityCategory.control.value);
    activity.control.replaceChildren(h('option', { value: '', text: activityGrouping && !campus.control.value ? '请先选择活动校区'
      : activityGrouping && !activityCategory.control.value ? '请先选择活动类别' : visible.length ? '请选择对应活动' : '该校区、该类别近 30 天暂无活动' }),
    ...visible.map(item => h('option', { value: item.id,
      text: `${item.name} · ${item.date || '日期未登记'}${item.id === originalActivity?.id ? '（原申请活动）' : ''}` })));
    activity.control.value = visible.some(item => item.id === previous) ? previous : '';
    activity.control.disabled = busy || !visible.length;
    activity.setError(null);
    if (previous !== activity.control.value && !dateEdited) expenseDate.control.value = '';
    activityExtras.textContent = originalActivity ? '仅可新选近 30 天内的活动；补充材料时可保留原申请活动。'
      : '仅可选择近 30 天内的活动，超过期限的活动不显示，也无法搜索。';
  }
  function renderActivityCategories() {
    campus.hidden = !activityGrouping; activityCategory.hidden = !activityGrouping;
    if (!activityGrouping) { renderActivityOptions(); return; }
    const previous = activityCategory.control.value;
    const categories = [...new Set(availableActivities().filter(item => reimbursementCampus(item.campus) === campus.control.value)
      .map(reimbursementActivityCategory))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    activityCategory.control.replaceChildren(h('option', { value: '', text: !campus.control.value ? '请先选择活动校区'
      : '请选择活动类别' }), ...reimbursementCategoryOptions(previous, { unclassified: categories.includes('未分类') }).slice(1).map(option => h('option', { value: option.value, text: option.label })));
    activityCategory.control.value = [...activityCategory.control.options].some(option => option.value === previous) ? previous : '';
    activityCategory.control.disabled = busy || !campus.control.value;
    activityCategory.setError(null); renderActivityOptions();
  }
  campus.control.addEventListener('change', () => {
    campus.setError(null); activityCategory.control.value = ''; renderActivityCategories();
  });
  activityCategory.control.addEventListener('change', () => { activityCategory.setError(null); renderActivityOptions(); });
  const expenseDate = field({ label: '活动日期', name: 'expenseDate', type: 'date', required: true,
    hint: '选择活动后默认带出活动日期，可按实际活动日期调整。' });
  const voucherNote = field({ label: '特殊情况说明', name: 'voucherNote', multiline: true, rows: 1, maxlength: 1000, placeholder: '如有特殊情况，请在此说明' });
  voucherNote.classList.add('material-special-note');
  const meeting = field({ label: '是否参加会议', name: 'reimbursementMeeting', value: 'no', options: [{ value: 'no', label: '否' }, { value: 'yes', label: '是，需附会议邀请函' }] });
  const singleOrder = checkbox({ name: 'reimbursementSingleOrder', label: '本申请只对应一笔订单（可包含多项物品）；多笔订单将分次提交' });
  const requirementsSlot = h('div', { class: 'stack-2 material-required-materials', aria: { live: 'polite' } });
  const rules = () => rulesVersion === 1 && typedUploads ? { materialRulesVersion: 1, meetingRelated: meeting.control.value === 'yes', singleOrderConfirmed: singleOrder.control.checked } : {};
  function renderRequirements() {
    meeting.hidden = singleOrder.hidden = requirementsSlot.hidden = !rules().materialRulesVersion;
    const types = [...new Set(expenses.flatMap(row => requiredReimbursementMaterials(row.category.control.value, meeting.control.value === 'yes')))];
    requirementsSlot.replaceChildren(h('b', { class: 't-secondary', text: types.length ? `本申请需提供：${types.join('、')}` : '先选择报销类别，再按要求上传材料。' }),
      ...types.map(type => h('p', { class: 't-caption', text: `${type}：${reimbursementMaterialHint(type)}` })),
      h('p', { class: 't-caption', text: '订单和付款截图请直接上传清晰图片或 PDF，平台自动命名并整理；Word 可作为辅助原件。发票与行程单请上传 PDF 原件。' }));
  }
  meeting.control.addEventListener('change', renderRequirements);
  const expenseList = h('div', { class: 'stack-3' });
  let expenses = [], activities = [], expenseSequence = 0;
  let dateEdited = false;
  expenseDate.control.addEventListener('input', () => { dateEdited = true; });
  expenseDate.control.addEventListener('change', () => { dateEdited = true; });
  activity.control.addEventListener('change', () => {
    activity.setError(null);
    const selected = availableActivities().find(item => item.id === activity.control.value);
    if (!dateEdited || !expenseDate.control.value) {
      expenseDate.control.value = selected?.date || ''; expenseDate.setError(null); dateEdited = false;
    }
  });
  const addExpense = button({ label: '添加支出项目', variant: 'ghost', iconName: 'plus', onClick: () => { if (!busy && expenses.length < 50) { addRow(); renderExpenses(); } } });
  function cents(value) {
    if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value)) return null;
    const [yuan, fraction = ''] = value.split('.');
    const total = Number(yuan) * 100 + Number(fraction.padEnd(2, '0')); return total > 0 ? total : null;
  }
  function total() {
    const values = expenses.map(row => cents(row.amount.control.value.trim()));
    const sum = values.every(value => value !== null) ? values.reduce((sum, value) => sum + value, 0) : 0;
    amount.control.value = sum > 0 ? (sum / 100).toFixed(2) : '';
  }
  function addRow(row = {}) {
    const sequence = expenseSequence++;
    const entry = { id: row.id || String(sequence + 1),
      category: field({ label: '报销类别', name: `expenseCategory${sequence}`, required: true, maxlength: 50, value: row.category || '', placeholder: '例如：办公用品、印刷费',
        ...(rulesVersion === 1 ? { options: [{ value: '', label: '请选择报销类别' }, ...REIMBURSEMENT_CATEGORIES] } : {}) }),
      label: field({ label: '支出项目', name: `expenseLabel${sequence}`, required: true, maxlength: 100, value: row.label || '', placeholder: '例如：便利用品' }),
      amount: field({ label: '金额（元）', name: `expenseAmount${sequence}`, required: true, value: row.amount || '', placeholder: '填写发票与实际支出中的较小金额',
        hint: '请填写发票金额与实际支出金额中的较小值。' }),
      note: field({ label: '用途 / 备注', name: `expenseNote${sequence}`, maxlength: 300, value: row.note || '' }),
      rail: railJourneyFields(`expenseRail${sequence}`, row.railJourney), originalRailJourney: row.railJourney };
    entry.amount.control.inputMode = 'decimal';
    [entry.category, entry.label, entry.amount, entry.note, ...entry.rail.fields].forEach(field => field.control.addEventListener('input', () => {
      entry.rail.node.hidden = entry.category.control.value !== '火车票/高铁票';
      field.setError(null); total(); renderRequirements(); if (filesReady) renderFiles();
    }));
    expenses.push(entry);
  }
  function renderExpenses() {
    expenses.forEach(row => { row.category.hidden = !typedUploads; row.rail.node.hidden = !typedUploads || row.category.control.value !== '火车票/高铁票'; });
    expenseList.replaceChildren(...expenses.map((row, index) => h('div', { class: 'material-expense-row' },
      h('p', { class: 't-caption', text: `第 ${index + 1} 项` }), row.category, row.rail.node, h('div', { class: 'formgrid' }, row.label, row.amount), row.note,
      button({ label: '移除此项', variant: 'ghost', size: 'sm', disabled: expenses.length === 1 || busy, onClick: () => {
        if (busy || expenses.length === 1) return; expenses.splice(index, 1); renderExpenses();
    } })))); total(); addExpense.disabled = busy || expenses.length >= 50;
    renderRequirements(); if (filesReady) renderFiles();
  }
  addRow(); renderExpenses();
  amount.control.inputMode = 'decimal';
  const purpose = field({ label: '报销事由', name: 'reimbursementPurpose', multiline: true, rows: 2, required: true, maxlength: 500 });
  [name, amount, purpose].forEach(entry => entry.control.addEventListener('input', () => entry.setError(null)));
  const uploadSections = ['invoice', 'supporting'].map(kind => {
    const id = `reimbursement-${kind}`, label = kind === 'invoice' ? '发票' : '补充材料';
    const input = h('input', { class: 'material-upload__input', type: 'file', id, accept: '.pdf,application/pdf', multiple: true });
    const list = h('ul', { class: 'material-file-list material-typed-files' });
    return { kind, input, list, node: h('section', { class: 'stack-3 material-upload-group' },
      h('h3', { class: 't-h4', text: label }), h('div', { class: 'material-upload' }, input,
        h('label', { for: id, class: 'material-upload__label' }, icon('upload'), h('b', { text: `选择${label} PDF` }),
          h('span', { class: 't-secondary', text: kind === 'invoice' ? '发票单独上传，并选择对应支出项目' : '上传清单、支付凭证等，可关联整份申请' }))), list) };
  });
  filesReady = true;
  const fileSummary = h('p', { class: 't-caption', aria: { live: 'polite' }, text: '尚未选择材料' });
  const submitFeedback = h('div', { class: 'material-submit-feedback', role: 'alert', hidden: true });
  const submitHint = h('p', { class: 't-secondary', aria: { live: 'polite' }, text: '选择材料并填写申请信息后，即可提交审核。' });
  const editMessage = h('p', { class: 't-caption', aria: { live: 'polite' } });
  const submit = button({ label: '提交审核申请', variant: 'primary', onClick: send });
  submit.disabled = true;
  const cancelEdit = button({ label: '取消补充', variant: 'ghost', onClick: () => reset() }); cancelEdit.hidden = true;
  const uploadHeading = materialSection('上传材料', '发票与补充材料分开上传，按报销人、类别、项目自动命名，原件内容不变。', '02');
  const form = h('div', { class: 'panel material-application' }, h('div', { class: 'panel__body stack-6' },
    editMessage,
    h('section', { class: 'stack-4' }, materialSection('申请信息', '填写申请人与本次报销事由。', '01'),
      h('div', { class: 'formgrid' }, campus, activityCategory), activity, activityExtras, h('div', { class: 'formgrid' }, name, expenseDate), purpose,
      materialSection('支出明细', '一笔申请对应一笔订单，可包含多项物品；合计按明细自动计算。'), expenseList, addExpense, amount, meeting, singleOrder, voucherNote),
    h('section', { class: 'stack-4 material-upload-section' }, uploadHeading,
      requirementsSlot, ...uploadSections.map(section => section.node),
      h('p', { class: 't-caption', text: `最多 ${UPLOAD_LIMITS.files} 份 · 单份 ${UPLOAD_LIMITS.fileMB} MB · 总计 ${UPLOAD_LIMITS.totalMB} MB · 合计不超过 ${UPLOAD_LIMITS.pages} 页` }),
      fileSummary, submitFeedback)), h('footer', { class: 'panel__foot material-submit-bar' }, submitHint,
    h('div', { class: 'row-3 row-wrap' }, cancelEdit, submit)));
  function invalidate() {
    bundle = null;
    submit.disabled = !files.length || !activities.length;
    submitHint.textContent = '选择材料并填写申请信息后，即可提交审核。'; key = operationKey();
  }
  function lock(value) {
    busy = value;
    for (const control of [name.control, amount.control, purpose.control, campus.control, activityCategory.control, activity.control, expenseDate.control, voucherNote.control, meeting.control, singleOrder.control,
      ...expenses.flatMap(row => [row.category.control, row.label.control, row.amount.control, row.note.control, ...row.rail.fields.map(field => field.control)]), addExpense,
      ...uploadSections.map(section => section.input), submit, cancelEdit,
      ...expenseList.querySelectorAll('button'), ...uploadSections.flatMap(section => [...section.list.querySelectorAll('button,select')])]) control.disabled = value;
    if (!value) { submit.disabled = !files.length || !activities.length; renderActivityCategories(); renderExpenses(); }
  }
  function renderFiles() {
    if (!invalidAssociations()) { submitFeedback.replaceChildren(); submitFeedback.hidden = true; }
    fileSummary.textContent = files.length ? `${typedUploads ? `发票 ${files.filter(entry => entry.kind === 'invoice').length} 份 · 补充材料 ${files.filter(entry => entry.kind === 'supporting').length} 份` : `已选择 ${files.length} 份`} · ${(files.reduce((sum, entry) => sum + entry.file.size, 0) / MB).toFixed(2)} MB` : '尚未选择材料';
    for (const section of uploadSections) section.list.replaceChildren(...files.flatMap((entry, index) => {
      if ((entry.kind === 'legacy' ? 'invoice' : entry.kind) !== section.kind) return [];
      const expense = expenses.find(row => row.id === entry.expenseItemId);
      const rawAmount = expense?.amount.control.value.trim() || '';
      const amountCents = rawAmount ? cents(rawAmount) : null;
      const filename = typedUploads ? materialFilename({ name: name.control.value, category: expense?.category.control.value,
        railJourney: expense?.rail.value(), purpose: purpose.control.value,
        label: expense?.label.control.value || purpose.control.value, kind: entry.kind,
        index: entry.kind === 'supporting' ? files.slice(0, index).filter(file => file.kind === 'supporting').length : index,
        originalName: entry.file.name,
        materialType: entry.kind === 'supporting' ? entry.materialType : '',
        amount: amountCents !== null ? (amountCents / 100).toFixed(2) : expense ? rawAmount : amount.control.value }) : entry.file.name;
      const association = field({ label: '对应支出项目', name: `materialExpense${index}`, value: expense?.id || '',
        required: entry.kind === 'invoice', options: [{ value: '', label: entry.kind === 'invoice' ? '请选择支出项目' : '整份申请' },
          ...expenses.map((row, rowIndex) => ({ value: row.id, label: `第 ${rowIndex + 1} 项 · ${row.label.control.value || '未填写项目'}` }))] });
      association.control.disabled = busy;
      association.hidden = !typedUploads;
      association.control.addEventListener('change', () => { if (busy) return; entry.expenseItemId = association.control.value; invalidate(); renderFiles(); });
      const typeSelect = entry.kind === 'supporting'
        ? field({ label: '材料类型', name: `materialType${index}`, value: entry.materialType || '', required: true,
            options: [{ value: '', label: '请选择材料类型' }, ...SUPPORTING_MATERIAL_TYPES.map(type => ({ value: type, label: type }))] }) : null;
      if (typeSelect) {
        typeSelect.hidden = !typedUploads;
        typeSelect.control.disabled = busy;
        typeSelect.control.addEventListener('change', () => { if (busy) return; entry.materialType = typeSelect.control.value; invalidate(); renderFiles(); });
      }
      const replacement = h('input', { type: 'file', hidden: true, accept: (entry.kind === 'invoice' ? ['pdf'] : supportingFormats).map(ext => `.${ext}`).join(',') });
      replacement.addEventListener('change', () => {
        const file = replacement.files[0]; replacement.value = ''; if (busy || !file) return;
        if (!(entry.kind === 'invoice' ? ['pdf'] : supportingFormats).includes(materialExtension(file.name)) || !file.size || file.size > UPLOAD_LIMITS.fileMB * MB
          || files.reduce((sum, other) => sum + (other === entry ? file.size : other.file.size), 0) > UPLOAD_LIMITS.totalMB * MB) {
          submitFeedback.replaceChildren(notice('替换文件的格式或大小不符合上传要求，原材料已保留。', { tone: 'error' })); submitFeedback.hidden = false; return;
        }
        files[index] = { file, kind: entry.kind, expenseItemId: entry.expenseItemId, materialType: entry.materialType };
        invalidate(); renderFiles();
      });
      return [h('li', { class: 'material-typed-file' }, h('div', { class: 'stack-2 material-file-list__name' },
        h('span', { text: filename }), h('small', { class: 't-caption', text: `${entry.retained ? '已保存原件：' : '原文件：'}${entry.file.name}` }), association, typeSelect,
        entry.kind === 'invoice' || entry.materialType ? h('p', { class: 't-caption', text: reimbursementMaterialHint(entry.kind === 'invoice' ? '发票' : entry.materialType) }) : null),
        h('div', { class: 'material-file-list__actions' },
          replacement, button({ label: '替换', size: 'sm', variant: 'ghost', disabled: busy, onClick: () => replacement.click() }),
          button({ label: '上移', size: 'sm', variant: 'ghost', disabled: busy || files[index - 1]?.kind !== entry.kind, ariaLabel: `${entry.file.name} 上移`, onClick: () => move(index, -1) }),
          button({ label: '下移', size: 'sm', variant: 'ghost', disabled: busy || files[index + 1]?.kind !== entry.kind, ariaLabel: `${entry.file.name} 下移`, onClick: () => move(index, 1) }),
          button({ label: '移除', size: 'sm', variant: 'ghost', disabled: busy, ariaLabel: `移除 ${entry.file.name}`, onClick: () => { if (busy) return; files.splice(index, 1); invalidate(); renderFiles(); } })))];
    }));
    submit.disabled = busy || !files.length || !activities.length;
  }
  function move(index, direction) {
    if (busy || files[index + direction]?.kind !== files[index]?.kind) return;
    [files[index], files[index + direction]] = [files[index + direction], files[index]];
    invalidate(); renderFiles();
  }
  uploadSections.forEach(section => section.input.addEventListener('change', () => {
    const added = [...section.input.files].map(file => ({ file, kind: section.kind, expenseItemId: expenses.length === 1 ? expenses[0].id : '', materialType: '' })); section.input.value = '';
    const next = [...files, ...added].sort((a, b) => (a.kind === 'supporting') - (b.kind === 'supporting'));
    if (next.length > UPLOAD_LIMITS.files || next.some(({ file, kind, retained }) => !retained && (!(kind === 'supporting' ? supportingFormats : ['pdf']).includes(materialExtension(file.name)) || !file.size || file.size > UPLOAD_LIMITS.fileMB * MB))
      || next.reduce((sum, entry) => sum + entry.file.size, 0) > UPLOAD_LIMITS.totalMB * MB) {
      status.replaceChildren(notice(`发票请上传 PDF；补充材料支持 ${supportingFormats.join('、').toUpperCase()}。请同时遵守数量和大小限制，原列表已保留。`, { tone: 'warning' })); return;
    }
    files = next; invalidate(); renderFiles();
  }));
  [name, purpose].forEach(entry => entry.control.addEventListener('input', renderFiles));
  function reset() {
    resubmitId = null; resubmitContext = null; rulesVersion = 1; meeting.control.value = 'no'; singleOrder.control.checked = false;
    files = []; invalidate(); renderFiles(); editMessage.textContent = ''; cancelEdit.hidden = true;
    name.control.value = getSessionState().user?.realName || ''; amount.control.value = ''; purpose.control.value = '';
    originalActivity = null; campus.control.value = ''; activityCategory.control.value = ''; activity.control.value = '';
    expenseDate.control.value = ''; dateEdited = false; renderActivityCategories(); voucherNote.control.value = ''; expenses = []; addRow(); renderExpenses();
    submit.querySelector('span').textContent = '提交审核申请';
  }
  async function send() {
    if (busy || !files.length) return;
    submitFeedback.replaceChildren(); submitFeedback.hidden = true;
    let invalid;
    renderActivityCategories();
    for (const entry of [...(activityGrouping ? [campus, activityCategory] : []), activity, name, expenseDate, amount, purpose, ...expenses.flatMap(row => [...(typedUploads ? [row.category] : []), row.label, row.amount])]) {
      entry.setError(null); if (!entry.control.value.trim()) { entry.setError('请填写此项'); invalid ||= entry.control; }
    }
    for (const row of expenses) if (cents(row.amount.control.value.trim()) === null) { row.amount.setError('请填写正数金额，最多两位小数'); invalid ||= row.amount.control; }
    for (const row of expenses) if (row.category.control.value === '火车票/高铁票') invalid ||= row.rail.validate(!resubmitId || Boolean(row.originalRailJourney));
    if (invalid) { invalid.focus(); return; }
    const issues = reimbursementMaterialIssues({ ...rules(), expenseItems: expenses.map(row => ({ category: row.category.control.value })) }, files);
    if (issues.length) { submitFeedback.replaceChildren(notice(issues.join(' '), { tone: 'error' })); submitFeedback.hidden = false;
      submitFeedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
    if (invalidAssociations()) {
      const missingType = typedUploads && files.some(entry => entry.kind === 'supporting' && !entry.materialType);
      const missingExpense = typedUploads && files.some(entry => (entry.kind === 'invoice' || entry.expenseItemId) && !expenses.some(row => row.id === entry.expenseItemId));
      submitFeedback.replaceChildren(notice([
        missingExpense ? '请为每份发票选择对应的支出项目；已移除项目的材料需重新关联。' : '',
        missingType ? '请为每份补充材料选择材料类型。' : '',
      ].filter(Boolean).join(' '), { tone: 'error' }));
      submitFeedback.hidden = false; submitFeedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return;
    }
    lock(true); submit.dataset.loading = 'true';
    try {
      if (!bundle) {
        status.replaceChildren(notice('正在上传材料，请稍候。', { tone: 'info' }));
        const data = await materialUploadForm(files, { typedUploads, revisionSource: resubmitContext, retainOnServer });
        const uploaded = await api.upload(data);
        if (disposed) return;
        bundle = uploaded.bundle;
      }
      const result = await api.submit({ ...rules(), ...(resubmitContext ? { revision: resubmitContext.revision, stateVersion: resubmitContext.stateVersion } : {}), name: name.control.value.trim(), amount: amount.control.value.trim(),
        purpose: purpose.control.value.trim(), bundleId: bundle.id, idempotencyKey: key,
        activityId: activity.control.value, expenseDate: expenseDate.control.value, voucherNote: voucherNote.control.value.trim(),
        expenseItems: expenses.map(row => ({ ...(typedUploads ? { id: row.id, category: row.category.control.value.trim(),
          ...(row.category.control.value === '火车票/高铁票' && row.rail.value() ? { railJourney: row.rail.value() } : {}) } : {}), label: row.label.control.value.trim(), amount: row.amount.control.value.trim(), note: row.note.control.value.trim() })) }, resubmitId);
      if (disposed) return;
      status.replaceChildren(receipt({ title: '申请已进入审核队列', rows: [['申请编号', result.request.code], ['当前状态', result.request.statusLabel]] }));
      announceMaterialChange('reimbursement-created');
      reset(); await loadMine();
    } catch (error) { status.replaceChildren(notice(error.message, { tone: 'error', title: '申请未提交，填写内容已保留' })); }
    finally { delete submit.dataset.loading; lock(false); renderFiles(); }
  }
  function invalidAssociations() {
    return typedUploads && files.some(entry => ((entry.kind === 'invoice' || entry.expenseItemId) && !expenses.some(row => row.id === entry.expenseItemId))
      || (entry.kind === 'supporting' && !entry.materialType));
  }
  async function loadMine() {
    const data = await api.mine(); if (disposed) return;
    function supplement(item) {
      if (busy) return; reset(); resubmitId = item.id; name.control.value = item.name;
      rulesVersion = item.materialRulesVersion === 1 ? 1 : 0; meeting.control.value = item.meetingRelated ? 'yes' : 'no'; singleOrder.control.checked = item.singleOrderConfirmed === true;
      resubmitContext = { requestId: item.id, revision: item.revision, stateVersion: item.stateVersion, bundleId: item.bundle.id };
      files = retainedMaterialEntries(item);
      amount.control.value = (item.amountCents / 100).toFixed(2); purpose.control.value = item.purpose;
      const catalogActivity = activities.find(activity => activity.id === item.activityId);
      originalActivity = item.activityId ? { ...catalogActivity, id: item.activityId,
        name: item.activityName || catalogActivity?.name || '原申请活动', date: catalogActivity?.date || item.expenseDate || '',
        campus: catalogActivity?.campus || item.initialAssignment?.campus || '', category: catalogActivity?.category || '' } : null;
      campus.control.value = reimbursementCampus(originalActivity?.campus); renderActivityCategories();
      activityCategory.control.value = originalActivity ? reimbursementActivityCategory(originalActivity) : ''; renderActivityOptions();
      activity.control.value = item.activityId || ''; expenseDate.control.value = item.expenseDate || ''; voucherNote.control.value = item.voucherNote || '';
      dateEdited = Boolean(item.expenseDate);
      expenses = []; (item.expenseItems?.length ? item.expenseItems : [{ label: item.purpose, amountCents: item.amountCents, note: '' }]).forEach(row => addRow({ id: row.id, category: row.category, railJourney: row.railJourney, label: row.label, amount: (row.amountCents / 100).toFixed(2), note: row.note })); renderExpenses();
      editMessage.textContent = `正在补充 ${item.code}：${item.history.at(-1)?.note || ''}。已保留原附件，可替换、移除或追加。`; cancelEdit.hidden = false;
      submit.querySelector('span').textContent = '提交补充材料'; form.scrollIntoView({ behavior: 'smooth', block: 'start' }); name.control.focus();
    }
    const rows = data.requests.map(item => h('tr', { data: { reimbursementRequest: item.id } },
      h('th', { scope: 'row' }, h('span', { text: item.expenseItems?.map(row => row.label).filter(Boolean).join('、') || item.purpose || '报销材料' }),
        item.status === 'returned' ? h('p', { class: 't-caption material-my-requests__return', text: `补充要求：${item.history?.at(-1)?.note || '请查看审核记录'}` }) : null),
      h('td', {}, reimbursementStatus(item)),
      h('td', { text: item.activityName || activities.find(activity => activity.id === item.activityId)?.name || '未关联活动' }),
      h('td', { class: 'material-finance-row__amount', text: reimbursementAmount(item.amountCents) }),
      h('td', {}, h('div', { class: 'row-2 row-wrap' }, button({ label: '查看材料', variant: 'ghost', size: 'sm', onClick: () => {
        const detail = bundleDetails(item.bundle, { withPreview: false });
        openDrawer({ title: item.activityName || '报销申请详情', width: 820, body: [requestInfo(item), detail], onClose: () => detail.dispose() });
      } }), item.status === 'returned' ? button({ label: '补充后重提', variant: 'secondary', size: 'sm', onClick: () => {
        supplement(item);
      } }) : null))));
    mine.replaceChildren(data.requests.length ? h('div', { class: 'material-my-requests__scroll', tabIndex: 0,
      role: 'region', aria: { label: '我的报销申请列表，可横向滚动' } },
      h('table', { class: 'material-my-requests__table' }, h('caption', { class: 'sr-only', text: '我的报销申请' }),
        h('thead', {}, h('tr', {}, ...['物资名称', '状态', '活动名称', '金额', '材料与操作'].map(text => h('th', { scope: 'col', text })))),
        h('tbody', {}, ...rows))) : materialEmpty('暂无报销申请', '提交后可在这里查看审核进度和补充意见。', 'file'));
    const linked = new URLSearchParams(location.search).get('request');
    if (linked && !linkedOpened) {
      linkedOpened = true;
      const item = data.requests.find(item => item.id === linked);
      if (item?.status === 'returned') supplement(item);
      else if (item) mine.querySelector(`[data-reimbursement-request="${CSS.escape(item.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else status.replaceChildren(notice('未找到邮件对应的申请，请确认当前登录的是申请人账号。', { tone: 'warning' }));
    }
  }
  (async () => {
    try {
      const config = await api.config(); if (disposed) return;
      retainOnServer = config.workflow?.retainedMaterials === true;
      typedUploads = config.materialUploads?.version >= 2;
      if (typedUploads && Array.isArray(config.materialUploads.supportingFormats)) {
        supportingFormats = config.materialUploads.supportingFormats.filter(extension => ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'].includes(extension));
        uploadSections[1].input.accept = supportingFormats.map(extension => `.${extension}`).join(',');
        uploadSections[1].node.querySelector('b').textContent = '选择补充材料';
        uploadSections[1].node.querySelector('.t-secondary').textContent = '支持 PDF、Word（DOC / DOCX）、JPG、PNG；Word 请下载原件核对';
      }
      if (!typedUploads) {
        uploadSections[1].node.hidden = true;
        uploadSections[0].node.querySelector('h3').textContent = '报销材料';
        uploadSections[0].node.querySelector('b').textContent = '选择 PDF 材料';
        uploadSections[0].node.querySelector('.t-secondary').textContent = '支持一次选择多份，可继续添加';
        uploadHeading.querySelector('p').textContent = '上传本次报销的 PDF 原件，可调整材料顺序。';
      }
      renderExpenses();
      const activityData = await api.activities(); if (disposed) return;
      activities = activityData.activities;
      // Preserve the original 3127 preview while its older API lacks grouping metadata.
      activityGrouping = activities.some(item => Object.hasOwn(item, 'campus'));
      renderActivityCategories();
      if (config.activityWarning) work.append(notice(config.activityWarning, { tone: 'warning' }));
      if (!recentActivities().length) work.append(notice('近 30 天暂无可选活动，或活动尚未登记校区。请联系管理员核对活动资料；已有申请仍可查看或补充。', { tone: 'warning' }));
      work.append(form,
        h('section', { class: 'stack-3' }, h('div', { class: 'row-3 row-wrap' }, h('h2', { class: 't-h3', text: '我的报销申请' }),
          button({ label: '刷新状态', variant: 'ghost', onClick: () => loadMine().catch(error => status.replaceChildren(notice(error.message, { tone: 'error' }))) }),
          hasPermission('materials') ? button({ label: '打开审核管理', variant: 'ghost', href: '/console/reimbursements' }) : null), mine));
      renderFiles(); await loadMine();
    } catch (error) { status.replaceChildren(notice(error.status === 404 ? '当前环境尚未启用报销申请，请稍后再试。' : error.message, { tone: 'warning' })); }
  })();
  return { title: '财务报销', node, dispose: () => { disposed = true; } };
}
