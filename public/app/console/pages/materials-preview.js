/* ==========================================================================
   console/pages/materials.js — inventory operations cockpit.
   Order of priority: tasks (approve / overdue / low stock) → ledger → flows.
   Stock movements preview quantities before the confirmation step.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { navigate } from '../../core/router.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { shake, prefersReducedMotion } from '../../core/motion.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { dataTable } from '../../ui/table.js';
import { asyncRegion, region, reloadAction } from '../lib.js';
import {
  pageHead, metric, metricRow, badge, button, field, notice, receipt, impactPreview,
  emptyState, segmented, skeletonMetrics, skeletonRows, statusFor, statusIndicator,
  definitionList, copyableCode, runWithLoading, barTrack,
} from '../../ui/primitives.js';

import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { integerInput, returnProgress, returnPreview, flowsCsv, inventoryLifecycleEnabled, inventoryOperationAllowed, applicationActions } from '../materials-model.js';
import { openInventoryCreateDrawer, openAvailabilityDrawer } from '../materials-lifecycle.js';
import { materialServices } from '../../shared/material-services.js';
import { watchMaterialChanges } from '../../shared/materials-sync.js';

function applicationStatus(status) {
  if (!/待审批|待审核/.test(status)) return statusFor(status);
  const indicator = statusIndicator(status, { tone: 'error' });
  indicator.classList.add('material-pending-status');
  return indicator;
}

const OPERATIONS = [
  { value: '入库', label: '入库', tone: 'success', needsDestination: false, hint: '新采购、回收或补充的物资进入库存。' },
  { value: '出库', label: '出库', tone: 'accent', needsDestination: true, hint: '不经借用单的直接领用，必须写明流转去向。' },
  { value: '盘点增加', label: '盘点增加', tone: 'info', needsDestination: false, hint: '盘点发现实际数量多于台账。' },
  { value: '盘点减少', label: '盘点减少', tone: 'warning', needsDestination: false, hint: '盘点发现实际数量少于台账。' },
  { value: '报损', label: '报损', tone: 'error', needsDestination: false, hint: '确认损坏、失效或无法继续使用。' },
];

function newIdempotencyKey(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

async function submitWithLoading(node, task) {
  node.disabled = true;
  node.setAttribute('aria-busy', 'true');
  try {
    return await runWithLoading(node, task);
  } finally {
    node.disabled = false;
    node.removeAttribute('aria-busy');
  }
}

function inventoryHealth(item) {
  if (item.availability === 'disabled') return badge('停用', { tone: 'warning', iconName: 'close' });
  if (item.thresholdEnabled === false) return badge('预警未启用', { tone: 'neutral' });
  if (item.thresholdStatus === 'critical') return badge('低库存', { tone: 'warning', iconName: 'alert' });
  if (item.thresholdStatus === 'notice') return badge('阈值待校准', { tone: 'neutral', iconName: 'info' });
  return badge('正常', { tone: 'success', iconName: 'check' });
}

function thresholdText(item) {
  return item.thresholdEnabled === false || item.threshold === null ? '未启用' : `${item.threshold} ${item.unit}`;
}

async function openInventoryEditDrawer(item, { onDone }) {
  const resultSlot = h('div', { class: 'stack-4' }, skeletonRows(4));
  const saveStatus = h('div', { aria: { live: 'polite' } });
  const submitButton = button({ label: '保存物资资料', variant: 'primary', iconName: 'check', onClick: () => submit() });
  submitButton.disabled = true;
  const drawer = openDrawer({
    eyebrow: '物资资料维护', title: item.name, description: item.code, width: 520,
    body: [notice('库存数量通过出入库、盘点和报损调整。这里只维护名称、单位、存放位置和预警设置。', { tone: 'info' }), resultSlot, saveStatus],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });
  const controls = new Map();
  let schema;

  async function loadSchema() {
    submitButton.disabled = true;
    controls.clear();
    clear(resultSlot);
    resultSlot.append(skeletonRows(4));
    try {
      schema = await consoleApi.materials.schema();
      clear(resultSlot);
      const labels = { name: '物资名称', unit: '计量单位', center: '存放中心', cabinet: '柜号', level: '层数', threshold: '预警阈值', thresholdEnabled: '启用库存预警' };
      for (const [name, label] of Object.entries(labels)) {
        const meta = schema.fields?.[name];
        const editable = meta?.editable === true;
        const options = name === 'thresholdEnabled' ? [{ value: 'true', label: '启用' }, { value: 'false', label: '关闭' }] : meta?.options?.length
          ? meta.options.map((option) => typeof option === 'string' ? { value: option, label: option } : { value: option.value ?? option.name ?? option.label, label: option.label ?? option.name ?? option.value }) : null;
        const value = name === 'thresholdEnabled' ? String(item.thresholdEnabled ?? (item.threshold !== null)) : item[name] ?? '';
        if (options && !options.some((option) => String(option.value) === String(value))) options.unshift({ value, label: `${value || '未设置'}（当前值）` });
        const control = field({ label, name, value, options, disabled: !editable, type: meta?.type === 'number' || name === 'threshold' ? 'number' : 'text', min: 0, step: 1, maxlength: 120, required: name === 'name', hint: !editable ? '数据表中没有可编辑的对应列。' : name === 'threshold' ? '低于或等于该数量时预警。' : '' });
        controls.set(name, { field: control, meta, initialValue: String(value) });
        resultSlot.append(control);
      }
      const enabled = controls.get('thresholdEnabled').field.control;
      const syncThreshold = () => { controls.get('threshold').field.control.disabled = !controls.get('threshold').meta?.editable || enabled.value === 'false'; };
      enabled.addEventListener('change', syncThreshold);
      syncThreshold();
      submitButton.disabled = !Object.values(schema.fields || {}).some((meta) => meta.editable);
      [...controls.values()].find((entry) => !entry.field.control.disabled)?.field.control.focus();
    } catch (error) {
      clear(resultSlot);
      resultSlot.append(notice(error.message || '物资字段无法加载。', { tone: 'error', title: '资料配置加载失败' }), button({ label: '重试加载', variant: 'secondary', onClick: loadSchema }));
    }
  }

  async function submit() {
    const body = {};
    let firstError;
    const enabled = controls.get('thresholdEnabled')?.field.control.value !== 'false';
    const enabling = enabled && controls.get('thresholdEnabled')?.initialValue === 'false';
    for (const [name, entry] of controls) {
      entry.field.setError(null);
      if (!entry.meta?.editable) continue;
      if (name === 'threshold' && !enabled) continue;
      const raw = entry.field.control.value.trim();
      if (raw === entry.initialValue && !(name === 'threshold' && enabling)) continue;
      let value = name === 'thresholdEnabled' ? raw === 'true' : raw;
      let error;
      if (name !== 'thresholdEnabled' && !raw) error = '请填写此项资料';
      if (name === 'threshold' || entry.meta.type === 'number') {
        value = integerInput(raw, { allowZero: true });
        if (value === null) error = '请填写非负整数';
      }
      if (name !== 'thresholdEnabled' && entry.meta.options?.length && !entry.meta.options.some((option) => String(typeof option === 'string' ? option : option.value ?? option.name ?? option.label) === raw)) error = '请选择数据表中已有的选项';
      if (error) { entry.field.setError(error); firstError ||= entry.field.control; }
      body[name] = value;
    }
    if (firstError) { firstError.focus(); return; }
    if (!Object.keys(body).length) { notify.info('没有需要保存的改动', '修改资料后再保存。'); return; }
    clear(saveStatus);
    try {
      const payload = await submitWithLoading(submitButton, () => consoleApi.materials.updateInventory(item.id, body));
      notify.success('物资资料已保存', payload.item?.name || item.name);
      drawer.close();
      onDone?.();
    } catch (error) {
      saveStatus.append(notice(error.message || '请检查填写内容后重试。', { tone: 'warning', title: error.code === 'material_metadata_partial' ? '部分资料已保存，请刷新核对' : '资料未保存' }));
    }
  }
  await loadSchema();
}

/* --------------------------------------------------------------------------
   Inventory transaction drawer
   -------------------------------------------------------------------------- */
