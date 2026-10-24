import { h, icon } from '../../core/dom.js';
import { hasPermission, getSessionState } from '../../core/api.js';
import { isSignedIn, loginRequiredPanel } from '../auth-gate.js';
import { button, field, notice, receipt } from '../../ui/primitives.js';
import { openDrawer } from '../../ui/overlay.js';
import { materialServices } from '../../shared/material-services.js';
import { reimbursementsApi as api, operationKey, reimbursementAmount } from '../../shared/reimbursements-api.js';
import { bundleDetails, requestInfo } from '../../shared/reimbursement-details.js';
import { materialEmpty, materialSection, reimbursementStatus } from '../../shared/material-ui.js';
import { UPLOAD_LIMITS, MB } from '../../shared/reimbursement-limits.js';
import { announceMaterialChange } from '../../shared/materials-sync.js';
import { materialFilename, materialExtension, SUPPORTING_MATERIAL_TYPES } from '../../shared/reimbursement-files.js';
import { bankAccountError } from '../../shared/reimbursement-bank-account.js';

export default async function reimbursementsPage() {
  if (!isSignedIn()) return { title: '财务报销', node: h('div', { class: 'view formpage' }, materialServices('finance'), loginRequiredPanel({ what: '报销申请' })) };
  const status = h('div', { aria: { live: 'polite' } });
  const work = h('div', { class: 'stack-5' });
  const mine = h('div', { class: 'material-finance-list' });
  const node = h('div', { class: 'view formpage material-finance-page' }, materialServices('finance'),
    h('header', { class: 'stack-3' }, h('h1', { class: 't-h1', text: '财务报销' }),
      h('p', { class: 't-prose', text: '整理材料、提交申请，随后在这里查看审核意见。' })), status, work);
  let files = [], bundle = null, resubmitId = null, key = operationKey(), busy = false, disposed = false, filesReady = false, typedUploads = false;
  let supportingFormats = ['pdf'];
  let bankAccountSupported = false;
  const name = field({ label: '申请人姓名', name: 'reimbursementName', required: true, maxlength: 50 });
  const bankAccount = field({ label: '银行卡号', name: 'reimbursementBankAccount', required: true,
    hint: '填写本人的银行卡号，16–19 位数字，不含空格', autocomplete: 'off', maxlength: 64 });
  bankAccount.control.inputMode = 'numeric';
  bankAccount.hidden = true;
  bankAccount.control.addEventListener('input', () => {
    const value = bankAccount.control.value;
    bankAccount.setError(value && (/[^0-9]/.test(value) || value.length > 19) ? bankAccountError(value) : null);
  });
  bankAccount.control.addEventListener('blur', () => {
    if (bankAccount.control.value) bankAccount.setError(bankAccountError(bankAccount.control.value) || null);
  });
  const amount = field({ label: '报销金额（元）', name: 'reimbursementAmount', type: 'text', required: true, placeholder: '例如 128.50' });
  amount.control.readOnly = true;
  name.control.value = getSessionState().user?.realName || '';
  name.control.readOnly = getSessionState().user?.localPreview !== true;
  const activity = field({ label: '关联活动', name: 'reimbursementActivity', searchable: true, required: true, options: [{ value: '', label: '正在读取活动目录' }] });
  const activityExtras = h('div', { class: 'stack-2' });
  const isoDaysAgo = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d); };
  const expenseDate = field({ label: '费用发生日期', name: 'expenseDate', type: 'date', required: true,
    hint: '选择活动后默认带出活动日期，可按实际费用发生日期调整。' });
  const voucherNote = field({ label: '凭证说明', name: 'voucherNote', multiline: true, rows: 2, maxlength: 1000, placeholder: '可说明发票与明细的对应关系' });
  const expenseList = h('div', { class: 'stack-3' });
  let expenses = [], activities = [], expenseSequence = 0;
  let dateEdited = false;
  expenseDate.control.addEventListener('input', () => { dateEdited = true; });
  expenseDate.control.addEventListener('change', () => { dateEdited = true; });
  activity.control.addEventListener('change', () => {
    const selected = activities.find(item => item.id === activity.control.value);
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
      category: field({ label: '报销类别', name: `expenseCategory${sequence}`, required: true, maxlength: 50, value: row.category || '', placeholder: '例如：办公用品、印刷费' }),
      label: field({ label: '支出项目', name: `expenseLabel${sequence}`, required: true, maxlength: 100, value: row.label || '', placeholder: '例如：便利用品' }),
      amount: field({ label: '金额（元）', name: `expenseAmount${sequence}`, required: true, value: row.amount || '', placeholder: '0.00' }),
      note: field({ label: '用途 / 备注', name: `expenseNote${sequence}`, maxlength: 300, value: row.note || '' }) };
    entry.amount.control.inputMode = 'decimal';
    [entry.category, entry.label, entry.amount, entry.note].forEach(field => field.control.addEventListener('input', () => {
      field.setError(null); total(); if (filesReady) renderFiles();
    }));
    expenses.push(entry);
  }
  function renderExpenses() {
    expenses.forEach(row => { row.category.hidden = !typedUploads; });
    expenseList.replaceChildren(...expenses.map((row, index) => h('div', { class: 'material-expense-row' },
      h('p', { class: 't-caption', text: `第 ${index + 1} 项` }), row.category, h('div', { class: 'formgrid' }, row.label, row.amount), row.note,
      button({ label: '移除此项', variant: 'ghost', size: 'sm', disabled: expenses.length === 1 || busy, onClick: () => {
        if (busy || expenses.length === 1) return; expenses.splice(index, 1); renderExpenses();
    } })))); total(); addExpense.disabled = busy || expenses.length >= 50;
    if (filesReady) renderFiles();
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
      activity, activityExtras, h('div', { class: 'formgrid' }, name, expenseDate), bankAccount, purpose,
      materialSection('支出明细', '一笔申请可填写多项支出，合计按明细自动计算。'), expenseList, addExpense, amount, voucherNote),
    h('section', { class: 'stack-4 material-upload-section' }, uploadHeading,
      ...uploadSections.map(section => section.node),
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
    for (const control of [name.control, bankAccount.control, amount.control, purpose.control, activity.control, expenseDate.control, voucherNote.control,
      ...expenses.flatMap(row => [row.category.control, row.label.control, row.amount.control, row.note.control]), addExpense,
      ...uploadSections.map(section => section.input), submit, cancelEdit,
      ...expenseList.querySelectorAll('button'), ...uploadSections.flatMap(section => [...section.list.querySelectorAll('button,select')])]) control.disabled = value;
    if (!value) { submit.disabled = !files.length || !activities.length; renderExpenses(); }
  }
  function renderFiles() {
    if (!invalidAssociations()) { submitFeedback.replaceChildren(); submitFeedback.hidden = true; }
    fileSummary.textContent = files.length ? `${typedUploads ? `发票 ${files.filter(entry => entry.kind === 'invoice').length} 份 · 补充材料 ${files.filter(entry => entry.kind === 'supporting').length} 份` : `已选择 ${files.length} 份`} · ${(files.reduce((sum, entry) => sum + entry.file.size, 0) / MB).toFixed(2)} MB` : '尚未选择材料';
    for (const section of uploadSections) section.list.replaceChildren(...files.flatMap((entry, index) => {
      if (entry.kind !== section.kind) return [];
      const expense = expenses.find(row => row.id === entry.expenseItemId);
      const rawAmount = expense?.amount.control.value.trim() || '';
      const amountCents = rawAmount ? cents(rawAmount) : null;
      const filename = typedUploads ? materialFilename({ name: name.control.value, category: expense?.category.control.value,
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
      return [h('li', { class: 'material-typed-file' }, h('div', { class: 'stack-2 material-file-list__name' },
        h('span', { text: filename }), h('small', { class: 't-caption', text: `原文件：${entry.file.name}` }), association, typeSelect),
        h('div', { class: 'material-file-list__actions' },
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
    if (next.length > UPLOAD_LIMITS.files || next.some(({ file, kind }) => !(kind === 'supporting' ? supportingFormats : ['pdf']).includes(materialExtension(file.name)) || !file.size || file.size > UPLOAD_LIMITS.fileMB * MB)
      || next.reduce((sum, entry) => sum + entry.file.size, 0) > UPLOAD_LIMITS.totalMB * MB) {
      status.replaceChildren(notice(`发票请上传 PDF；补充材料支持 ${supportingFormats.join('、').toUpperCase()}。请同时遵守数量和大小限制，原列表已保留。`, { tone: 'warning' })); return;
    }
    files = next; invalidate(); renderFiles();
  }));
  [name, purpose].forEach(entry => entry.control.addEventListener('input', renderFiles));
  function reset() {
    resubmitId = null; files = []; invalidate(); renderFiles(); editMessage.textContent = ''; cancelEdit.hidden = true;
    name.control.value = getSessionState().user?.realName || ''; amount.control.value = ''; purpose.control.value = '';
    bankAccount.control.value = ''; bankAccount.setError(null);
    activity.control.value = ''; expenseDate.control.value = ''; dateEdited = false; voucherNote.control.value = ''; expenses = []; addRow(); renderExpenses();
    submit.querySelector('span').textContent = '提交审核申请';
  }
  async function send() {
    if (busy || !files.length) return;
    submitFeedback.replaceChildren(); submitFeedback.hidden = true;
    let invalid;
    for (const entry of [activity, name, expenseDate, amount, purpose, ...expenses.flatMap(row => [...(typedUploads ? [row.category] : []), row.label, row.amount])]) {
      entry.setError(null); if (!entry.control.value.trim()) { entry.setError('请填写此项'); invalid ||= entry.control; }
    }
    for (const row of expenses) if (cents(row.amount.control.value.trim()) === null) { row.amount.setError('请填写正数金额，最多两位小数'); invalid ||= row.amount.control; }
    if (bankAccountSupported) {
      const error = bankAccountError(bankAccount.control.value);
      bankAccount.setError(error || null); if (error) invalid ||= bankAccount.control;
    }
    if (invalid) { invalid.focus(); return; }
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
        const data = new FormData(); files.forEach(entry => data.append(typedUploads ? entry.kind === 'invoice' ? 'invoices' : 'supporting' : 'files', entry.file));
        if (typedUploads) data.append('manifest', JSON.stringify(files.map(entry => ({ expenseItemId: entry.expenseItemId, materialType: entry.materialType || '' }))));
        const uploaded = await api.upload(data);
        if (disposed) return;
        bundle = uploaded.bundle;
      }
      const result = await api.submit({ name: name.control.value.trim(), amount: amount.control.value.trim(),
        ...(bankAccountSupported ? { bankAccount: bankAccount.control.value } : {}),
        purpose: purpose.control.value.trim(), bundleId: bundle.id, idempotencyKey: key,
        activityId: activity.control.value, expenseDate: expenseDate.control.value, voucherNote: voucherNote.control.value.trim(),
        expenseItems: expenses.map(row => ({ ...(typedUploads ? { id: row.id, category: row.category.control.value.trim() } : {}), label: row.label.control.value.trim(), amount: row.amount.control.value.trim(), note: row.note.control.value.trim() })) }, resubmitId);
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
    mine.replaceChildren(...data.requests.map(item => h('div', { class: 'material-finance-row' },
      h('div', { class: 'material-finance-row__body' }, h('div', { class: 'row-3 row-wrap' }, h('b', { text: reimbursementAmount(item.amountCents) }), reimbursementStatus(item)),
        h('p', { class: 't-secondary', text: item.purpose }), h('p', { class: 't-caption', text: item.code }),
        item.status === 'returned' ? h('p', { class: 't-caption', text: `补充要求：${item.history.at(-1)?.note || ''}` }) : null),
      h('div', { class: 'row-2 row-wrap' }, button({ label: '查看材料与记录', variant: 'ghost', onClick: () => {
        const detail = bundleDetails(item.bundle, { withPreview: false });
        openDrawer({ title: item.code, width: 820, body: [requestInfo(item), detail], onClose: () => detail.dispose() });
      } }), item.status === 'returned' ? button({ label: '补充后重提', variant: 'secondary', onClick: () => {
        if (busy) return; reset(); resubmitId = item.id; name.control.value = item.name;
        bankAccount.control.value = item.bankAccount || '';
        amount.control.value = (item.amountCents / 100).toFixed(2); purpose.control.value = item.purpose;
        activity.control.value = item.activityId || ''; expenseDate.control.value = item.expenseDate || ''; voucherNote.control.value = item.voucherNote || '';
        dateEdited = Boolean(item.expenseDate);
        expenses = []; (item.expenseItems?.length ? item.expenseItems : [{ label: item.purpose, amountCents: item.amountCents, note: '' }]).forEach(row => addRow({ id: row.id, category: row.category, label: row.label, amount: (row.amountCents / 100).toFixed(2), note: row.note })); renderExpenses();
        editMessage.textContent = `正在补充 ${item.code}：${item.history.at(-1)?.note || ''}`; cancelEdit.hidden = false;
        submit.querySelector('span').textContent = '提交补充材料'; form.scrollIntoView({ behavior: 'smooth', block: 'start' }); name.control.focus();
      } }) : null))));
    if (!data.requests.length) mine.append(materialEmpty('暂无报销申请', '提交后可在这里查看审核进度和补充意见。', 'file'));
  }
  (async () => {
    try {
      const config = await api.config(); if (disposed) return;
      bankAccountSupported = Boolean(config.bankAccount);
      bankAccount.hidden = !bankAccountSupported;
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
      const cutoff = isoDaysAgo(30);
      const sorted = [...activities].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const recent = sorted.filter(item => item.date && item.date >= cutoff);
      const older = sorted.filter(item => !(item.date && item.date >= cutoff));
      let showAll = recent.length === 0;
      const activityToggle = button({ label: '查看全部活动', variant: 'ghost', size: 'sm', onClick: () => { showAll = !showAll; renderActivityOptions(); } });
      function renderActivityOptions() {
        const previous = activity.control.value;
        const visible = showAll ? sorted : recent;
        activity.control.replaceChildren(h('option', { value: '', text: '请选择对应活动' }),
          ...visible.map(item => h('option', { value: item.id, text: `${item.name}${item.date ? ` · ${item.date}` : ''}` })));
        activity.control.value = visible.some(item => item.id === previous) ? previous : '';
        activityToggle.querySelector('span').textContent = showAll ? `只看近 30 天（${recent.length} 场）` : `查看全部活动（${activities.length} 场）`;
      }
      renderActivityOptions();
      activityExtras.replaceChildren(older.length ? activityToggle : null);
      if (config.activityWarning) work.append(notice(config.activityWarning, { tone: 'warning' }));
      if (!activities.length) work.append(notice('暂无可选活动。请联系管理员补充活动资料后重新打开；不会显示模拟活动。', { tone: 'warning' }));
      work.append(form,
        h('section', { class: 'stack-3' }, h('div', { class: 'row-3 row-wrap' }, h('h2', { class: 't-h3', text: '我的报销申请' }),
          button({ label: '刷新状态', variant: 'ghost', onClick: () => loadMine().catch(error => status.replaceChildren(notice(error.message, { tone: 'error' }))) }),
          hasPermission('materials') ? button({ label: '打开审核管理', variant: 'ghost', href: '/console/reimbursements' }) : null), mine));
      renderFiles(); await loadMine();
    } catch (error) { status.replaceChildren(notice(error.status === 404 ? '当前环境尚未启用报销申请，请稍后再试。' : error.message, { tone: 'warning' })); }
  })();
  return { title: '财务报销', node, dispose: () => { disposed = true; } };
}
