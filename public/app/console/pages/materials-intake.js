import { h } from '../../core/dom.js';
import { consoleApi } from '../../core/api.js';
import { button, field, notice, receipt, pageHead, definitionList } from '../../ui/primitives.js';
import { confirmAction } from '../../ui/overlay.js';
import { materialServices } from '../../shared/material-services.js';
import { materialEmpty, materialSection } from '../../shared/material-ui.js';
import { openInventoryCreateDrawer } from '../materials-lifecycle.js';
import { integerInput, inventoryLifecycleEnabled, inventoryOperationAllowed, MOVEMENT_REASONS, movementApplications, returnProgress } from '../materials-model.js';

export default async function intakePage() {
  const direction = field({ label: '登记方向', name: 'movementDirection', value: 'in', options: [{ value: 'in', label: '入库' }, { value: 'out', label: '出库' }] });
  const reason = field({ label: '业务原因', name: 'movementReason', options: MOVEMENT_REASONS.in });
  const code = field({ label: '扫描物资码', name: 'intakeCode', placeholder: '扫码枪输入后回车，或手工输入类别码', required: true, hint: '同类物资共用一个码；扫码定位后填写本次数量。' });
  code.control.autocomplete = 'off';
  const quantity = field({ label: '登记数量', name: 'intakeQuantity', type: 'number', min: 1, step: 1, value: '1', required: true });
  const loss = field({ label: '损耗数量', name: 'movementLoss', type: 'number', min: 0, step: 1, value: '0', hint: '只结算借用责任，不增加库存。' });
  const application = field({ label: '关联借用申请', name: 'movementApplication', options: [{ value: '', label: '请选择申请' }], required: true });
  const applicationHint = h('p', { class: 't-caption', aria: { live: 'polite' } });
  const reference = field({ label: '来源 / 去向 / 核对说明', name: 'intakeReference', required: true, maxlength: 500 });
  const photo = field({ label: '出库照片', name: 'movementPhoto', type: 'file', required: true, hint: '借用备货须拍照留痕。' });
  photo.control.accept = 'image/jpeg,image/png,image/webp';
  const modeNotice = h('div', { class: 'material-mode-notice' });
  const status = h('div', { aria: { live: 'polite' } });
  const target = h('div', { class: 'material-target', aria: { live: 'polite' } });
  const empty = materialEmpty('等待扫码定位', '选择登记方向与原因，再扫描物资码。物资和数量会在这里显示。', 'scan');
  const balance = h('p', { class: 'material-balance', aria: { live: 'polite' } });
  const movement = h('div', { class: 'stack-4', hidden: true });
  const loanFields = h('div', { class: 'stack-3', hidden: true }, application, applicationHint);
  let item = null, key = null, busy = false, disposed = false, enabled = false, candidates = [], schema;
  const returning = () => reason.control.value === '借用归还';
  const borrowing = () => reason.control.value === '借用备货';
  const lookup = button({ label: '定位物资', type: 'submit', variant: 'secondary', iconName: 'scan' });
  const register = button({ label: '确认登记', variant: 'primary', onClick: submit });
  const form = h('form', { class: 'stack-5', on: { submit: event => { event.preventDefault(); locate(); } } },
    materialSection('选择与扫码', '先确定本次要登记的业务。', '01'),
    h('div', { class: 'formgrid' }, direction, reason), code, lookup, status,
    h('div', { class: 'material-scan-tip' }, h('b', { text: '借用备货与归还' }),
      h('p', { class: 't-caption', text: '备货时登记出库，志愿者领取不再扣库存。归还请选择“借用归还”，关联原借用申请。' })));
  const create = button({ label: '新增物资资料', variant: 'ghost', onClick: async () => {
    if (busy || !enabled) return;
    try { await openInventoryCreateDrawer({ capabilities: schema.capabilities, onDone: () => {
      status.replaceChildren(notice('物资资料已在本地创建；初始库存已登记，请使用新类别码。', { tone: 'info' }));
    } }); } catch (error) { status.replaceChildren(notice(error.message, { tone: 'error' })); }
  } });
  const node = h('div', { class: 'view wspad wspad--wide material-intake-page' }, materialServices('intake', { console: true }),
    pageHead({ label: '物资服务', title: '出入库登记', description: '选择方向与原因，扫描类别码，核对数量后确认。',
      actions: [button({ label: '核对入库申请', variant: 'secondary', href: '/console/materials/inbound' }), button({ label: '查看共用台账', variant: 'ghost', href: '/console/materials' }), create] }),
    modeNotice, h('div', { class: 'material-intake-layout' },
      h('section', { class: 'panel material-scan-form' }, h('div', { class: 'panel__body' }, form)),
      h('section', { class: 'panel material-registration' }, h('div', { class: 'panel__body stack-5' },
        materialSection('核对与登记', '核对物资、数量和来源 / 去向后确认。', '02'), empty, target, movement))));
  movement.append(loanFields, h('div', { class: 'formgrid' }, quantity, loss), reference, photo,
    h('div', { class: 'material-register-foot stack-3' }, balance, register));
  const controls = [direction.control, reason.control, code.control, quantity.control, loss.control, application.control, reference.control, photo.control, lookup, register, create];
  function lock(value) {
    busy = value; controls.forEach(control => { control.disabled = value || !enabled; });
    lookup.dataset.loading = String(value && !item); register.dataset.loading = String(value && Boolean(item));
  }
  function invalidate() {
    item = null; key = null; candidates = []; target.replaceChildren(); movement.hidden = true; empty.hidden = false; status.replaceChildren();
    [quantity, loss, application, reference, photo].forEach(entry => entry.setError(null));
    photo.control.value = ''; application.control.value = ''; balance.textContent = '';
  }
  function updateReason() {
    if (busy) return;
    invalidate();
    loanFields.hidden = !returning() && !borrowing(); loss.hidden = !returning(); photo.hidden = !borrowing();
    quantity.control.min = returning() ? '0' : '1';
    reference.control.placeholder = returning() ? '例如：已核对原借用记录，归还至 A 柜'
      : borrowing() ? '例如：已按申请核对物资，备货放在空教室供领取' : direction.control.value === 'out' ? '例如：活动名称、领用人或消耗用途' : '例如：采购单号、捐赠人或调拨来源';
  }
  direction.control.addEventListener('change', () => {
    reason.control.replaceChildren(...MOVEMENT_REASONS[direction.control.value].map(value => h('option', { value, text: value })));
    updateReason();
  });
  reason.control.addEventListener('change', updateReason);
  code.control.addEventListener('input', invalidate);
  function updateBalance() {
    if (!item) return;
    const count = integerInput(quantity.control.value, { allowZero: returning() });
    const insufficient = count !== null && direction.control.value === 'out' && count > item.quantity;
    balance.classList.toggle('is-error', count === null || insufficient);
    balance.textContent = count === null ? '请输入有效的整数数量。' : insufficient
      ? `库存不足：当前 ${item.quantity} ${item.unit}，拟出库 ${count} ${item.unit}。`
      : `库存：${item.quantity} ${direction.control.value === 'in' ? '+' : '−'} ${count} = ${item.quantity + (direction.control.value === 'in' ? count : -count)} ${item.unit}`;
    const selected = candidates.find(candidate => candidate.id === application.control.value);
    applicationHint.textContent = selected ? `${selected.code} · ${selected.applicant} · ${selected.items} · ${selected.purpose}${returning() ? ` · 待核销 ${returnProgress(selected).outstanding} 件` : '；请人工核对所扫物资与申请一致。'}` : '';
  }
  quantity.control.addEventListener('input', updateBalance); loss.control.addEventListener('input', updateBalance);
  application.control.addEventListener('change', updateBalance);
  [quantity, loss, reference].forEach(entry => entry.control.addEventListener('input', () => entry.setError(null)));
  [application, photo].forEach(entry => entry.control.addEventListener('change', () => entry.setError(null)));
  async function locate() {
    if (busy || !enabled || !code.control.value.trim()) return;
    invalidate(); lock(true);
    try {
      const scanned = await consoleApi.materials.scan(code.control.value.trim()); if (disposed) return;
      item = scanned.item;
      if (!inventoryOperationAllowed(item, returning() ? '归还' : direction.control.value === 'in' ? '入库' : '出库')) throw new Error('该物资已停用，仍可处理原借用归还。');
      if (borrowing() || returning()) {
        const overview = await consoleApi.materials.overview(); if (disposed) return;
        candidates = movementApplications(overview.applications, item, reason.control.value);
        application.control.replaceChildren(h('option', { value: '', text: '请选择原借用申请' }),
          ...candidates.map(candidate => h('option', { value: candidate.id, text: `${candidate.code} · ${candidate.applicant} · ${candidate.items}` })));
        if (!candidates.length) status.append(notice(returning() ? '没有该物资可核验的待归还申请；历史记录需先核查，不能当作普通补货。' : '没有可出库的已审批申请，请先到物资台账核对。', { tone: 'warning' }));
      }
      key = crypto.randomUUID(); code.control.value = item.code;
      target.replaceChildren(definitionList([['物资', item.name], ['类别码', item.code], ['当前库存', `${item.quantity} ${item.unit}`],
        ['存放位置', `${item.center || ''} · ${item.cabinet || ''} 柜 ${item.level || ''} 层`]]));
      empty.hidden = true; movement.hidden = false; quantity.control.value = '1'; loss.control.value = '0'; reference.control.value = ''; updateBalance();
    } catch (error) {
      item = null; target.replaceChildren(); empty.hidden = false; movement.hidden = true; status.replaceChildren(notice(error.message, { tone: 'error', title: '物资未定位或暂不能登记' }));
    } finally { lock(false); if (item) quantity.control.focus(); }
  }
  async function submit() {
    if (busy || !enabled || !item) return;
    [quantity, loss, application, reference, photo].forEach(entry => entry.setError(null));
    const count = integerInput(quantity.control.value, { allowZero: returning() });
    const missing = returning() ? integerInput(loss.control.value, { allowZero: true }) : 0;
    if (count === null) { quantity.setError(returning() ? '请填写非负整数数量' : '请填写正整数数量'); quantity.control.focus(); return; }
    if (missing === null || (returning() && count + missing === 0)) { loss.setError('归还与损耗须为非负整数，且不能同时为零'); loss.control.focus(); return; }
    const selected = candidates.find(candidate => candidate.id === application.control.value);
    if ((borrowing() || returning()) && !selected) { application.setError('请选择原借用申请'); application.control.focus(); return; }
    if (returning() && count + missing > returnProgress(selected).outstanding) { quantity.setError('归还与损耗总数超过待核销件数'); return; }
    if (direction.control.value === 'out' && count > item.quantity) { quantity.setError('出库数量不能超过当前库存'); return; }
    if (!reference.control.value.trim()) { reference.setError('请填写来源、去向或核对说明'); reference.control.focus(); return; }
    const file = borrowing() ? photo.control.files[0] : null;
    if (borrowing() && (!file || file.size > 8 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(file.type))) { photo.setError('请上传不超过 8 MB 的 JPG、PNG 或 WebP 出库照片'); return; }
    lock(true); status.replaceChildren();
    try {
      const confirmed = await confirmAction({ title: `确认${reason.control.value}登记？`,
        description: `${item.name} · ${balance.textContent}${selected ? ` · ${selected.code} · ${selected.items}` : ''}${returning() ? ` · 损耗 ${missing} 件` : ''}。仅保存在本地，不修改远端库。`, confirmLabel: '确认登记' });
      if (!confirmed || disposed) return;
      const data = new FormData();
      const values = { direction: direction.control.value, reason: reason.control.value, assetCode: item.code, quantity: count,
        lossQuantity: missing, reference: reference.control.value.trim(), idempotencyKey: key, applicationId: selected?.id || '' };
      for (const [name, value] of Object.entries(values)) data.append(name, String(value));
      if (file) data.append('photo', file);
      const result = await consoleApi.materials.movementDemo(data); if (disposed) return;
      const name = item.name, unit = item.unit;
      code.control.value = ''; invalidate();
      status.replaceChildren(receipt({ title: result.duplicate ? '本次登记已有记录，库存未重复变更' : `${values.reason}已在本地登记`, rows: [
        ['物资', name], ['登记数量', `${count} ${unit}`], ...(returning() ? [['损耗', `${missing} ${unit}`]] : []),
        ['当前库存', `${result.item.quantity} ${unit}`], ['流水编号', result.flowId],
        ...(result.syncPending ? [['申请同步', '流水已登记，请到共用台账重试同步，勿重复登记']] : [])] }));
    } catch (error) { if (!disposed) status.replaceChildren(notice(error.message, { tone: 'error', title: '登记未完成，填写内容已保留' })); }
    finally { lock(false); if (!item && !disposed) code.control.focus(); }
  }
  lock(true);
  try {
    schema = await consoleApi.materials.schema();
    enabled = schema.capabilities?.stockMovements?.mode === 'local-only' && schema.capabilities.stockMovements.remoteWrites === false;
    create.hidden = !inventoryLifecycleEnabled(schema, 'create');
    modeNotice.append(notice(enabled ? schema.preview?.message || '本地试用：登记不写入远端库。' : '当前环境未启用本地登记，禁止向远端库写入。', { tone: 'info' }));
  } catch (error) { modeNotice.append(notice(error.message, { tone: 'error' })); }
  lock(false); updateReason();
  return { title: '出入库登记', crumb: '出入库登记', node, dispose: () => { disposed = true; } };
}
