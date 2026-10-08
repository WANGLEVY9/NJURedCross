/* Asset lifecycle is enabled only by the local synthetic preview capability. */
import { h, clear } from '../core/dom.js';
import { consoleApi } from '../core/api.js';
import { openDrawer, confirmAction } from '../ui/overlay.js';
import { button, field, notice, receipt, skeletonRows, runWithLoading } from '../ui/primitives.js';
import { integerInput, inventoryLifecycleEnabled } from './materials-model.js';

const LABELS = {
  name: '物资名称', unit: '计量单位', center: '存放中心', cabinet: '柜号', level: '层数',
  initialQuantity: '初始库存数量', threshold: '预警阈值', thresholdEnabled: '启用库存预警',
};

const localNotice = () => notice('此功能仅修改本地内存数据，远端库不会变更。重启预览后本地改动重置。', { tone: 'info', title: '本地演示' });
const newKey = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.toUpperCase();

function optionsFor(meta) {
  return (meta?.options || []).map((option) => typeof option === 'string'
    ? { value: option, label: option }
    : { value: option.value ?? option.name ?? option.label, label: option.label ?? option.name ?? option.value });
}

async function withPending(buttonNode, controls, task) {
  const previous = controls.map((control) => control.disabled);
  const buttonDisabled = buttonNode.disabled;
  buttonNode.disabled = true;
  buttonNode.setAttribute('aria-busy', 'true');
  controls.forEach((control) => { control.disabled = true; });
  try {
    return await runWithLoading(buttonNode, task);
  } finally {
    buttonNode.disabled = buttonDisabled;
    buttonNode.removeAttribute('aria-busy');
    controls.forEach((control, index) => { control.disabled = previous[index]; });
  }
}

