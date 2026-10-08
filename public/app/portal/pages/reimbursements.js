import { h, icon } from '../../core/dom.js';
import { hasPermission } from '../../core/api.js';
import { button, field, notice, receipt } from '../../ui/primitives.js';
import { openDrawer } from '../../ui/overlay.js';
import { materialServices } from '../../shared/material-services.js';
import { reimbursementsApi as api, operationKey, reimbursementAmount } from '../../shared/reimbursements-api.js';
import { bundleDetails, requestInfo } from '../../shared/reimbursement-details.js';
import { materialEmpty, materialSection, reimbursementStatus } from '../../shared/material-ui.js';

export default async function reimbursementsPage() {
  const status = h('div', { aria: { live: 'polite' } });
  const work = h('div', { class: 'stack-5' });
  const mine = h('div', { class: 'material-finance-list' });
  const node = h('div', { class: 'view formpage material-finance-page' }, materialServices('finance'),
    h('header', { class: 'stack-3' }, h('h1', { class: 't-h1', text: '财务报销' }),
      h('p', { class: 't-prose', text: '整理材料、提交申请，随后在这里查看审核意见。' })), status, work);
  let files = [], bundle = null, bundleNode, resubmitId = null, key = operationKey(), busy = false, disposed = false;
  const name = field({ label: '申请人姓名', name: 'reimbursementName', required: true, maxlength: 50 });
  const amount = field({ label: '报销金额（元）', name: 'reimbursementAmount', type: 'text', required: true, placeholder: '例如 128.50' });
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
      h('div', { class: 'formgrid' }, name, amount), purpose),
    h('section', { class: 'stack-4 material-upload-section' }, materialSection('整理材料', '按列表顺序合并，可调整顺序并保留原件。', '02'),
      h('div', { class: 'material-upload' }, uploadInput,
        h('label', { for: 'reimbursement-files', class: 'material-upload__label' }, icon('upload'),
          h('b', { text: '选择 PDF 材料' }), h('span', { class: 't-secondary', text: '支持一次选择多份，可继续添加' }))),
      h('p', { class: 't-caption', text: '最多 10 份 · 单份 10 MB · 总计 30 MB · 合计不超过 100 页' }),
      list, h('div', { class: 'material-file-actions' }, fileSummary, merge)),
    processed), h('footer', { class: 'panel__foot material-submit-bar' }, submitHint,
    h('div', { class: 'row-3 row-wrap' }, cancelEdit, submit)));
  function invalidate() {
    bundle = null; bundleNode?.dispose(); bundleNode = null; processed.replaceChildren(); processed.hidden = true;
    submit.disabled = true; submitHint.textContent = '选择 PDF 并合并预览后，即可提交审核。'; key = operationKey();
  }
  function lock(value) {
    busy = value;
    for (const control of [name.control, amount.control, purpose.control, uploadInput, merge, submit, cancelEdit,
      ...list.querySelectorAll('button')]) control.disabled = value;
    if (!value) { submit.disabled = !bundle; merge.disabled = !files.length; }
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
    if (next.length > 10 || next.some(file => !/\.pdf$/i.test(file.name) || !file.size || file.size > 10 * 1024 * 1024)
      || next.reduce((sum, file) => sum + file.size, 0) > 30 * 1024 * 1024) {
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
    name.control.value = ''; amount.control.value = ''; purpose.control.value = ''; submit.querySelector('span').textContent = '提交审核申请';
  }
  async function send() {
    if (busy || !bundle) return;
    let invalid;
    for (const entry of [name, amount, purpose]) {
      entry.setError(null); if (!entry.control.value.trim()) { entry.setError('请填写此项'); invalid ||= entry.control; }
    }
    if (invalid) { invalid.focus(); return; }
    lock(true); submit.dataset.loading = 'true';
    try {
      const result = await api.submit({ name: name.control.value.trim(), amount: amount.control.value.trim(),
        purpose: purpose.control.value.trim(), bundleId: bundle.id, idempotencyKey: key }, resubmitId);
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
        editMessage.textContent = `正在补充 ${item.code}：${item.history.at(-1)?.note || ''}`; cancelEdit.hidden = false;
        submit.querySelector('span').textContent = '提交补充材料'; form.scrollIntoView({ behavior: 'smooth', block: 'start' }); name.control.focus();
      } }) : null))));
    if (!data.requests.length) mine.append(materialEmpty('暂无报销申请', '提交后可在这里查看审核进度和补充意见。', 'file'));
  }
  (async () => {
    try {
      const config = await api.config(); if (disposed) return;
      work.append(notice(config.notice, { tone: 'info' }), form,
        h('section', { class: 'stack-3' }, h('div', { class: 'row-3 row-wrap' }, h('h2', { class: 't-h3', text: '我的报销申请' }),
          button({ label: '刷新状态', variant: 'ghost', onClick: () => loadMine().catch(error => status.replaceChildren(notice(error.message, { tone: 'error' }))) }),
          hasPermission('materials') ? button({ label: '打开审核管理', variant: 'ghost', href: '/console/reimbursements' }) : null), mine));
      renderFiles(); await loadMine();
    } catch (error) { status.replaceChildren(notice(error.status === 404 ? '当前环境尚未启用报销申请，请使用本地物资预览。' : error.message, { tone: 'warning' })); }
  })();
  return { title: '财务报销', node, dispose: () => { disposed = true; bundleNode?.dispose(); } };
}