function openTransactionDrawer(item, { defaultOperation = '入库', onDone }) {
  const allowedOperations = OPERATIONS.filter((entry) => inventoryOperationAllowed(item, entry.value));
  let operation = inventoryOperationAllowed(item, defaultOperation) ? defaultOperation : '盘点增加';
  const idempotencyKey = newIdempotencyKey('TX');

  const quantityField = field({ label: '数量', name: 'quantity', type: 'number', min: 1, step: 1, value: '1', required: true });
  const destinationField = field({ label: '流转去向', name: 'destination', placeholder: '例如：仙林校区献血宣传日 · 张同学领用', hint: '出库必须写明去向，便于后续追溯差额。' });
  const noteField = field({ label: '核查说明', name: 'note', multiline: true, rows: 2, maxlength: 1000, placeholder: '异常、损耗或与台账不一致的情况' });

  const hintNode = h('p', { class: 't-caption' });
  const impactSlot = h('div');
  const saveStatus = h('div', { aria: { live: 'polite' } });

  function delta() {
    const quantity = integerInput(quantityField.control.value) ?? 0;
    return ['入库', '盘点增加'].includes(operation) ? quantity : -quantity;
  }

  function renderImpact() {
    const config = OPERATIONS.find((entry) => entry.value === operation);
    hintNode.textContent = config?.hint || '';
    destinationField.hidden = !config?.needsDestination;
    noteField.control.required = ['盘点增加', '盘点减少', '报损'].includes(operation);
    noteField.control.placeholder = noteField.control.required ? '请说明盘点差额或报损原因（必填）' : '可选：记录交接或核查情况';
    clear(impactSlot);
    if (integerInput(quantityField.control.value) === null) {
      impactSlot.append(notice('请填写正整数数量后查看库存变化。', { tone: 'neutral' }));
      return;
    }
    const after = item.quantity + delta();
    impactSlot.append(...[
      impactPreview({ label: `${item.name} 当前数量`, from: item.quantity, to: after, unit: ` ${item.unit}` }),
      after < 0
        ? notice(`库存不足：当前只有 ${item.quantity} ${item.unit}，无法扣减 ${Math.abs(delta())} ${item.unit}。服务端也会拒绝这次写入。`, { tone: 'error', title: '无法提交' })
        : item.thresholdEnabled !== false && item.threshold !== null && after <= item.threshold
          ? notice(`提交后将低于预警阈值 ${item.threshold} ${item.unit}，建议同时安排补充。`, { tone: 'warning', title: '将触发低库存预警' })
          : null,
    ].filter(Boolean));
  }

  const operationControl = segmented({
    items: allowedOperations.map((entry) => ({ value: entry.value, label: entry.label })),
    value: operation,
    ariaLabel: '操作类型',
    onChange: (value) => {
      operation = value;
      operationControl.setValue(value);
      renderImpact();
    },
  });

  quantityField.control.addEventListener('input', renderImpact);

  const submitButton = button({ label: '预览并确认写入', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '库存操作',
    title: item.name,
    description: `${item.code} · ${item.center} · ${item.cabinet} 柜 ${item.level} 层`,
    width: 520,
    body: [
      item.availability === 'disabled' ? notice('此物资已停用，仍可核查盘点或报损；禁止入库与新增出库。', { tone: 'warning' }) : null,
      definitionList([
        ['资产编码', copyableCode(item.code)],
        ['当前数量', `${item.quantity} ${item.unit}`],
        ['初始数量', `${item.initial} ${item.unit}`],
        ['预警阈值', thresholdText(item)],
      ]),
      h('hr', { class: 'divider' }),
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '操作类型' }), operationControl, hintNode),
      quantityField,
      destinationField,
      noteField,
      impactSlot,
      saveStatus,
    ],
    footer: [
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      submitButton,
    ],
  });

  renderImpact();

  async function submit() {
    quantityField.setError(null);
    destinationField.setError(null);
    noteField.setError(null);
    if (!inventoryOperationAllowed(item, operation)) {
      saveStatus.replaceChildren(notice('此物资已停用，不能登记入库或新增出库。', { tone: 'warning' }));
      return;
    }
    const quantity = integerInput(quantityField.control.value);
    if (quantity === null) {
      quantityField.setError('数量必须是正整数');
      quantityField.control.focus();
      shake(quantityField);
      return;
    }
    const config = OPERATIONS.find((entry) => entry.value === operation);
    if (config?.needsDestination && !destinationField.control.value.trim()) {
      destinationField.setError('出库必须填写流转去向');
      destinationField.control.focus();
      shake(destinationField);
      return;
    }
    if (noteField.control.required && !noteField.control.value.trim()) {
      noteField.setError('请填写盘点差额或报损原因');
      noteField.control.focus();
      return;
    }
    if (item.quantity + delta() < 0) {
      shake(impactSlot);
      notify.warning('库存不足', '请调整数量后再提交。');
      return;
    }

    const confirmed = await submitWithLoading(submitButton, () => confirmAction({
      title: `确认${operation} ${quantity} ${item.unit}？`,
      description: `${item.name}（${item.code}）的当前数量将从 ${item.quantity} 变为 ${item.quantity + delta()} ${item.unit}。`,
      confirmLabel: `确认${operation}`,
      tone: operation === '报损' || operation === '盘点减少' ? 'danger' : 'neutral',
    }));
    if (!confirmed) return;

    clear(saveStatus);
    try {
      const payload = await submitWithLoading(submitButton, () =>
        consoleApi.materials.transaction({
          assetCode: item.code,
          operation,
          quantity,
          destination: destinationField.control.value.trim(),
          note: noteField.control.value.trim(),
          idempotencyKey,
        }),
      );
      if (payload.duplicate) {
        notify.info('这次操作已经记录过', '库存已更新。');
      } else {
        notify.success(`${operation}已记录`, `${item.name} · ${quantity} ${item.unit}`);
      }
      drawer.setBody(
        receipt({
          title: `${operation}已写入物资流水`,
          rows: [
            ['物资', `${item.name}（${item.code}）`],
            ['操作', `${operation} ${quantity} ${item.unit}`],
            ['操作后库存', payload.item ? `${payload.item.quantity} ${payload.item.unit || item.unit}` : '请刷新台账核对实际数量'],

          ],
        }),
        notice('可以在「出入库流水」中核对这条记录。', { tone: 'info' }),
      );
      drawer.setFooter(h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() }));
      onDone?.();
    } catch (error) {
      saveStatus.replaceChildren(notice(error.message || '请保留填写内容，核对后重试。', { tone: 'error', title: '库存操作未完成' }));
      if (error instanceof ApiError && (error.isConflict || error.status === 400)) {
        notify.warning('写入被拒绝', error.message);
        return;
      }
      reportError(error, '库存操作未完成');
    }
  }
}

/* --------------------------------------------------------------------------
   Application action drawers
   -------------------------------------------------------------------------- */