export async function openInventoryCreateDrawer({ capabilities, onDone }) {
  if (!inventoryLifecycleEnabled({ capabilities }, 'create')) return;
  const fieldsSlot = h('div', { class: 'stack-4' }, skeletonRows(5));
  const previewSlot = h('div', { aria: { live: 'polite' } });
  const statusSlot = h('div', { aria: { live: 'polite' } });
  const fields = new Map();
  const idempotencyKey = newKey('NEW');
  let creation;
  const activeSubmit = button({ label: '预览并新增物资（本地演示）', variant: 'primary', iconName: 'plus', onClick: submit });
  activeSubmit.disabled = true;
  const drawer = openDrawer({
    eyebrow: '本地演示 · 新增物资', title: '新增物资资料', width: 540,
    body: [localNotice(), notice('资产编码由系统生成。创建后以首条入库记录登记初始库存并保留来源；初始数量为 0 时不生成空流水。', { tone: 'neutral' }), fieldsSlot, previewSlot, statusSlot],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), activeSubmit],
  });

  function preview() {
    const quantity = integerInput(fields.get('initialQuantity')?.field.control.value, { allowZero: true });
    const unit = fields.get('unit')?.field.control.value.trim() || '件';
    clear(previewSlot);
    previewSlot.append(notice(quantity === null
      ? '请填写非负整数初始数量后查看预览。'
      : `创建后在库数量为 ${quantity} ${unit}。${quantity ? '初始库存将登记为一条入库流水。' : '只创建资料，不生成空入库流水。'}`, { tone: quantity === null ? 'warning' : 'info', title: '新增预览' }));
  }

  async function load() {
    activeSubmit.disabled = true;
    fields.clear();
    clear(fieldsSlot);
    clear(previewSlot);
    fieldsSlot.append(skeletonRows(5));
    try {
      const schema = await consoleApi.materials.schema();
      clear(fieldsSlot);
      if (!inventoryLifecycleEnabled(schema, 'create') || !schema.creation?.fields) {
        fieldsSlot.append(notice('当前环境没有开启本地新增演示。', { tone: 'warning' }));
        return;
      }
      creation = schema.creation;
      for (const [name, label] of Object.entries(LABELS)) {
        const meta = creation.fields[name];
        let options = optionsFor(meta);
        if (name === 'thresholdEnabled') options = [{ value: 'false', label: '关闭' }, { value: 'true', label: '启用' }];
        else if (options.length) options.unshift({ value: '', label: `请选择${label}` });
        const value = name === 'thresholdEnabled' ? 'false' : ['initialQuantity', 'threshold'].includes(name) ? '0' : '';
        const entry = field({ label, name, value, options: options.length ? options : null,
          type: meta?.type === 'number' || ['initialQuantity', 'threshold'].includes(name) ? 'number' : 'text',
          min: 0, step: 1, maxlength: 120, required: creation.required?.includes(name), disabled: meta?.editable !== true,
          hint: meta?.editable !== true ? '当前字段配置不支持新增，请核查演示字段配置。' : name === 'threshold' ? '非负整数；关闭预警时仍保存此设置。' : '',
        });
        fields.set(name, { field: entry, meta });
        fieldsSlot.append(entry);
        entry.control.addEventListener('input', preview);
        entry.control.addEventListener('change', preview);
      }
      const unsupported = [...fields.values()].some((entry) => entry.meta?.editable !== true);
      if (unsupported) fieldsSlot.append(notice('字段配置尚不完整，暂时不能新增物资。', { tone: 'warning' }));
      activeSubmit.disabled = unsupported;
      preview();
      [...fields.values()].find((entry) => !entry.field.control.disabled)?.field.control.focus();
    } catch (error) {
      clear(fieldsSlot);
      fieldsSlot.append(notice(error.message || '请重试加载字段配置。', { tone: 'error', title: '新增表单无法加载' }), button({ label: '重试加载', variant: 'secondary', onClick: load }));
    }
  }

  async function submit() {
    const body = { idempotencyKey };
    let firstError;
    for (const [name, entry] of fields) {
      entry.field.setError(null);
      const raw = entry.field.control.value.trim();
      let value = name === 'thresholdEnabled' ? raw === 'true' : raw;
      let error;
      if (entry.meta?.editable !== true) error = '此字段暂时无法新增';
      else if (creation.required?.includes(name) && !raw) error = '请填写此项资料';
      if (entry.meta?.type === 'number' || ['initialQuantity', 'threshold'].includes(name)) {
        value = integerInput(raw, { allowZero: true });
        if (value === null) error = '请填写非负整数';
      } else if (name !== 'thresholdEnabled' && raw.length > 120) error = '此项资料不能超过 120 个字符';
      const options = optionsFor(entry.meta);
      if (name !== 'thresholdEnabled' && options.length && !options.some((option) => String(option.value) === raw)) error = '请选择已有选项';
      if (error) { entry.field.setError(error); firstError ||= entry.field.control; }
      body[name] = value;
    }
    if (firstError) { firstError.focus(); return; }
    clear(statusSlot);
    const controls = [...fields.values()].map((entry) => entry.field.control);
    try {
      await withPending(activeSubmit, controls, async () => {
        const confirmed = await confirmAction({ title: '确认新增本地演示物资？',
          description: `${body.name} · 初始数量 ${body.initialQuantity} ${body.unit}；位置：${body.center} · ${body.cabinet} 柜 ${body.level} 层。资产编码自动生成。`, confirmLabel: '确认新增（本地演示）' });
        if (!confirmed) return;
        const payload = await consoleApi.materials.createInventoryDemo(body);
        const item = payload.item;
        drawer.setBody(receipt({ title: payload.duplicate ? '本次新增已有记录，当前资料如下' : '本地演示物资已创建', rows: [
          ['物资', item?.name || body.name], ['资产编码', item?.code || '请刷新台账核对'],
          ['初始 / 当前数量', `${item?.initial ?? body.initialQuantity} / ${item?.quantity ?? body.initialQuantity} ${item?.unit || body.unit}`], ['管理状态', item?.availability === 'disabled' ? '停用' : '启用'],
        ] }), localNotice());
        drawer.setFooter(h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() }));
        onDone?.();
      });
    } catch (error) {
      statusSlot.append(notice(error.message || '填写内容已保留，请核对后重试。', { tone: 'error', title: '物资新增未完成' }));
      if (error.code?.includes('idempotency')) statusSlot.append(notice('这次新增已有提交记录，不能改用另一份资料重试。请先核对台账；若确实需要新增另一项物资，关闭此面板后重新新增。', { tone: 'warning' }));
    }
  }
  await load();
}

