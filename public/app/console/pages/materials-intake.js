import { h } from '../../core/dom.js';
import { consoleApi } from '../../core/api.js';
import { button, field, notice, receipt, pageHead, definitionList } from '../../ui/primitives.js';
import { confirmAction } from '../../ui/overlay.js';
import { materialServices } from '../../shared/material-services.js';
import { materialEmpty, materialSection } from '../../shared/material-ui.js';
import { openInventoryCreateDrawer } from '../materials-lifecycle.js';
import { integerInput, inventoryLifecycleEnabled, inventoryOperationAllowed, MOVEMENT_REASONS, movementApplications, returnProgress } from '../materials-model.js';

export default async function intakePage({ query = new URLSearchParams() } = {}) {
  const linkedApplicationId = query.get('applicationId');
  const direction = field({ label: '登记方向', name: 'movementDirection', value: linkedApplicationId ? 'out' : 'in', options: [{ value: 'in', label: '入库' }, { value: 'out', label: '出库' }] });
  const reason = field({ label: linkedApplicationId ? '出库类型' : '入库类型', name: 'movementReason', options: linkedApplicationId
    ? MOVEMENT_REASONS.out.map(value => ({ value, label: value === '借用备货' ? '借用出库' : value }))
    : ['借用归还', ...MOVEMENT_REASONS.in.filter(value => value !== '借用归还')] });
  const code = field({ label: '物资编号 / 类别码', name: 'intakeCode', placeholder: '使用扫码枪，或手动输入物资编号', hint: '输入完整编号后自动匹配物资，也可按回车定位。' });
  code.control.autocomplete = 'off';
  const quantity = field({ label: '登记数量', name: 'intakeQuantity', type: 'number', min: 1, step: 1, value: '1', required: true });
  const loss = field({ label: '损耗数量', name: 'movementLoss', type: 'number', min: 0, step: 1, value: '0', hint: '只结算借用责任，不增加库存。' });
  const application = field({ label: '选择借用记录', name: 'movementApplication', options: [{ value: '', label: '请选择申请' }], required: true });
  const asset = field({ label: '选择物资', name: 'movementAsset', searchable: true, options: [{ value: '', label: '请选择物资' }] });
  const newMaterialActions = h('div', { class: 'stack-2', hidden: true });
  const applicationHint = h('p', { class: 't-caption', aria: { live: 'polite' } });
  const reference = field({ label: '来源 / 去向 / 核对说明', name: 'intakeReference', required: true, maxlength: 500 });
  const photo = field({ label: '出库照片', name: 'movementPhoto', type: 'file', required: true, hint: '借用备货须拍照留痕。' });
  photo.control.accept = 'image/jpeg,image/png,image/webp';
  const modeNotice = h('div', { class: 'material-mode-notice' });
  const status = h('div', { aria: { live: 'polite' } });
  const target = h('div', { class: 'material-target', aria: { live: 'polite' } });
  const empty = materialEmpty('选择要登记的记录', '入库归还请选择借出中的记录；借用出库请选择待出库记录。', 'inbox');
  const balance = h('p', { class: 'material-balance', aria: { live: 'polite' } });
  const movement = h('div', { class: 'stack-4', hidden: true });
  const loanFields = h('div', { class: 'stack-3', hidden: true }, application, applicationHint);
  let item = null, key = null, busy = false, disposed = false, enabled = false, candidates = [], schema, overview, scanTimer;
  const returning = () => reason.control.value === '借用归还';
  const borrowing = () => reason.control.value === '借用备货';
  const reasonLabel = () => borrowing() ? '借用出库' : reason.control.value;
  const lookup = button({ label: '定位物资', type: 'submit', variant: 'secondary', iconName: 'scan' });
  const register = button({ label: '确认登记', variant: 'primary', onClick: submit });
  const scanner = h('details', { class: 'material-originals' }, h('summary', { text: '使用扫码枪 / 手动输入编号' }),
    h('form', { class: 'stack-3', on: { submit: event => { event.preventDefault(); locate(); } } }, code, lookup));
  const manualAsset = h('details', { class: 'material-originals', hidden: true }, h('summary', { text: '按名称选择物资（备用）' }), asset);
  const form = h('div', { class: 'stack-5' },
    materialSection('选择登记业务', '先选择入库或出库，关联借用记录后核对物资。', '01'),
    h('div', { class: 'formgrid' }, direction, reason), loanFields, scanner, manualAsset, newMaterialActions, status,
    h('div', { class: 'material-scan-tip' }, h('b', { text: '借用备货与归还' }),
      h('p', { class: 't-caption', text: '借用出库：待出库 → 借出中，扣减库存。借用归还：实物入库后恢复库存；全部归还后结清原借用单。' })));
  const create = button({ label: '新增物资并入库', variant: 'secondary', iconName: 'plus', onClick: async () => {
    if (busy || !enabled) return;
    invalidate();
    try { await openInventoryCreateDrawer({ capabilities: schema.capabilities, inbound: true, onDone: async payload => {
      try {
        overview = await consoleApi.materials.overview(); if (disposed) return;
        updateReasonAfterLoad();
        empty.hidden = true;
        target.replaceChildren(receipt({ title: '新物资已入库', rows: [
          ['物资', payload.item.name], ['类别码', payload.item.code], ['当前库存', `${payload.item.quantity} ${payload.item.unit}`],
          ['后续操作', '本次数量已登记，可直接用于借用；同一批物资无需再次入库。'],
        ] }));
      } catch (error) {
        if (!disposed) status.replaceChildren(notice(`新物资已入库，但目录刷新失败：${error.message}。请刷新记录，勿重复登记。`, { tone: 'warning' }));
      }
    } }); } catch (error) { status.replaceChildren(notice(error.message, { tone: 'error' })); }
  } });
  newMaterialActions.append(create, h('p', { class: 't-caption', text: '目录中没有这类物资？新增资料与首次入库一次完成。已有同类物资请直接补充库存。' }));
  const node = h('div', { class: 'view wspad wspad--wide material-intake-page' }, materialServices('intake', { console: true }),
    pageHead({ label: '物资服务', title: '出入库登记', description: '选择入库或出库，关联借用记录，核对实物后更新库存与借用状态。',
      actions: [button({ label: '核对用户归还', variant: 'secondary', href: '/console/materials/returns' }), button({ label: '刷新记录', variant: 'ghost', onClick: refresh }), button({ label: '查看共用台账', variant: 'ghost', href: '/console/materials' })] }),
    modeNotice, h('div', { class: 'material-intake-layout' },
      h('section', { class: 'panel material-scan-form' }, h('div', { class: 'panel__body' }, form)),
      h('section', { class: 'panel material-registration' }, h('div', { class: 'panel__body stack-5' },
        materialSection('核对与登记', '核对物资、数量和来源 / 去向后确认。', '02'), empty, target, movement))));
  movement.append(h('div', { class: 'formgrid' }, quantity, loss), reference, photo,
    h('div', { class: 'material-register-foot stack-3' }, balance, register));
  const controls = [direction.control, reason.control, code.control, asset.control, quantity.control, loss.control, application.control, reference.control, photo.control, lookup, register, create];
  function lock(value) {
    busy = value; controls.forEach(control => { control.disabled = value || !enabled; });
    quantity.control.readOnly = borrowing() && Boolean(candidates.find(candidate => candidate.id === application.control.value)?.requestedAssetCode);
    lookup.dataset.loading = String(value && !item); register.dataset.loading = String(value && Boolean(item));
  }
  function invalidate() {
    clearTimeout(scanTimer);
    asset.control.value = '';
    item = null; key = null; target.replaceChildren(); movement.hidden = true; empty.hidden = false; status.replaceChildren();
    [quantity, loss, application, reference, photo].forEach(entry => entry.setError(null));
    photo.control.value = ''; balance.textContent = ''; applicationHint.textContent = '';
  }
  function updateReason(force = false) {
    if (busy && !force) return;
    invalidate();
    application.control.value = ''; asset.control.value = ''; code.control.value = '';
    loanFields.hidden = !returning() && !borrowing(); loss.hidden = !returning(); photo.hidden = !borrowing();
    reason.querySelector('.field__label > span').textContent = direction.control.value === 'in' ? '入库类型' : '出库类型';
    application.querySelector('.field__label > span').textContent = returning() ? '选择借出中的记录' : '选择待出库记录';
    reason.querySelector('[role=combobox]')?.setAttribute('aria-label', direction.control.value === 'in' ? '入库类型' : '出库类型');
    application.querySelector('[role=combobox]')?.setAttribute('aria-label', returning() ? '选择借出中的记录' : '选择待出库记录');
    candidates = movementApplications(overview?.applications || [], null, reason.control.value);
    const unavailable = returning() ? (overview?.applications || []).filter(entry => !entry.returned && String(entry.status).includes('借出') && !candidates.some(candidate => candidate.id === entry.id)) : [];
    application.control.replaceChildren(h('option', { value: '', text: returning() ? '请选择要归还的借用单' : '请选择待出库的借用单' }),
      ...candidates.map(candidate => h('option', { value: candidate.id, text: `${candidate.code} · ${candidate.applicant} · ${candidate.items} · ${candidate.purpose}` })),
      ...unavailable.map(candidate => h('option', { value: candidate.id, disabled: true, text: `${candidate.code} · ${candidate.items}（需核查物资、出库数量或待同步状态）` })));
    if (unavailable.length) applicationHint.textContent = `${unavailable.length} 条借出记录需先在借用台账核查，暂不能直接归还入账。`;
    asset.hidden = returning() || borrowing();
    manualAsset.hidden = asset.hidden;
    manualAsset.open = direction.control.value === 'in';
    scanner.open = direction.control.value === 'out';
    newMaterialActions.hidden = direction.control.value !== 'in' || returning() || !inventoryLifecycleEnabled(schema, 'create');
    if ((returning() || borrowing()) && !candidates.length) status.append(notice(returning() ? '暂无可登记归还的借出记录。历史记录缺少原物资或出库数量时，需先在借用台账核查。' : '暂无待出库记录，请先完成借用审批。', { tone: 'neutral' }));
    quantity.control.min = returning() ? '0' : '1';
    reference.control.placeholder = returning() ? '例如：已核对原借用记录，归还至 A 柜'
      : borrowing() ? '例如：已按申请核对物资，备货放在空教室供领取' : direction.control.value === 'out' ? '例如：活动名称、领用人或消耗用途' : '例如：采购单号、捐赠人或调拨来源';
  }
  direction.control.addEventListener('change', () => {
    const reasons = direction.control.value === 'in' ? ['借用归还', ...MOVEMENT_REASONS.in.filter(value => value !== '借用归还')] : MOVEMENT_REASONS.out;
    reason.control.replaceChildren(...reasons.map(value => h('option', { value, text: value === '借用备货' ? '借用出库' : value })));
    updateReason();
    if (direction.control.value === 'out' && enabled) code.control.focus();
  });
  reason.control.addEventListener('change', () => updateReason());
  code.control.addEventListener('input', () => {
    if (busy) return;
    invalidate();
    const value = code.control.value.trim();
    if (overview?.inventory.some(entry => entry.code === value)) scanTimer = setTimeout(() => {
      if (!disposed && code.control.value.trim() === value) locate();
    }, 250);
  });
  function updateBalance() {
    if (!item) return;
    const count = integerInput(quantity.control.value, { allowZero: returning() });
    const insufficient = count !== null && direction.control.value === 'out' && count > item.quantity;
    balance.classList.toggle('is-error', count === null || insufficient);
    balance.textContent = count === null ? '请输入有效的整数数量。' : insufficient
      ? `库存不足：当前 ${item.quantity} ${item.unit}，拟出库 ${count} ${item.unit}。`
      : `库存：${item.quantity} ${direction.control.value === 'in' ? '+' : '−'} ${count} = ${item.quantity + (direction.control.value === 'in' ? count : -count)} ${item.unit}`;
    const selected = candidates.find(candidate => candidate.id === application.control.value);
    applicationHint.textContent = selected ? `${selected.code} · ${selected.applicant} · ${selected.items} · ${selected.purpose}${returning() ? ` · 待归还 ${returnProgress(selected).outstanding} 件` : ''}` : '';
  }
  quantity.control.addEventListener('input', updateBalance); loss.control.addEventListener('input', updateBalance);
  async function selectApplication() {
    if (busy) return;
    const matchedCode = item?.code || code.control.value.trim();
    invalidate();
    const selected = candidates.find(candidate => candidate.id === application.control.value);
    asset.hidden = !selected || Boolean(selected.assetCode || selected.requestedAssetCode);
    manualAsset.hidden = asset.hidden;
    code.control.value = selected?.assetCode || selected?.requestedAssetCode || (selected ? matchedCode : '');
    asset.control.value = code.control.value;
    if (code.control.value) await locate();
    else if (selected) status.append(notice('此历史申请未关联类别码，请扫描或输入实际出库物资的编号，并核对申请件数。', { tone: 'warning' }));
    applicationHint.textContent = selected ? `${selected.applicant} · ${selected.items} · ${selected.purpose}` : '';
  }
  application.control.addEventListener('change', selectApplication);
  asset.control.addEventListener('change', () => {
    if (busy) return;
    const selectedCode = asset.control.value;
    invalidate(); code.control.value = selectedCode; locate();
  });
  [quantity, loss, reference].forEach(entry => entry.control.addEventListener('input', () => entry.setError(null)));
  [application, photo].forEach(entry => entry.control.addEventListener('change', () => entry.setError(null)));
  async function locate() {
    if (busy || !enabled || !code.control.value.trim()) return;
    invalidate(); lock(true);
    try {
      const scanned = await consoleApi.materials.scan(code.control.value.trim()); if (disposed) return;
      item = scanned.item;
      if (!inventoryOperationAllowed(item, returning() ? '归还' : direction.control.value === 'in' ? '入库' : '出库')) throw new Error('该物资已停用，仍可处理原借用归还。');
      const selected = candidates.find(candidate => candidate.id === application.control.value);
      if (selected && !movementApplications([selected], item, reason.control.value).length) throw new Error('所选物资与原借用记录不一致，请核对类别码。');
      key = crypto.randomUUID(); code.control.value = item.code;
      asset.control.value = item.code;
      target.replaceChildren(definitionList([['物资', item.name], ['类别码', item.code], ['当前库存', `${item.quantity} ${item.unit}`],
        ['存放位置', `${item.center || ''} · ${item.cabinet || ''} 柜 ${item.level || ''} 层`]]));
      empty.hidden = true; movement.hidden = false;
      quantity.control.value = String(selected ? returning() ? returnProgress(selected).outstanding : Math.max(1, Number(selected.quantity) || 1) : 1);
      loss.control.value = '0'; reference.control.value = ''; updateBalance();
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
    if (borrowing() && selected.requestedAssetCode && count !== selected.quantity) { quantity.setError('出库数量须与申请件数一致'); return; }
    if (returning() && count + missing > returnProgress(selected).outstanding) { quantity.setError('归还与损耗总数超过待核销件数'); return; }
    if (direction.control.value === 'out' && count > item.quantity) { quantity.setError('出库数量不能超过当前库存'); return; }
    if (!reference.control.value.trim()) { reference.setError('请填写来源、去向或核对说明'); reference.control.focus(); return; }
    const file = borrowing() ? photo.control.files[0] : null;
    if (borrowing() && (!file || file.size > 8 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(file.type))) { photo.setError('请上传不超过 8 MB 的 JPG、PNG 或 WebP 出库照片'); return; }
    lock(true); status.replaceChildren();
    try {
      const label = reasonLabel();
      const confirmed = await confirmAction({ title: `确认${label}登记？`,
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
      let reloadError;
      try { overview = await consoleApi.materials.overview(); }
      catch (error) { reloadError = error; overview = null; }
      if (disposed) return;
      updateReasonAfterLoad();
      status.replaceChildren(receipt({ title: result.duplicate ? '本次登记已有记录，库存未重复变更' : `${label}已在本地登记`, rows: [
        ['物资', name], ['登记数量', `${count} ${unit}`], ...(returning() ? [['损耗', `${missing} ${unit}`]] : []),
        ['当前库存', `${result.item.quantity} ${unit}`], ['流水编号', result.flowId],
        ...(selected ? [['借用状态', result.syncPending ? '待同步' : returning() ? count + missing === returnProgress(selected).outstanding ? '已归还' : '借出中（部分归还）' : '借出中']] : []),
        ...(result.syncPending ? [['申请同步', '流水已登记，请到共用台账重试同步，勿重复登记']] : [])] }));
      if (reloadError) status.append(notice('登记已完成，但记录列表刷新失败，请点击“刷新记录”，勿重复登记。', { tone: 'warning' }));
    } catch (error) { if (!disposed) status.replaceChildren(notice(error.message, { tone: 'error', title: '登记未完成，填写内容已保留' })); }
    finally { lock(false); }
  }
  async function refresh() {
    if (busy || !enabled) return;
    lock(true);
    try { overview = await consoleApi.materials.overview(); if (!disposed) updateReasonAfterLoad(); }
    catch (error) { if (!disposed) status.replaceChildren(notice(error.message, { tone: 'error' })); }
    finally { lock(false); }
  }
  function updateReasonAfterLoad() {
    asset.control.replaceChildren(h('option', { value: '', text: '请选择物资' }), ...(overview?.inventory || []).filter(entry => inventoryOperationAllowed(entry, direction.control.value === 'in' ? '入库' : '出库'))
      .map(entry => h('option', { value: entry.code, text: `${entry.name} · 库存 ${entry.quantity} ${entry.unit} · ${entry.center || ''} ${entry.cabinet || ''}` })));
    updateReason(true);
  }
  lock(true);
  try {
    [schema, overview] = await Promise.all([consoleApi.materials.schema(), consoleApi.materials.overview()]);
    enabled = schema.capabilities?.stockMovements?.mode === 'local-only' && schema.capabilities.stockMovements.remoteWrites === false;
    create.hidden = !inventoryLifecycleEnabled(schema, 'create');
    if (!enabled) modeNotice.append(notice('当前环境未启用本地登记，禁止向远端库写入。', { tone: 'warning' }));
    updateReasonAfterLoad();
  } catch (error) { modeNotice.append(notice(error.message, { tone: 'error' })); }
  lock(false);
  if (linkedApplicationId && enabled && overview) {
    // A link is only a selection hint. Recheck the latest snapshot before enabling registration.
    const selected = candidates.find(candidate => candidate.id === linkedApplicationId);
    if (!selected) {
      status.replaceChildren(notice('该借用记录不存在或已不处于待出库状态，请刷新借用台账后核对。', { tone: 'warning' }));
    } else {
      application.control.value = selected.id;
      await selectApplication();
    }
  }
  return { title: '出入库登记', crumb: '出入库登记', node, dispose: () => { disposed = true; clearTimeout(scanTimer); } };
}
