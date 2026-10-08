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

export default async function reimbursementsPage() {
  if (!isSignedIn()) return { title: '财务报销', node: h('div', { class: 'view formpage' }, materialServices('finance'), loginRequiredPanel({ what: '报销申请' })) };
  const status = h('div', { aria: { live: 'polite' } });
  const work = h('div', { class: 'stack-5' });
  const mine = h('div', { class: 'material-finance-list' });
  const node = h('div', { class: 'view formpage material-finance-page' }, materialServices('finance'),
    h('header', { class: 'stack-3' }, h('h1', { class: 't-h1', text: '财务报销' }),
      h('p', { class: 't-prose', text: '整理材料、提交申请，随后在这里查看审核意见。' })), status, work);
  let files = [], bundle = null, bundleNode, resubmitId = null, key = operationKey(), busy = false, disposed = false;
  const name = field({ label: '申请人姓名', name: 'reimbursementName', required: true, maxlength: 50 });
  const amount = field({ label: '报销金额（元）', name: 'reimbursementAmount', type: 'text', required: true, placeholder: '例如 128.50' });
  amount.control.readOnly = true;
  name.control.value = getSessionState().user?.realName || '';
  const activity = field({ label: '关联活动', name: 'reimbursementActivity', searchable: true, required: true, options: [{ value: '', label: '正在读取活动目录' }] });
  const expenseDate = field({ label: '费用发生日期', name: 'expenseDate', type: 'date', required: true });
  const voucherNote = field({ label: '凭证说明', name: 'voucherNote', multiline: true, rows: 2, maxlength: 1000, placeholder: '可说明发票与明细的对应关系' });
  const expenseList = h('div', { class: 'stack-3' });
  let expenses = [], activities = [], expenseSequence = 0;
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
    const entry = { label: field({ label: '支出项目', name: `expenseLabel${sequence}`, required: true, maxlength: 100, value: row.label || '', placeholder: '例如：便利用品' }),
      amount: field({ label: '金额（元）', name: `expenseAmount${sequence}`, required: true, value: row.amount || '', placeholder: '0.00' }),
      note: field({ label: '用途 / 备注', name: `expenseNote${sequence}`, maxlength: 300, value: row.note || '' }) };
    entry.amount.control.inputMode = 'decimal';
    [entry.label, entry.amount, entry.note].forEach(field => field.control.addEventListener('input', () => { field.setError(null); total(); }));
    expenses.push(entry);
  }
  function renderExpenses() {
    expenseList.replaceChildren(...expenses.map((row, index) => h('div', { class: 'material-expense-row' },
      h('p', { class: 't-caption', text: `第 ${index + 1} 项` }), h('div', { class: 'formgrid' }, row.label, row.amount), row.note,
      button({ label: '移除此项', variant: 'ghost', size: 'sm', disabled: expenses.length === 1 || busy, onClick: () => {
        if (busy || expenses.length === 1) return; expenses.splice(index, 1); renderExpenses();
      } })))); total(); addExpense.disabled = busy || expenses.length >= 50;
  }
  addRow(); renderExpenses();
  amount.control.inputMode = 'decimal';
  const purpose = field({ label: '报销事由', name: 'reimbursementPurpose', multiline: true, rows: 2, required: true, maxlength: 500 });
  [name, amount, purpose].forEach(entry => entry.control.addEventListener('input', () => entry.setError(null)));
  const uploadInput = h('input', { class: 'material-upload__input', type: 'file', id: 'reimbursement-files', accept: '.pdf,application/pdf', multiple: true });
  const list = h('ul', { class: 'material-file-list' });
  const fileSummary = h('p', { class: 't-caption', aria: { live: 'polite' }, text: '尚未选择材料' });
  const submitHint = h('p', { class: 't-secondary', aria: { live: 'polite' }, text: '选择 PDF 并合并预览后，即可提交审核。' });
  const processed = h('section', { class: 'material-prepared', hidden: true });
  const editMessage = h('p', { class: 't-caption', aria: { live: 'polite' } });
  const merge = button({ label: '合并并预览材料', variant: 'secondary', iconName: 'file', onClick: prepare });
  const submit = button({ label: '提交审核申请', variant: 'primary', onClick: send });
  submit.disabled = true;
  const cancelEdit = button({ label: '取消补充', variant: 'ghost', onClick: () => reset() }); cancelEdit.hidden = true;
  const form = h('div', { class: 'panel material-application' }, h('div', { class: 'panel__body stack-6' },
    editMessage,
    h('section', { class: 'stack-4' }, materialSection('申请信息', '填写申请人与本次报销事由。', '01'),
      activity, h('div', { class: 'formgrid' }, name, expenseDate), purpose,
      materialSection('支出明细', '一笔申请可填写多项支出，合计按明细自动计算。'), expenseList, addExpense, amount, voucherNote),
    h('section', { class: 'stack-4 material-upload-section' }, materialSection('整理材料', '按列表顺序合并，可调整顺序并保留原件。', '02'),
      h('div', { class: 'material-upload' }, uploadInput,
        h('label', { for: 'reimbursement-files', class: 'material-upload__label' }, icon('upload'),
          h('b', { text: '选择 PDF 材料' }), h('span', { class: 't-secondary', text: '支持一次选择多份，可继续添加' }))),
      h('p', { class: 't-caption', text: `最多 ${UPLOAD_LIMITS.files} 份 · 单份 ${UPLOAD_LIMITS.fileMB} MB · 总计 ${UPLOAD_LIMITS.totalMB} MB · 合计不超过 ${UPLOAD_LIMITS.pages} 页` }),
      list, h('div', { class: 'material-file-actions' }, fileSummary, merge)),
    processed), h('footer', { class: 'panel__foot material-submit-bar' }, submitHint,
    h('div', { class: 'row-3 row-wrap' }, cancelEdit, submit)));
  function invalidate() {
    bundle = null; bundleNode?.dispose(); bundleNode = null; processed.replaceChildren(); processed.hidden = true;
    submit.disabled = true; submitHint.textContent = '选择 PDF 并合并预览后，即可提交审核。'; key = operationKey();
  }
  function lock(value) {
    busy = value;
    for (const control of [name.control, amount.control, purpose.control, activity.control, expenseDate.control, voucherNote.control,
      ...expenses.flatMap(row => [row.label.control, row.amount.control, row.note.control]), addExpense, uploadInput, merge, submit, cancelEdit,
      ...expenseList.querySelectorAll('button'), ...list.querySelectorAll('button')]) control.disabled = value;
    if (!value) { submit.disabled = !bundle || !activities.length; merge.disabled = !files.length; renderExpenses(); }
  }
  function renderFiles() {
    fileSummary.textContent = files.length ? `已选择 ${files.length} 份 · ${(files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(2)} MB` : '尚未选择材料';
    list.replaceChildren(...files.map((file, index) => h('li', {}, icon('file', 'ico ico--sm'),
      h('span', { class: 'material-file-list__name', text: `${index + 1}. ${file.name}` }), h('div', { class: 'material-file-list__actions' },
      button({ label: '上移', size: 'sm', variant: 'ghost', disabled: index === 0, ariaLabel: `${file.name} 上移`, onClick: () => move(index, -1) }),
      button({ label: '下移', size: 'sm', variant: 'ghost', disabled: index === files.length - 1, ariaLabel: `${file.name} 下移`, onClick: () => move(index, 1) }),
      button({ label: '移除', size: 'sm', variant: 'ghost', ariaLabel: `移除 ${file.name}`, onClick: () => { if (busy) return; files.splice(index, 1); invalidate(); renderFiles(); } })))));
    merge.disabled = !files.length;
  }
  function move(index, direction) {
    if (busy || index + direction < 0 || index + direction >= files.length) return;
    [files[index], files[index + direction]] = [files[index + direction], files[index]];
    invalidate(); renderFiles();
  }
  uploadInput.addEventListener('change', () => {
    const added = [...uploadInput.files]; uploadInput.value = '';
    const next = [...files, ...added];
    if (next.length > UPLOAD_LIMITS.files || next.some(file => !/\.pdf$/i.test(file.name) || !file.size || file.size > UPLOAD_LIMITS.fileMB * MB)
      || next.reduce((sum, file) => sum + file.size, 0) > UPLOAD_LIMITS.totalMB * MB) {
      status.replaceChildren(notice('请按数量和大小限制上传 PDF。原列表已保留。', { tone: 'warning' })); return;
    }
    files = next; invalidate(); renderFiles();
  });
  async function prepare() {
    if (busy || !files.length) return;
    lock(true); merge.dataset.loading = 'true'; status.replaceChildren(notice('正在整理 PDF，请稍候。', { tone: 'info' }));
    try {
      const data = new FormData(); files.forEach(file => data.append('files', file));
      const result = await api.upload(data);
      if (disposed) return;
      bundleNode?.dispose(); bundle = result.bundle; bundleNode = bundleDetails(bundle);
      processed.replaceChildren(materialSection('预览与检查', '核对合并顺序、页码与原件；需要时进行发票识别。', '03'), bundleNode); processed.hidden = false;
      submitHint.textContent = `${bundle.sources.length} 份材料已整理 · ${bundle.pageCount} 页，核对后提交审核。`;
      status.replaceChildren();
    } catch (error) { status.replaceChildren(notice(error.message, { tone: 'error', title: '材料整理失败' })); }
    finally { delete merge.dataset.loading; lock(false); renderFiles(); }
  }
  function reset() {
    resubmitId = null; files = []; invalidate(); renderFiles(); editMessage.textContent = ''; cancelEdit.hidden = true;
    name.control.value = getSessionState().user?.realName || ''; amount.control.value = ''; purpose.control.value = '';
    activity.control.value = ''; expenseDate.control.value = ''; voucherNote.control.value = ''; expenses = []; addRow(); renderExpenses();
    submit.querySelector('span').textContent = '提交审核申请';
  }
  async function send() {
    if (busy || !bundle) return;
    let invalid;
    for (const entry of [activity, name, expenseDate, amount, purpose, ...expenses.flatMap(row => [row.label, row.amount])]) {
      entry.setError(null); if (!entry.control.value.trim()) { entry.setError('请填写此项'); invalid ||= entry.control; }
    }
    for (const row of expenses) if (cents(row.amount.control.value.trim()) === null) { row.amount.setError('请填写正数金额，最多两位小数'); invalid ||= row.amount.control; }
    if (invalid) { invalid.focus(); return; }
    lock(true); submit.dataset.loading = 'true';
    try {
      const result = await api.submit({ name: name.control.value.trim(), amount: amount.control.value.trim(),
        purpose: purpose.control.value.trim(), bundleId: bundle.id, idempotencyKey: key,
        activityId: activity.control.value, expenseDate: expenseDate.control.value, voucherNote: voucherNote.control.value.trim(),
        expenseItems: expenses.map(row => ({ label: row.label.control.value.trim(), amount: row.amount.control.value.trim(), note: row.note.control.value.trim() })) }, resubmitId);
      if (disposed) return;
      status.replaceChildren(receipt({ title: '申请已进入审核队列', rows: [['申请编号', result.request.code], ['当前状态', result.request.statusLabel]] }));
      reset(); await loadMine();
    } catch (error) { status.replaceChildren(notice(error.message, { tone: 'error', title: '申请未提交，填写内容已保留' })); }
    finally { delete submit.dataset.loading; lock(false); renderFiles(); }
  }
  async function loadMine() {
    const data = await api.mine(); if (disposed) return;
    mine.replaceChildren(...data.requests.map(item => h('div', { class: 'material-finance-row' },
      h('div', { class: 'material-finance-row__body' }, h('div', { class: 'row-3 row-wrap' }, h('b', { text: reimbursementAmount(item.amountCents) }), reimbursementStatus(item)),
        h('p', { class: 't-secondary', text: item.purpose }), h('p', { class: 't-caption', text: item.code }),
        item.status === 'returned' ? h('p', { class: 't-caption', text: `补充要求：${item.history.at(-1)?.note || ''}` }) : null),
      h('div', { class: 'row-2 row-wrap' }, button({ label: '查看材料与记录', variant: 'ghost', onClick: () => {
        const detail = bundleDetails(item.bundle);
        openDrawer({ title: item.code, width: 820, body: [requestInfo(item), detail], onClose: () => detail.dispose() });
      } }), item.status === 'returned' ? button({ label: '补充后重提', variant: 'secondary', onClick: () => {
        if (busy) return; reset(); resubmitId = item.id; name.control.value = item.name;
        amount.control.value = (item.amountCents / 100).toFixed(2); purpose.control.value = item.purpose;
        activity.control.value = item.activityId || ''; expenseDate.control.value = item.expenseDate || ''; voucherNote.control.value = item.voucherNote || '';
        expenses = []; (item.expenseItems?.length ? item.expenseItems : [{ label: item.purpose, amountCents: item.amountCents, note: '' }]).forEach(row => addRow({ label: row.label, amount: (row.amountCents / 100).toFixed(2), note: row.note })); renderExpenses();
        editMessage.textContent = `正在补充 ${item.code}：${item.history.at(-1)?.note || ''}`; cancelEdit.hidden = false;
        submit.querySelector('span').textContent = '提交补充材料'; form.scrollIntoView({ behavior: 'smooth', block: 'start' }); name.control.focus();
      } }) : null))));
    if (!data.requests.length) mine.append(materialEmpty('暂无报销申请', '提交后可在这里查看审核进度和补充意见。', 'file'));
  }
  (async () => {
    try {
      const config = await api.config(); if (disposed) return;
      const activityData = await api.activities(); if (disposed) return;
      activities = activityData.activities;
      activity.control.replaceChildren(h('option', { value: '', text: '请选择对应活动' }), ...activities.map(item => h('option', { value: item.id, text: `${item.name}${item.date ? ` · ${item.date}` : ''}` })));
      if (config.activityWarning) work.append(notice(config.activityWarning, { tone: 'warning' }));
      if (!activities.length) work.append(notice('暂无可选活动。请联系管理员补充活动资料后重新打开；不会显示模拟活动。', { tone: 'warning' }));
      work.append(notice(config.notice, { tone: 'info' }), form,
        h('section', { class: 'stack-3' }, h('div', { class: 'row-3 row-wrap' }, h('h2', { class: 't-h3', text: '我的报销申请' }),
          button({ label: '刷新状态', variant: 'ghost', onClick: () => loadMine().catch(error => status.replaceChildren(notice(error.message, { tone: 'error' }))) }),
          hasPermission('materials') ? button({ label: '打开审核管理', variant: 'ghost', href: '/console/reimbursements' }) : null), mine));
      renderFiles(); await loadMine();
    } catch (error) { status.replaceChildren(notice(error.status === 404 ? '当前环境尚未启用报销申请，请使用本地物资预览。' : error.message, { tone: 'warning' })); }
  })();
  return { title: '财务报销', node, dispose: () => { disposed = true; bundleNode?.dispose(); } };
}