export function openAvailabilityDrawer(item, { capabilities, onDone }) {
  if (!inventoryLifecycleEnabled({ capabilities }, 'availability')) return;
  const availability = item.availability === 'disabled' ? 'active' : 'disabled';
  const action = availability === 'disabled' ? '停用' : '恢复';
  const reasonField = field({ label: `${action}原因`, name: 'availabilityReason', required: true, multiline: true, rows: 3, maxlength: 1000, placeholder: availability === 'disabled' ? '例如：设备故障，等待检修；暂停新增借出。' : '例如：检修完成，已确认可继续使用。' });
  const statusSlot = h('div', { aria: { live: 'polite' } });
  const idempotencyKey = newKey(availability === 'disabled' ? 'DISABLE' : 'RESTORE');
  const submitButton = button({ label: `确认${action}（本地演示）`, variant: availability === 'disabled' ? 'danger' : 'primary', iconName: availability === 'disabled' ? 'close' : 'check', onClick: submit });
  const drawer = openDrawer({ eyebrow: `本地演示 · ${action}物资`, title: item.name, description: item.code, width: 500,
    body: [localNotice(), notice(availability === 'disabled'
      ? '停用保留库存数量和全部历史；停止入库与新增出库，已借出的物资仍可归还，盘点和报损仍可核查。待同步记录须先恢复。'
      : '恢复后重新允许入库和新增出库；库存数量及原有停用历史保留。', { tone: availability === 'disabled' ? 'warning' : 'info' }),
    reasonField, statusSlot],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    reasonField.setError(null);
    const reason = reasonField.control.value.trim();
    if (!reason || reason.length > 1000) { reasonField.setError('请填写 1 至 1000 字的原因'); reasonField.control.focus(); return; }
    clear(statusSlot);
    try {
      await withPending(submitButton, [reasonField.control], async () => {
        const confirmed = await confirmAction({ title: `确认${action}本地演示物资？`,
          description: `${item.name}（${item.code}）将${action}；在库数量仍为 ${item.quantity} ${item.unit}。原因：${reason}`,
          confirmLabel: `确认${action}`, tone: availability === 'disabled' ? 'danger' : 'neutral' });
        if (!confirmed) return;
        const payload = await consoleApi.materials.updateAvailabilityDemo(item.id, { availability, reason, idempotencyKey });
        drawer.setBody(receipt({ title: payload.duplicate ? '本次状态操作已有记录，当前资料如下' : `本地演示物资已${action}`, rows: [
          ['物资', `${payload.item?.name || item.name}（${item.code}）`], ['管理状态', (payload.item?.availability || availability) === 'disabled' ? '停用' : '启用'],
          ['当前状态原因', payload.item ? payload.item.availabilityReason || '未填写' : reason], ['在库数量', `${payload.item?.quantity ?? item.quantity} ${payload.item?.unit || item.unit}`],
        ] }), localNotice());
        drawer.setFooter(h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() }));
        onDone?.();
      });
    } catch (error) {
      statusSlot.append(notice(error.message || '填写原因已保留，请核对后重试。', { tone: 'error', title: `${action}未完成` }));
      if (error.code?.includes('idempotency')) statusSlot.append(notice('这次状态变更已有提交记录，请先核对台账和状态历史，再关闭面板重新操作。', { tone: 'warning' }));
    }
  }
  reasonField.control.focus();
}