function openRejectDrawer(application, { onDone }) {
  const reasonField = field({ label: '不通过理由', name: 'reason', required: true, multiline: true, rows: 3, placeholder: '说明原因，便于申请人调整后重新提交' });
  const submitButton = button({ label: '确认不通过', variant: 'danger', iconName: 'close', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '借用审批',
    title: `不通过：${application.purpose}`,
    description: `${application.applicant} · ${application.items}`,
    width: 460,
    body: [
      notice('不通过后申请状态会变为「审批不通过」，理由会写入 SeaTable，申请人可以据此调整后重新申请。', { tone: 'warning' }),
      reasonField,
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    reasonField.setError(null);
    const reason = reasonField.control.value.trim();
    if (!reason) {
      reasonField.setError('必须填写不通过理由');
      shake(reasonField);
      return;
    }
    try {
      await submitWithLoading(submitButton, () => consoleApi.materials.reject(application.id, reason));
      notify.success('已登记不通过', application.purpose);
      drawer.close();
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && (error.isConflict || error.status === 400)) {
        notify.warning('操作被拒绝', error.message);
        return;
      }
      reportError(error, '审批未完成');
    }
  }
}

function openFulfilmentDrawer(application, inventory, { mode, onDone }) {
  const isCheckout = mode === 'checkout';
  const idempotencyKey = newIdempotencyKey(isCheckout ? 'OUT' : 'RET');
  const previous = returnProgress(application);
  const originalItem = inventory.find((item) => item.code === application.assetCode);
  if (application.syncPending || application.returnProgress === 'unverified' || (!isCheckout && !originalItem)) {
    notify.warning('暂时不能登记', application.syncPending ? '请先在出入库流水中恢复申请状态同步。' : '原出库或归还历史尚未核实，请先核查历史流水。');
    return;
  }

  const assetField = field({
    label: '资产编码',
    name: 'assetCode',
    required: true,
    value: isCheckout ? '' : application.assetCode,
    disabled: !isCheckout,
    hint: isCheckout ? '' : '归还固定关联原出库资产，不能改为其他物资。',
    options: [{ value: '', label: '请选择库存物资' }, ...inventory.filter((item) => !isCheckout || inventoryOperationAllowed(item, '出库')).map((item) => ({ value: item.code, label: `${item.name} · ${item.code} · 现有 ${item.quantity} ${item.unit}${item.availability === 'disabled' ? ' · 停用（允许归还）' : ''}` }))],
  });
  const quantityField = field({ label: isCheckout ? '出库数量' : '实际归还数量', name: 'quantity', type: 'number', min: isCheckout ? 1 : 0, step: 1, value: String(isCheckout ? application.quantity || 1 : previous.outstanding), required: true });
  const lossField = isCheckout ? null : field({ label: '损耗数量', name: 'lossQuantity', type: 'number', min: 0, step: 1, value: '0', hint: '无法归还、损坏或丢失的件数。填写后申请会标记为归还异常。' });
  const destinationField = isCheckout ? field({ label: '流转去向', name: 'destination', value: `${application.applicant} · ${application.purpose}`, hint: '默认使用申请人与借用用途，可按实际情况调整。' }) : null;
  const noteField = field({ label: isCheckout ? '出库备注' : '归还核查说明', name: 'note', multiline: true, rows: 2, maxlength: 1000, placeholder: isCheckout ? '现场交接情况' : '外观、配件与功能核查结果' });

  const photoInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'input file-input' });
  const photoPreview = h('div', { class: 'photo-preview', hidden: true });
  const photoError = h('p', { class: 'field__error', hidden: true });
  const photoId = `material-photo-${idempotencyKey}`;
  photoInput.id = photoId;
  photoError.id = `${photoId}-error`;
  photoError.setAttribute('aria-live', 'polite');
  photoInput.setAttribute('aria-describedby', photoError.id);
  let photoVersion = 0;

  function validatePhoto({ requirePhoto = false } = {}) {
    const file = photoInput.files?.[0];
    const message = !file && requirePhoto
      ? '借出出库必须上传现场照片作为留痕证据。'
      : file && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
      ? '请选择 JPG、PNG 或 WebP 图片。'
      : file && file.size > 8 * 1024 * 1024 ? '单张照片不能超过 8 MB。' : null;
    photoError.hidden = !message;
    photoError.textContent = message || '';
    photoInput.setAttribute('aria-invalid', String(Boolean(message)));
    return !message;
  }

  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    const version = ++photoVersion;
    clear(photoPreview);
    photoPreview.hidden = true;
    if (!validatePhoto() || !file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (version !== photoVersion) return;
      const image = h('img', { class: 'photo-preview__img', alt: '现场照片预览', src: reader.result });
      photoPreview.hidden = false;
      photoPreview.append(image, h('p', { class: 't-caption', text: `${file.name} · ${(file.size / 1024).toFixed(0)} KB` }));
    });
    reader.readAsDataURL(file);
  });

  const impactSlot = h('div');
  const saveStatus = h('div', { aria: { live: 'polite' } });

  function selectedItem() {
    return inventory.find((item) => item.code === assetField.control.value) || null;
  }

  function renderImpact() {
    const item = selectedItem();
    clear(impactSlot);
    if (!item) {
      impactSlot.append(notice('请先选择本次实际使用的库存物资，出入库会绑定到这个资产编码。', { tone: 'neutral' }));
      return;
    }
    if (isCheckout && !inventoryOperationAllowed(item, '出库')) {
      impactSlot.append(notice('此物资已停用，不能用于新增借出。请选择启用的物资。', { tone: 'error' }));
      return;
    }
    const quantity = integerInput(quantityField.control.value, { allowZero: !isCheckout });
    const loss = isCheckout ? 0 : integerInput(lossField.control.value, { allowZero: true });
    if (quantity === null || loss === null) {
      impactSlot.append(notice('请填写整数数量后查看库存与结算预览。', { tone: 'neutral' }));
      return;
    }
    const after = item.quantity + (isCheckout ? -quantity : quantity);
    impactSlot.append(...[
      impactPreview({ label: `${item.name} 当前数量`, from: item.quantity, to: after, unit: ` ${item.unit}` }),
      after < 0 ? notice(`库存不足：当前 ${item.quantity} ${item.unit}。`, { tone: 'error', title: '无法提交' }) : null,
    ].filter(Boolean));
    if (!isCheckout) {
      const progress = returnPreview(application, quantity, loss);
      impactSlot.append(
        notice(
          progress.exceeds
            ? `实际归还与损耗之和不能超过剩余待核销的 ${previous.outstanding} ${item.unit}。`
            : `已归还 ${previous.returned}、已登记损耗 ${previous.loss}；本次后累计归还 ${progress.returned}、损耗 ${progress.loss}，剩余待核销 ${progress.outstanding} / ${progress.borrowed} ${item.unit}。${progress.loss ? '损耗将保留在异常核查记录中。' : ''}`,
          { tone: progress.exceeds ? 'error' : progress.outstanding === 0 && progress.loss === 0 ? 'success' : 'warning', title: '累计归还结算预览' },
        ),
      );
    }
  }

  assetField.control.addEventListener('change', renderImpact);
  quantityField.control.addEventListener('input', renderImpact);
  lossField?.control.addEventListener('input', renderImpact);

  const submitButton = button({ label: isCheckout ? '确认出库' : '确认归还', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: isCheckout ? '登记出库' : '登记归还',
    title: application.purpose,
    description: `${application.applicant} · ${application.items} · ${application.quantity} 件`,
    width: 540,
    body: [
      assetField,
      h('div', { class: 'formgrid' }, quantityField, lossField),
      destinationField,
      h(
        'div',
        { class: 'field' },
        h(
          'label',
          { class: 'field__label', for: photoId },
          h('span', { text: isCheckout ? '现场照片' : '归还照片' }),
          isCheckout ? h('span', { class: 'field__req', text: '必填' }) : null,
        ),
        photoInput,
        photoError,
        h('p', { class: 'field__hint', text: 'JPG / PNG / WebP，单张不超过 8 MB。多次操作的照片会追加保存。' }),
        photoPreview,
      ),
      noteField,
      impactSlot,
      saveStatus,
    ].filter(Boolean),
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  renderImpact();

  async function submit() {
    assetField.setError(null);
    quantityField.setError(null);
    lossField?.setError(null);
    noteField.setError(null);
    const item = selectedItem();
    if (!item) {
      assetField.setError('请选择资产编码');
      assetField.control.focus();
      shake(assetField);
      return;
    }
    if (isCheckout && !inventoryOperationAllowed(item, '出库')) {
      assetField.setError('停用物资不能用于新增借出');
      assetField.control.focus();
      return;
    }
    const quantity = integerInput(quantityField.control.value, { allowZero: !isCheckout });
    if (quantity === null) {
      quantityField.setError(isCheckout ? '数量必须是正整数' : '归还数量必须是非负整数');
      quantityField.control.focus();
      shake(quantityField);
      return;
    }
    const loss = isCheckout ? 0 : integerInput(lossField.control.value, { allowZero: true });
    if (loss === null) {
      lossField.setError('损耗数量必须是非负整数');
      lossField.control.focus();
      return;
    }
    if (!isCheckout && quantity + loss === 0) {
      quantityField.setError('请填写实际归还或损耗数量');
      quantityField.control.focus();
      return;
    }
    if (!isCheckout && quantity + loss > previous.outstanding) {
      quantityField.setError(`归还与损耗之和不能超过 ${previous.outstanding} ${item.unit}`);
      quantityField.control.focus();
      return;
    }
    if (isCheckout && quantity > item.quantity) {
      quantityField.setError(`当前库存只有 ${item.quantity} ${item.unit}`);
      quantityField.control.focus();
      return;
    }
    if (loss > 0 && !noteField.control.value.trim()) {
      noteField.setError('请说明损坏、丢失或无法归还的情况');
      noteField.control.focus();
      return;
    }
    if (!validatePhoto({ requirePhoto: isCheckout })) { photoInput.focus(); shake(photoInput); return; }
    const photo = photoInput.files?.[0] || null;

    const confirmed = await submitWithLoading(submitButton, () => confirmAction({
      title: isCheckout ? '确认登记出库？' : '确认登记归还？',
      description: isCheckout
        ? `${item.name}（${item.code}）出库 ${quantity} ${item.unit}，库存预览 ${item.quantity} → ${item.quantity - quantity}。`
        : `${item.name}（${item.code}）实际归还 ${quantity}、损耗 ${loss} ${item.unit}，登记后剩余待核销 ${previous.outstanding - quantity - loss} ${item.unit}。`,
      confirmLabel: isCheckout ? '确认出库' : '确认归还',
      tone: loss > 0 ? 'danger' : 'neutral',
    }));
    if (!confirmed) return;

    const form = new FormData();
    form.set('assetCode', item.code);
    form.set('quantity', String(quantity));
    form.set('note', noteField.control.value.trim());
    form.set('idempotencyKey', idempotencyKey);
    if (destinationField) form.set('destination', destinationField.control.value.trim());
    if (lossField) form.set('lossQuantity', String(loss));
    if (photo) form.set('photo', photo);

    clear(saveStatus);
    try {
      const payload = await submitWithLoading(submitButton, () =>
        isCheckout ? consoleApi.materials.checkout(application.id, form) : consoleApi.materials.returnItems(application.id, form),
      );
      if (payload.syncPending) notify.warning('流水已记录，状态待同步', payload.message || '请在出入库流水中重试同步，勿重复登记。');
      else if (payload.duplicate) notify.info('这次操作已经记录过', '请查看最新记录。');
      else notify.success(isCheckout ? '出库已登记' : '归还已登记', `${item.name} · ${quantity} ${item.unit}`);
      drawer.setBody(
        receipt({
          title: isCheckout ? '出库已写入流水' : '归还已写入流水',
          rows: [
            ['申请单', application.code],
            ['物资', `${item.name}（${item.code}）`],
            ['数量', `${quantity} ${item.unit}`],
            ...(!isCheckout ? [['本次损耗', `${loss} ${item.unit}`]] : []),
            ['操作后库存', payload.item ? `${payload.item.quantity} ${payload.item.unit || item.unit}` : '请刷新台账核对'],
            ...(payload.application && !isCheckout ? [
              ['累计归还 / 损耗', `${payload.application.returnedQuantity ?? '—'} / ${payload.application.lossQuantity ?? '—'} ${item.unit}`],
              ['剩余待核销', `${payload.application.outstandingQuantity ?? '—'} ${item.unit}`],
            ] : []),
          ],
        }),
        payload.syncPending ? notice(payload.message || '流水已保存，请在出入库流水中恢复同步。勿重新登记相同数量。', { tone: 'warning', title: '申请状态待同步' }) : null,
      );
      drawer.setFooter(h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() }));
      onDone?.();
    } catch (error) {
      saveStatus.replaceChildren(notice(error.message || '请保留填写内容和照片，核对后重试。', { tone: 'error', title: error.code === 'material_sync_pending' ? '请先恢复状态同步' : isCheckout ? '出库未完成' : '归还未完成' }));
      if (error instanceof ApiError && (error.isConflict || error.status === 400 || error.status === 502)) {
        notify.warning(error.code === 'material_sync_pending' ? '请先恢复状态同步' : '操作未完成', error.message);
        return;
      }
      reportError(error, isCheckout ? '出库未完成' : '归还未完成');
    }
  }
}

/* --------------------------------------------------------------------------
   Page
   -------------------------------------------------------------------------- */
export default async function materialsPage(context, shell) {
  let snapshot = null;
  let tab = ['tasks', 'inventory', 'applications', 'flows'].includes(context.query.get('tab')) ? context.query.get('tab') : 'tasks';
  let applicationFilter = 'all', inventoryHealthFilter = 'all';
  const actionCards = new Map();
  let inventoryAvailability = 'all';
  const flowState = { page: 1, pageSize: 25, q: '', assetCode: '', operation: '', operator: '', from: '', to: '', errorOnly: '' };
  let flowVersion = 0;

  const bodySlot = h('div', { class: 'stack-8' });

  const dataRegion = asyncRegion({
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(8)),
    errorTitle: '物资数据无法加载',
    load: options => consoleApi.materials.overview(options),
    render: (payload, { reload }) => {
      snapshot = payload;
      renderBody(reload);
      const incompleteReads = Object.entries(payload.reads || {}).filter(([, meta]) => meta?.truncated);
      return [
        renderSummary(payload),
        incompleteReads.length
          ? notice(`以下数据读取达到服务端上限：${incompleteReads.map(([name]) => name).join('、')}。当前统计是下界，不能视为完整总量。`, { tone: 'warning', title: '数据读取不完整' })
          : null,
        bodySlot,
      ];
    },
  });

  const tabControl = segmented({
    items: [
      { value: 'tasks', label: '任务队列' },
      { value: 'inventory', label: '库存台账' },
      { value: 'applications', label: '借用申请' },
      { value: 'flows', label: '出入库流水' },
    ],
    value: tab,
    ariaLabel: '物资管理视图',
    onChange: (value) => switchTab(value),
  });

  function switchTab(value, filter = 'all', { scroll = false } = {}) {
    tab = value;
    if (value === 'applications') applicationFilter = filter;
    if (value === 'inventory') {
      inventoryHealthFilter = filter;
      if (filter === 'low') inventoryAvailability = 'all';
    }
    tabControl.setValue(value);
    if (snapshot) renderBody(() => dataRegion.reload());
    if (scroll) {
      const list = bodySlot.querySelector('.material-applications');
      requestAnimationFrame(() => {
        if (list?.isConnected) {
          list.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
        }
      });
    }
  }

  /* ---- Inspectors ------------------------------------------------------- */
  function assetSyncPending(item) {
    return Boolean(item.syncPending || snapshot.applications?.some((application) => application.syncPending && application.assetCode === item.code));
  }

  function showInventoryInspector(item, reload) {
    const qr = h('img', { class: 'qr qr--sm', alt: `${item.name} 资产二维码` });
    qr.src = consoleApi.materials.qrUrl(item.id);

    shell.openInspector({
      eyebrow: '库存资产',
      title: item.name,
      subtitle: `${item.code} · ${item.center}`,
      body: [
        h(
          'div',
          { class: 'stack-3' },
          h(
            'div',
            { class: 'row-3 row-wrap' },
            inventoryHealth(item),
            badge(`${item.cabinet} 柜 ${item.level} 层`, { tone: 'neutral', iconName: 'pin' }),
          ),
          h('div', { class: 'row-base row-2' }, h('b', { class: 't-h1 t-num', text: String(item.quantity) }), h('span', { class: 't-caption', text: `${item.unit} · 在库${item.availability === 'disabled' ? '（已停用）' : ''}` })),
          item.initial
            ? barTrack([
                { label: '当前在库', value: item.quantity, color: item.availability === 'disabled' || item.lowStock ? 'var(--warning)' : 'var(--success)' },
                { label: '差额', value: Math.max(0, item.initial - item.quantity), color: 'var(--error)' },
              ])
            : null,
        ),
        h('hr', { class: 'divider' }),
        definitionList([
          ['资产编码', copyableCode(item.code)],
          ['初始数量', `${item.initial} ${item.unit}`],
          ['当前数量', `${item.quantity} ${item.unit}`],
          ['库存差额', `${fmt.signed(item.difference)} ${item.unit}`],
          ['预警阈值', thresholdText(item)],
          ['新系统流水', `入 ${item.inbound} / 出 ${item.outbound} / 还 ${item.returned} / 损 ${item.loss}`],
          ['未关联差额', item.untrackedDifference ? `${item.untrackedDifference} ${item.unit}` : '无'],
          ...(item.availability ? [['管理状态', item.availability === 'disabled' ? '停用' : '启用'], ['状态原因', item.availabilityReason || '未填写']] : []),
        ]),
        item.availability === 'disabled'
          ? notice('已停用，库存仍保留在台账中。禁止入库与新增出库；原借出物资可以归还，盘点和报损可以继续核查。', { tone: 'warning' })
          : null,
        inventoryLifecycleEnabled(snapshot, 'availability') && item.availability !== 'disabled' && assetSyncPending(item)
          ? notice('此物资有关联申请状态待同步，请先到出入库流水恢复同步，再停用。', { tone: 'warning', title: '暂时不能停用' })
          : null,
        item.availabilityHistory?.length ? h('div', { class: 'stack-3' },
          h('p', { class: 't-label', text: '物资状态历史（本地演示）' }),
          ...item.availabilityHistory.slice().reverse().map((entry) => h('div', { class: 'stack-1' },
            h('b', { class: 't-secondary', text: `${({ create: '新增', disable: '停用', restore: '恢复' })[entry.action] || '状态变更'} · ${entry.operator || '未记录操作人'}` }),
            h('p', { class: 't-caption', text: `${fmt.dateTime(entry.date)} · ${entry.reason || '未填写原因'}` }),
          )),
        ) : null,
        item.untrackedDifference
          ? notice('请核对历史库存差额，再进行盘点调整。', { tone: 'warning', title: '存在未关联的差额' })
          : null,
        item.destinations?.length
          ? h(
              'div',
              { class: 'stack-3' },
              h('p', { class: 't-label', text: '已关联的流转去向' }),
              h('div', { class: 'stack-2' }, ...item.destinations.slice(0, 6).map((destination) => h('div', { class: 'row-3' }, icon('arrowRight', 'ico ico--sm'), h('span', { class: 't-caption spacer truncate', text: destination.label }), h('span', { class: 't-data', text: `${destination.quantity}` })))),
            )
          : null,
        h('hr', { class: 'divider' }),
        h(
          'div',
          { class: 'stack-3' },
          h('p', { class: 't-label', text: '资产二维码' }),
          h('div', { class: 'row-4 row-top' }, qr, h('p', { class: 't-caption', text: '二维码只编码不透明资产码，不含姓名、用途或数量。扫码查询同样需要有效会话。' })),
        ),
      ].filter(Boolean),
      footer: [
        h(
          'div',
          { class: 'row-2' },
          button({ label: '入库', variant: 'primary', size: 'sm', iconName: 'plus', disabled: !inventoryOperationAllowed(item, '入库'), onClick: () => openTransactionDrawer(item, { defaultOperation: '入库', onDone: reload }) }),
          button({ label: '出库', variant: 'secondary', size: 'sm', iconName: 'upload', disabled: !inventoryOperationAllowed(item, '出库'), onClick: () => openTransactionDrawer(item, { defaultOperation: '出库', onDone: reload }) }),
          button({ label: '盘点', variant: 'secondary', size: 'sm', iconName: 'scan', onClick: () => openTransactionDrawer(item, { defaultOperation: '盘点增加', onDone: reload }) }),
        ),
        button({ label: '编辑物资资料', variant: 'secondary', size: 'sm', block: true, onClick: () => openInventoryEditDrawer(item, { onDone: () => { shell.closeInspector(); reload(); } }) }),
        inventoryLifecycleEnabled(snapshot, 'availability') ? button({
          label: `${item.availability === 'disabled' ? '恢复' : '停用'}物资（本地演示）`,
          variant: item.availability === 'disabled' ? 'secondary' : 'danger', size: 'sm', block: true,
          disabled: item.availability !== 'disabled' && assetSyncPending(item), onClick: () => openAvailabilityDrawer(item, {
            capabilities: snapshot.capabilities, onDone: () => { shell.closeInspector(); reload(); },
          }),
        }) : null,
        button({ label: '报损登记', variant: 'danger', size: 'sm', block: true, iconName: 'alert', onClick: () => openTransactionDrawer(item, { defaultOperation: '报损', onDone: reload }) }),
      ].filter(Boolean),
    });
  }

  function showApplicationInspector(application, reload) {
    const { canApprove, canCheckout, canReturn } = applicationActions(application);

    shell.openInspector({
      eyebrow: '借用申请',
      title: application.purpose,
      subtitle: `${application.code} · ${application.applicant}`,
      body: [
        h(
          'div',
          { class: 'row-3 row-wrap' },
          applicationStatus(application.status),
          badge(application.approvalMode === 'automatic' ? '自动通过' : application.approval, { tone: application.approval === '审批通过' ? 'success' : ['审批不通过', '待审核'].includes(application.approval) ? 'error' : 'warning' }),
          application.overdueDays ? badge(`逾期 ${application.overdueDays} 天`, { tone: 'error', iconName: 'alert' }) : null,
          String(application.returnStatus).includes('物品缺失') ? badge('归还异常', { tone: 'error' }) : null,
          application.syncPending ? badge('状态待同步', { tone: 'warning' }) : null,
        ),
        h('hr', { class: 'divider' }),
        definitionList([
          ['申请单号', copyableCode(application.code)],
          ['申请人', application.applicant],
          ['借用物资', application.items],
          ['审批方式', application.approvalMode === 'automatic' ? '马甲免人工审批' : '人工审批'],
          ['借用件数', `${application.quantity} 件`],
          ['拟借用', fmt.date(application.plannedBorrowDate)],
          ['拟归还', fmt.date(application.plannedReturnDate)],
          ['实际借出', fmt.date(application.actualBorrowDate)],
          ['实际归还', fmt.date(application.actualReturnDate)],
          ['归还状态', fmt.text(application.returnStatus, '未登记')],
          ['原出库资产', application.assetCode || '未关联'],
          ['累计归还 / 损耗', `${application.returnedQuantity ?? 0} / ${application.lossQuantity ?? 0} 件`],
          ['剩余待核销', `${returnProgress(application).outstanding} 件`],
        ]),
        application.syncPending
          ? notice('流水已经记录，申请状态尚未同步。请到出入库流水重试同步，再继续操作，避免重复扣增库存。', { tone: 'warning', title: '需要恢复同步' })
          : application.returnProgress === 'unverified' || (!application.assetCode && (application.actualBorrowDate || String(application.status).includes('借出')))
            ? notice('这张历史申请的出库资产或归还数量无法完整核实，无法安全登记归还，请先核查流水。', { tone: 'warning', title: '历史借还资料待核实' })
          : canApprove
          ? notice('审批通过后才能出库。通过不需要填写理由；不通过必须说明原因，理由会写回 SeaTable。', { tone: 'info', title: '下一步：审批' })
          : canCheckout
            ? notice('出库需要绑定库存资产编码并上传现场照片，系统会同时写入流水与申请状态。', { tone: 'info', title: '下一步：登记出库' })
            : canReturn
              ? notice('归还按「实际归还数量 + 损耗数量」判断是否结清；存在损耗时会保留异常状态进入关注队列。', { tone: 'info', title: '下一步：登记归还' })
              : notice('这张申请单当前没有待执行的动作。', { tone: 'neutral' }),
      ].filter(Boolean),
      footer: [
        canApprove
          ? h(
              'div',
              { class: 'row-2' },
              button({
                label: '审批通过',
                variant: 'primary',
                size: 'sm',
                iconName: 'check',
                onClick: async () => {
                  const confirmed = await confirmAction({
                    title: '确认审批通过？',
                    description: `${application.applicant} 申请借用「${application.items}」，用途：${application.purpose}。通过后即可登记出库。`,
                    confirmLabel: '审批通过',
                  });
                  if (!confirmed) return;
                  try {
                    await consoleApi.materials.approve(application.id);
                    notify.success('已审批通过', application.purpose);
                    shell.closeInspector();
                    reload();
                    shell.refreshTodos();
                  } catch (error) {
                    reportError(error, '审批未完成');
                  }
                },
              }),
              button({ label: '不通过', variant: 'danger', size: 'sm', iconName: 'close', onClick: () => openRejectDrawer(application, { onDone: () => { shell.closeInspector(); reload(); shell.refreshTodos(); } }) }),
            )
          : null,
        canCheckout
          ? button({ label: '登记出库', variant: 'primary', size: 'sm', block: true, iconName: 'upload', onClick: () => { shell.closeInspector(); goToCheckout(application); } })
          : null,
        canReturn
          ? button({ label: '登记归还', variant: 'primary', size: 'sm', block: true, iconName: 'download', onClick: () => openFulfilmentDrawer(application, snapshot.inventory, { mode: 'return', onDone: () => { shell.closeInspector(); reload(); } }) })
          : null,
      ].filter(Boolean),
    });
  }

  function goToCheckout(application) {
    if (applicationActions(application).canCheckout) navigate(`/console/materials/intake?applicationId=${encodeURIComponent(application.id)}`);
  }

  /* ---- Tab bodies -------------------------------------------------------- */
  function renderSummary(payload) {
    actionCards.clear();
    const cards = [
      { key: 'pending', label: '待审批', count: payload.stats.pendingCount, tone: 'alert', hint: '处理借用审批' },
      { key: 'checkout', label: '待出库', count: payload.applications.filter(item => applicationActions(item).canCheckout).length, tone: '', hint: '备货并登记出库' },
      { key: 'borrowed', label: '借出中', count: payload.stats.borrowedCount, tone: '', hint: '查看归还进度' },
      { key: 'overdue', label: '逾期未还', count: payload.stats.overdueCount, tone: 'alert', hint: '跟进逾期归还' },
    ].map(item => {
      const card = metric({ label: item.label, value: item.count, unit: '单', tone: item.tone,
        animate: false, hint: statusIndicator(item.hint, { tone: item.tone === 'alert' ? 'error' : 'info' }),
        onClick: () => switchTab('applications', item.key, { scroll: true }) });
      card.classList.add('material-action-card'); actionCards.set(item.key, card);
      card.setAttribute('aria-label', `${item.label} ${item.count} 单，${item.hint}`);
      return card;
    });
    const lowStock = h('button', { type: 'button', class: 'material-low-stock', data: { filter: 'low' },
      on: { click: () => switchTab('inventory', 'low') } },
      h('span', { class: 'row-2' }, icon('alert', 'ico ico--sm'), h('span', { text: '低库存预警' })),
      h('span', { class: 'material-low-stock__value', text: `${fmt.int(payload.stats.lowStockCount)} 项` }),
      h('span', { class: 't-caption', text: '查看物资' }), icon('arrowRight', 'ico ico--sm'));
    actionCards.set('low', lowStock);
    const summary = h('section', { class: 'material-dashboard-summary', aria: { label: '物资管理概览' } },
      metricRow(cards, { columns: 4 }),
      h('div', { class: 'material-stock-summary' },
        h('dl', { class: 'material-stock-data' },
          h('div', {}, h('dt', { text: '库存品类' }), h('dd', {}, h('b', { text: fmt.int(payload.stats.categoryCount) }), ' 种')),
          h('div', {}, h('dt', { text: '台账库存' }), h('dd', {}, h('b', { text: fmt.int(payload.stats.totalCurrentQuantity) }), ' 件'))),
        h('p', { class: 't-caption material-stock-meta', text: `理论总量 ${fmt.int(payload.stats.totalInitialQuantity)} 件 · 差额 ${fmt.signed(payload.stats.totalDifference)} 件${payload.stats.disabledQuantity ? ` · 含停用 ${fmt.int(payload.stats.disabledQuantity)} 件` : ''}` }),
        lowStock));
    syncSummary();
    return summary;
  }

  function syncSummary() {
    actionCards.forEach((card, key) => {
      const active = key === 'low' ? tab === 'inventory' && inventoryHealthFilter === 'low'
        : tab === 'applications' && applicationFilter === key;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-pressed', String(active));
    });
  }

  function renderTasks(reload) {
    const groups = [
      { key: 'pending', label: '待审批借用', items: snapshot.pending, empty: '暂无待审批申请。' },
      { key: 'checkout', label: '待出库借用', items: snapshot.applications.filter(item => applicationActions(item).canCheckout), empty: '暂无等待出库的申请。' },
      { key: 'overdue', label: '逾期未还', items: snapshot.overdue, empty: '暂无逾期记录。' },
      { key: 'abnormal', label: '归还异常', items: snapshot.abnormalReturns, empty: '暂无归还异常。' },
    ];
    return h('div', { class: 'material-task-grid' }, ...groups.map(group => {
      const items = [...group.items].sort((a, b) => group.key === 'overdue' ? b.overdueDays - a.overdueDays
        : String(b.plannedReturnDate || '').localeCompare(String(a.plannedReturnDate || '')));
      return h('section', { class: 'material-task-group', data: { queue: group.key } },
        h('header', { class: 'material-task-group__head' },
          h('h2', { class: 't-h4', text: group.label }),
          badge(`${items.length} 单`, { tone: group.key === 'pending' || group.key === 'overdue' || group.key === 'abnormal' ? 'error' : 'neutral' }),
          h('span', { class: 'spacer' }),
          items.length ? button({ label: '查看全部', ariaLabel: `查看全部${group.label}`, variant: 'ghost', size: 'sm', iconAfter: 'arrowRight',
            onClick: () => switchTab('applications', group.key) }) : null),
        h('div', { class: 'material-task-list' }, ...items.slice(0, 3).map(item =>
          h('button', { type: 'button', class: 'material-task-row', on: { click: () => showApplicationInspector(item, reload) } },
            h('div', { class: 'material-task-row__body' },
              h('p', { class: 't-secondary t-strong t-clamp-2', text: item.purpose }),
              h('p', { class: 't-caption t-clamp-1', text: `${item.applicant} · ${item.items}` }),
              h('div', { class: 'row-2 row-wrap' },
                h('code', { class: 't-caption', text: fmt.shortCode(item.code) }),
                item.overdueDays ? badge(`逾期 ${item.overdueDays} 天`, { tone: 'error' }) : applicationStatus(item.status))),
            icon('chevronRight', 'ico ico--sm'))),
          !items.length ? h('p', { class: 't-caption material-task-empty', text: group.empty }) : null),
        items.length > 3 ? h('p', { class: 't-caption material-task-more', text: `显示前 3 单，另有 ${items.length - 3} 单，点击“查看全部”处理。` }) : null);
    }));
  }

  function renderInventory(reload) {
    const lifecycleDemo = inventoryLifecycleEnabled(snapshot, 'availability');
    if (!lifecycleDemo) inventoryAvailability = 'all';
    const rows = snapshot.inventory.filter(item => (inventoryHealthFilter !== 'low' || item.lowStock)
      && (inventoryAvailability === 'all' || (inventoryAvailability === 'disabled' ? item.availability === 'disabled' : item.availability !== 'disabled')));
    const healthFilter = field({ label: '库存状态', name: 'inventoryHealth', value: inventoryHealthFilter,
      options: [{ value: 'all', label: '全部物资' }, { value: 'low', label: '低库存预警' }] });
    healthFilter.control.addEventListener('change', () => { inventoryHealthFilter = healthFilter.control.value; renderBody(reload); });
    const table = dataTable({
      columns: [
        { key: 'name', label: '物资名称', strong: true, render: (row) => h('div', { class: 'stack-1' }, h('span', { class: 't-secondary t-strong', text: row.name }), h('span', { class: 't-caption', text: `${row.center} · ${row.cabinet} 柜 ${row.level} 层` })) },
        { key: 'code', label: '资产编码', mono: true, render: (row) => h('code', { class: 't-data t-faint', text: fmt.shortCode(row.code, 8) }) },
        { key: 'initial', label: '初始', align: 'right', render: (row) => h('span', { text: fmt.int(row.initial) }) },
        { key: 'quantity', label: '当前', align: 'right', render: (row) => h('span', { class: row.thresholdStatus === 'critical' ? 't-accent' : '', text: fmt.int(row.quantity) }) },
        { key: 'difference', label: '差额', align: 'right', render: (row) => h('span', { class: row.difference > 0 ? 't-muted' : '', text: fmt.signed(row.difference) }) },
        { key: 'threshold', label: '阈值', align: 'right', render: (row) => h('span', { text: row.thresholdEnabled === false || row.threshold === null ? '—' : fmt.int(row.threshold) }) },
        { key: 'health', label: '状态', sortable: false, render: (row) => h('div', { class: 'row-2 row-wrap' }, lifecycleDemo && row.availability !== 'disabled' ? badge('启用', { tone: 'success' }) : null, inventoryHealth(row)) },
      ],
      rows,
      getKey: (row) => row.code,
      searchPlaceholder: '搜索物资名称、编码或位置',
      searchKeys: ['name', 'code', 'center', 'cabinet', 'level'],
      countLabel: (n) => `${n} / ${rows.length} 项 · 全台账 ${snapshot.inventory.length} 项`,
      initialSort: { key: 'quantity', direction: 'asc' },
      onRowClick: (row) => showInventoryInspector(row, reload),
      buildRowMenu: (row) => [
        { label: '查看资产详情', iconName: 'eye', onSelect: () => showInventoryInspector(row, reload) },
        { label: '编辑物资资料', iconName: 'edit', onSelect: () => openInventoryEditDrawer(row, { onDone: reload }) },
        ...(lifecycleDemo ? [{ label: `${row.availability === 'disabled' ? '恢复' : '停用'}物资（本地演示）`, iconName: row.availability === 'disabled' ? 'check' : 'close', disabled: row.availability !== 'disabled' && assetSyncPending(row), onSelect: () => openAvailabilityDrawer(row, { capabilities: snapshot.capabilities, onDone: reload }) }] : []),
        { separator: true },
        { label: '登记入库', iconName: 'plus', disabled: !inventoryOperationAllowed(row, '入库'), onSelect: () => openTransactionDrawer(row, { defaultOperation: '入库', onDone: reload }) },
        { label: '登记出库', iconName: 'upload', disabled: !inventoryOperationAllowed(row, '出库'), onSelect: () => openTransactionDrawer(row, { defaultOperation: '出库', onDone: reload }) },
        { label: '盘点调整', iconName: 'scan', onSelect: () => openTransactionDrawer(row, { defaultOperation: '盘点增加', onDone: reload }) },
        { separator: true },
        { label: '复制资产编码', iconName: 'copy', onSelect: () => navigator.clipboard?.writeText(row.code) },
        { label: '报损登记', iconName: 'alert', variant: 'danger', onSelect: () => openTransactionDrawer(row, { defaultOperation: '报损', onDone: reload }) },
      ],
      filters: [healthFilter, ...(lifecycleDemo ? [segmented({
        items: [{ value: 'all', label: '全部' }, { value: 'active', label: '启用' }, { value: 'disabled', label: '停用' }],
        value: inventoryAvailability, ariaLabel: '物资管理状态筛选',
        onChange: value => { inventoryAvailability = value; renderBody(reload); },
      })] : [])],
      actions: [
        inventoryLifecycleEnabled(snapshot, 'create') ? button({ label: '新增物资（本地演示）', variant: 'primary', size: 'sm', iconName: 'plus', onClick: () => openInventoryCreateDrawer({ capabilities: snapshot.capabilities, onDone: reload }) }) : null,
        button({ label: '扫码定位', variant: 'secondary', size: 'sm', iconName: 'qr', onClick: () => openScanDrawer(reload) }),
      ].filter(Boolean),
    });
    return h('div', { class: 'material-inventory-list stack-3' },
      h('div', { class: 'material-list-head' }, h('h2', { class: 't-h4', text: inventoryHealthFilter === 'low' ? '低库存物资' : '库存台账' }),
        inventoryHealthFilter === 'low' ? h('p', { class: 't-caption', text: snapshot.policy.thresholdRule }) : null), table);
  }

  function renderApplications(reload) {
    const filters = [
      ['all', '全部申请'], ['pending', '待审批'], ['checkout', '待出库'], ['borrowed', '借出中'], ['overdue', '逾期未还'], ['abnormal', '归还异常'],
    ];
    const filter = field({ label: '借用状态', name: 'applicationFilter', value: applicationFilter,
      options: filters.map(([value, label]) => ({ value, label })) });
    filter.control.addEventListener('change', () => { applicationFilter = filter.control.value; renderBody(reload); });
    const selectedIds = new Set((applicationFilter === 'pending' ? snapshot.pending
      : applicationFilter === 'overdue' ? snapshot.overdue : applicationFilter === 'abnormal' ? snapshot.abnormalReturns : []).map(item => item.id));
    const rows = [...snapshot.applications].reverse().filter(item => applicationFilter === 'all'
      || (applicationFilter === 'borrowed' ? !item.returned && item.status.includes('借出')
        : applicationFilter === 'checkout' ? applicationActions(item).canCheckout : selectedIds.has(item.id)));
    const table = dataTable({
      columns: [
        { key: 'code', label: '申请单', mono: true, render: (row) => h('code', { class: 't-data', text: fmt.shortCode(row.code) }) },
        { key: 'purpose', label: '借用用途', strong: true, render: (row) => h('div', { class: 'stack-1' }, h('span', { class: 't-secondary t-strong t-clamp-1', text: row.purpose }), h('span', { class: 't-caption t-clamp-1', text: row.items })) },
        { key: 'applicant', label: '申请人' },
        { key: 'quantity', label: '件数', align: 'right' },
        { key: 'plannedReturnDate', label: '拟归还', render: (row) => h('span', { text: fmt.date(row.plannedReturnDate) }) },
        { key: 'status', label: '状态', sortable: false, render: (row) => h('div', { class: 'row-2' }, applicationStatus(row.status), row.overdueDays ? badge(`逾期 ${row.overdueDays}`, { tone: 'error' }) : null) },
        { key: 'approval', label: '审批', render: (row) => badge(row.approvalMode === 'automatic' ? '自动通过' : row.approval, { tone: row.approval === '审批通过' ? 'success' : ['审批不通过', '待审核'].includes(row.approval) ? 'error' : 'warning' }) },
        { key: 'checkoutAction', label: '出库登记', sortable: false, render: (row) => applicationActions(row).canCheckout
          ? h('div', { on: { click: event => event.stopPropagation(), keydown: event => event.stopPropagation() } },
            button({ label: '登记出库', variant: 'secondary', size: 'sm', onClick: () => goToCheckout(row) }))
          : h('span', { class: 't-caption', text: '—' }) },
      ],
      rows,
      filters: [filter],
      getKey: (row) => row.id,
      searchPlaceholder: '搜索用途、物资或申请人',
      searchKeys: ['purpose', 'items', 'applicant', 'code'],
      countLabel: (n) => `${n} / ${rows.length} 单 · 全部 ${snapshot.applications.length} 单`,
      initialSort: { key: 'plannedReturnDate', direction: 'desc' },
      onRowClick: (row) => showApplicationInspector(row, reload),
      buildRowMenu: (row) => [
        { label: '查看申请详情', iconName: 'eye', onSelect: () => showApplicationInspector(row, reload) },
        { separator: true },
        { label: '审批通过', iconName: 'check', disabled: !applicationActions(row).canApprove, onSelect: () => showApplicationInspector(row, reload) },
        { label: '登记出库', iconName: 'upload', disabled: !applicationActions(row).canCheckout, onSelect: () => goToCheckout(row) },
        { label: '登记归还', iconName: 'download', disabled: !applicationActions(row).canReturn, onSelect: () => openFulfilmentDrawer(row, snapshot.inventory, { mode: 'return', onDone: reload }) },
      ],
    });
    return h('div', { class: 'material-applications stack-3' },
      h('div', { class: 'material-list-head' }, h('h2', { class: 't-h4', text: filters.find(([value]) => value === applicationFilter)?.[1] || '全部申请' }),
        h('p', { class: 't-caption', text: '点击申请查看详情，办理审批、出库与归还。' })), table);
  }

  function showFlowDrawer(flow, reload) {
    const initialNote = flow.resolution?.note || '';
    const noteField = field({ label: flow.resolution ? '更新核查说明' : '核查说明', name: 'reviewNote', value: initialNote, multiline: true, rows: 3, maxlength: 1000, hint: '保存会更新本条流水的核查说明；不会结清借用单或清除损耗标记。', placeholder: '记录核查结果、后续处置及负责人。' });
    const statusSlot = h('div', { aria: { live: 'polite' } });
    const syncNotice = flow.syncPending ? notice('这条流水已影响库存，但申请状态待同步。恢复同步会沿用现有流水，不能重复登记相同操作。', { tone: 'warning', title: '状态待同步' }) : null;
    const reviewButton = button({ label: '保存核查说明', variant: 'primary', iconName: 'check', onClick: async () => {
      noteField.setError(null);
      const note = noteField.control.value.trim();
      if (!note) { noteField.setError('请填写核查说明'); noteField.control.focus(); return; }
      if (note === initialNote) { notify.info('没有需要保存的改动', '修改核查说明后再保存。'); return; }
      clear(statusSlot);
      retryButton.disabled = true;
      noteField.control.disabled = true;
      try {
        await submitWithLoading(reviewButton, () => consoleApi.materials.reviewFlow(flow.id, note));
        notify.success('核查说明已保存', '原流水与数量未改动。');
        drawer.close();
        reload();
      } catch (error) {
        statusSlot.append(notice(error.message || '填写内容已保留，请重试保存。', { tone: 'error', title: '核查说明未保存' }));
      } finally {
        retryButton.disabled = false;
        noteField.control.disabled = false;
      }
    } });
    const retryButton = button({ label: '重试申请状态同步', variant: 'secondary', iconName: 'refresh', onClick: async () => {
      clear(statusSlot);
      reviewButton.disabled = true;
      try {
        const payload = await submitWithLoading(retryButton, () => consoleApi.materials.retrySync(flow.id));
        if (payload.syncPending || payload.flow?.syncPending) {
          clear(statusSlot);
          statusSlot.append(notice(payload.message || '申请状态仍待同步，请稍后再试。', { tone: 'warning' }));
          return;
        }
        notify.success('申请状态已同步', '恢复同步未重复写入库存流水。');
        syncNotice?.remove();
        retryButton.hidden = true;
        statusSlot.append(notice('申请状态已同步，库存没有重复变更。填写中的核查说明已保留，可继续保存。', { tone: 'success' }));
        reload();
      } catch (error) {
        clear(statusSlot);
        statusSlot.append(notice(error.message || '同步未完成，请重试。', { tone: 'error', title: '恢复同步失败' }));
      } finally {
        reviewButton.disabled = false;
      }
    } });
    const resolutionText = flow.resolution && typeof flow.resolution === 'object'
      ? `${flow.resolution.note || '未填写'}（${flow.resolution.operator || '未记录操作人'} · ${fmt.dateTime(flow.resolution.date)}）`
      : flow.resolution;
    const drawer = openDrawer({
      eyebrow: '物资流水核查', title: `${flow.operation} · ${flow.material}`, description: flow.id, width: 560,
      body: [
        definitionList([
          ['资产编码', copyableCode(flow.assetCode)], ['关联申请', flow.applicationId || '无'],
          ['数量 / 损耗', `${flow.quantity} / ${flow.loss || 0}`], ['库存变化', `${flow.before} → ${flow.after}`],
          ['操作人', flow.operator], ['时间', fmt.dateTime(flow.date)], ['流转去向', flow.destination || '未填写'],
          ['原操作备注', flow.note || '未填写'], ['已有核查记录', resolutionText || '未填写'],
        ]),
        syncNotice,
        flow.syncPending ? retryButton : null,
        statusSlot,
        noteField,
      ].filter(Boolean),
      footer: [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }), reviewButton],
    });
  }

  function renderFlows(reload) {
    const fields = [
      field({ label: '关键词', name: 'q', value: flowState.q, placeholder: '物资、编码、去向或备注' }),
      field({ label: '资产编码', name: 'assetCode', value: flowState.assetCode, options: [{ value: '', label: '全部物资' }, ...snapshot.inventory.map((item) => ({ value: item.code, label: `${item.name} · ${item.code}` }))] }),
      field({ label: '操作类型', name: 'operation', value: flowState.operation, options: [{ value: '', label: '全部操作' }, ...[...OPERATIONS.map((op) => op.value), '归还'].map((value) => ({ value, label: value }))] }),
      field({ label: '操作人', name: 'operator', value: flowState.operator, placeholder: '按操作人搜索' }),
      field({ label: '起始日期', name: 'from', value: flowState.from, type: 'date' }),
      field({ label: '结束日期', name: 'to', value: flowState.to, type: 'date' }),
      field({ label: '核查范围', name: 'errorOnly', value: flowState.errorOnly, options: [{ value: '', label: '全部流水' }, { value: 'true', label: '仅损耗 / 报损 / 待同步' }] }),
      field({ label: '每页条数', name: 'pageSize', value: String(flowState.pageSize), options: ['25', '50', '100'] }),
    ];
    const rowsSlot = h('div', { class: 'stack-4', aria: { live: 'polite' } });
    let currentRows = [];
    let loadedPage = flowState.page;
    const exportButton = button({ label: '导出当前页 CSV', variant: 'secondary', size: 'sm', iconName: 'download', onClick: () => {
      const blob = new Blob([flowsCsv(currentRows)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = h('a', { href: url, download: `物资流水-当前页${loadedPage}.csv` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } });
    exportButton.disabled = true;
    const searchButton = button({ label: '查询流水', variant: 'primary', size: 'sm', iconName: 'search', onClick: () => query() });

    function query({ reset = false } = {}) {
      if (reset) {
        Object.assign(flowState, { page: 1, pageSize: 25, q: '', assetCode: '', operation: '', operator: '', from: '', to: '', errorOnly: '' });
        fields.forEach((entry) => { entry.control.value = String(flowState[entry.control.name]); entry.setError(null); });
      } else {
        const filters = Object.fromEntries(fields.map((entry) => { entry.setError(null); return [entry.control.name, entry.control.value.trim()]; }));
        if (filters.from && filters.to && filters.from > filters.to) {
          const field = fields.find((entry) => entry.control.name === 'to');
          field.setError('结束日期不能早于起始日期'); field.control.focus(); return;
        }
        Object.assign(flowState, filters, { page: 1 });
      }
      loadPage();
    }
    fields.forEach((entry) => entry.control.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); query(); } }));

    async function loadPage(focusPager = false) {
      const version = ++flowVersion;
      const filters = { ...flowState };
      rowsSlot.setAttribute('aria-busy', 'true');
      exportButton.disabled = true;
      searchButton.disabled = true;
      clear(rowsSlot);
      rowsSlot.append(skeletonRows(6));
      try {
        const payload = await consoleApi.materials.flows(filters);
        if (version !== flowVersion) return;
        if (payload.page > Math.max(1, payload.totalPages)) {
          flowState.page = Math.max(1, payload.totalPages);
          loadPage(focusPager);
          return;
        }
        currentRows = payload.flows || [];
        loadedPage = payload.page;
        flowState.page = payload.page;
        clear(rowsSlot);
        rowsSlot.append(dataTable({
          columns: [
            { key: 'operation', label: '操作', render: (row) => badge(row.operation, { tone: ['入库', '归还', '盘点增加'].includes(row.operation) ? 'success' : row.operation === '报损' ? 'error' : 'accent' }) },
            { key: 'material', label: '物资', strong: true },
            { key: 'assetCode', label: '资产编码', mono: true, render: (row) => h('code', { class: 't-data t-faint', text: fmt.shortCode(row.assetCode, 8) }) },
            { key: 'quantity', label: '数量', align: 'right' },
            { key: 'loss', label: '损耗', align: 'right', render: (row) => h('span', { text: row.loss || 0 }) },
            { key: 'change', label: '库存变化', sortable: false, render: (row) => h('span', { class: 't-data', text: `${row.before} → ${row.after}` }) },
            { key: 'operator', label: '操作人' },
            { key: 'date', label: '时间', render: (row) => h('span', { class: 't-caption', text: fmt.dateTime(row.date) }) },
            { key: 'syncPending', label: '核查', sortable: false, render: (row) => row.syncPending ? badge('状态待同步', { tone: 'warning' }) : row.resolution ? badge('已有核查说明', { tone: 'neutral' }) : row.loss > 0 || row.operation === '报损' ? badge(row.operation === '报损' ? '报损待核查' : '损耗待核查', { tone: 'error' }) : badge('已记录', { tone: 'success' }) },
          ],
          rows: currentRows, getKey: (row) => row.id, searchable: false,
          countLabel: (n) => `本页 ${n} 条 · 筛选结果共 ${payload.total} 条`,
          empty: emptyState({ iconName: 'search', title: '没有符合条件的流水', description: '可以清空条件或扩大日期范围。' }),
          onRowClick: (row) => showFlowDrawer(row, reload),
          buildRowMenu: (row) => [{ label: '查看 / 核查流水', iconName: 'eye', onSelect: () => showFlowDrawer(row, reload) }],
        }));
        const previousButton = button({ label: '上一页', variant: 'secondary', size: 'sm', disabled: payload.page <= 1, onClick: () => { flowState.page = payload.page - 1; loadPage(true); } });
        const nextButton = button({ label: '下一页', variant: 'secondary', size: 'sm', disabled: payload.page >= payload.totalPages, onClick: () => { flowState.page = payload.page + 1; loadPage(true); } });
        rowsSlot.append(h('div', { class: 'row-3 row-wrap' }, h('span', { class: 't-caption', text: `第 ${payload.page} / ${Math.max(1, payload.totalPages)} 页 · 按时间从新到旧` }), h('span', { class: 'spacer' }), previousButton, nextButton));
        if (Object.values(payload.reads || {}).some((read) => read?.truncated)) rowsSlot.append(notice('数据读取达到上限，当前筛选结果不完整，导出仅包含本页已读取的数据。', { tone: 'warning', title: '流水读取不完整' }));
        exportButton.disabled = !currentRows.length;
        if (focusPager) (nextButton.disabled ? previousButton : nextButton).focus();
      } catch (error) {
        if (version !== flowVersion) return;
        currentRows = [];
        clear(rowsSlot);
        rowsSlot.append(notice(error.message || '无法读取物资流水。', { tone: 'error', title: '流水查询失败' }), button({ label: '重试查询', variant: 'secondary', onClick: () => loadPage() }));
      } finally {
        if (version === flowVersion) { rowsSlot.removeAttribute('aria-busy'); searchButton.disabled = false; }
      }
    }
    const node = h('div', { class: 'stack-5' },
      h('div', { class: 'materials-flow-filters' }, fields),
      h('div', { class: 'row-3 row-wrap' }, searchButton, button({ label: '清空条件', variant: 'ghost', size: 'sm', onClick: () => query({ reset: true }) }), h('span', { class: 'spacer' }), exportButton),
      h('p', { class: 't-caption', text: '导出包含当前页的已查询记录，不会导出其他页。点击流水可填写或更新核查说明，也可恢复待同步申请。' }),
      rowsSlot,
    );
    loadPage();
    return node;
  }

  function openScanDrawer(reload) {
    const codeField = field({ label: '资产编码', name: 'code', placeholder: 'NJU-RC-XXXXXXXX', hint: '可用扫码枪直接输入，或手工录入二维码内容。', iconName: 'qr' });
    const resultSlot = h('div');
    const lookupButton = button({ label: '定位物资', variant: 'primary', iconName: 'search', onClick: () => lookup() });

    const drawer = openDrawer({
      eyebrow: '扫码定位',
      title: '按资产编码定位库存',
      description: '扫码查询需要有效会话；未注册或格式不正确的编码会被拒绝。',
      width: 460,
      body: [codeField, resultSlot],
      footer: [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }), lookupButton],
    });

    codeField.control.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') lookup();
    });

    async function lookup() {
      const code = codeField.control.value.trim();
      codeField.setError(null);
      if (!/^NJU-RC-[A-Za-z0-9_-]+$/.test(code)) {
        codeField.setError('编码格式应为 NJU-RC- 开头');
        shake(codeField);
        return;
      }
      clear(resultSlot);
      resultSlot.append(h('div', { class: 'sk sk--block' }));
      try {
        const payload = await runWithLoading(lookupButton, () => consoleApi.materials.scan(code));
        clear(resultSlot);
        const item = payload.item;
        resultSlot.append(
          receipt({
            title: `已定位：${item.name}`,
            rows: [
              ['资产编码', item.code],
              ['位置', `${item.center} · ${item.cabinet} 柜 ${item.level} 层`],
              ['当前数量', `${item.quantity} ${item.unit}`],
              ['预警阈值', thresholdText(item)],
              ...(item.availability ? [['管理状态', item.availability === 'disabled' ? '停用（允许原借出归还）' : '启用'], ['状态原因', item.availabilityReason || '未填写']] : []),
            ],
          }),
          h(
            'div',
            { class: 'row-2' },
            button({ label: '入库', variant: 'primary', size: 'sm', iconName: 'plus', disabled: !inventoryOperationAllowed(item, '入库'), onClick: () => { drawer.close(); openTransactionDrawer(item, { defaultOperation: '入库', onDone: reload }); } }),
            button({ label: '出库', variant: 'secondary', size: 'sm', iconName: 'upload', disabled: !inventoryOperationAllowed(item, '出库'), onClick: () => { drawer.close(); openTransactionDrawer(item, { defaultOperation: '出库', onDone: reload }); } }),
            button({ label: '查看详情', variant: 'ghost', size: 'sm', onClick: () => { drawer.close(); showInventoryInspector(item, reload); } }),
          ),
        );
      } catch (error) {
        clear(resultSlot);
        resultSlot.append(notice(error.message || '未能定位该编码。', { tone: 'error', title: '查询失败' }));
      }
    }
  }

  function renderBody(reload) {
    syncSummary();
    flowVersion++;
    const content =
      tab === 'inventory' ? renderInventory(reload) : tab === 'applications' ? renderApplications(reload) : tab === 'flows' ? renderFlows(reload) : renderTasks(reload);
    const panel = h(
      'div',
      { class: 'stack-5' },
      h('div', { class: 'row-3 row-wrap' }, tabControl, h('span', { class: 'spacer' }), h('span', { class: 't-caption t-faint', text: `数据来源：${snapshot.policy.source}` })),
      tab === 'tasks' ? content : h('div', { class: 'panel panel--raised' }, content),
    );
    clear(bodySlot);
    bodySlot.append(panel);
    requestAnimationFrame(() => tabControl.reposition?.());
  }

  const node = h(
    'div',
    { class: 'view wspad wspad--wide material-management-page' },
    materialServices('loan', { console: true }),
    pageHead({
      label: '物资中心',
      title: '物资管理',
      description: '查看库存与借还台账，处理借用审批和待办事项。',
      actions: [
        button({ label: '扫码定位', variant: 'secondary', iconName: 'qr', onClick: () => openScanDrawer(() => dataRegion.reload()) }),
        reloadAction(dataRegion, '刷新数据'),
      ],
    }),
    dataRegion,
  );

  const stopRefresh = watchMaterialChanges(() => dataRegion.reload());
  return { title: '物资中心', crumb: '物资中心', node, dispose: stopRefresh };
}
