/** Preview-only lifecycle. Availability lives in memory, never in a production table column. */
import { createMutationQueue, assertCompleteRows } from '../events/safety.js';
import { integer, MATERIAL_TABLES, isSyncPending, readAnnotation } from './service.js';

export const INVENTORY_LIFECYCLE_CAPABILITY = Object.freeze({ mode: 'local-demo', create: true, availability: true });
const creationFields = ['name', 'unit', 'center', 'cabinet', 'level', 'initialQuantity', 'threshold', 'thresholdEnabled'];
const inventoryColumns = { name: '物资名称', unit: '单位', center: '中心', cabinet: '柜号', level: '层数' };
const text = value => String(value ?? '').trim();

function fail(status, message, code = 'preview_lifecycle_validation') {
  const error = new Error(message); error.statusCode = status; error.code = code; throw error;
}
function requestObject(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) fail(400, '请求包含不支持的物资字段');
}
function operationKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) fail(400, '请提供 1 至 160 个字符的操作标识');
  return value.trim();
}
function reasonText(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000 || value.includes('[RC-MATERIALS-V1]')) fail(400, '请填写 1 至 2000 个字符的停用或恢复原因');
  return value.trim();
}
function creationValue(key, value, field) {
  if (!field?.editable) fail(409, `字段 ${key} 未配置为可编辑，无法新建物资`);
  if (key === 'threshold') return integer(value, '预警阈值');
  if (key === 'thresholdEnabled') {
    if (typeof value !== 'boolean') fail(400, '预警启用状态必须为布尔值');
    if (field.type === 'single-select' && !field.options.some(option => value ? /^(true|是|yes|y|1|开启|启用)$/i.test(option) : /^(false|否|no|n|0|禁用|关闭)$/i.test(option))) fail(409, '预警启用字段缺少对应选项，无法新建物资');
    return value;
  }
  if (field.type === 'number') return integer(value, '位置字段');
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) fail(400, `字段 ${key} 应为 1 至 120 个字符`);
  const result = value.trim();
  if (field.type === 'single-select' && !field.options.includes(result)) fail(400, `字段 ${key} 必须选择已配置选项`);
  return result;
}

/** All preview reads/writes use this queue so a toggle cannot race a checkout or expose half a creation. */
export function createPreviewLifecycle({ service, fixture, actor = '本地合成管理员', now = () => '2026-10-04T12:00:00+08:00', seedDisabled = true }) {
  const queue = createMutationQueue(), states = new Map(), receipts = new Map(), createdIds = new Set();
  if (seedDisabled) states.set('synthetic-tent', { availability: 'disabled', availabilityReason: '合成场景：帐篷待检修，暂不接受新的入库或出库',
    availabilityHistory: [{ date: now(), operator: actor, action: 'disable', reason: '合成场景：帐篷待检修，暂不接受新的入库或出库' }] });
  function project(item) {
    // A new preview asset has an explicit initial inbound, so its zero baseline is explained.
    // Keep the legacy history calculation unchanged for every pre-existing asset.
    return { ...item, ...(createdIds.has(item.id) ? { untrackedDifference: 0, initialization: 'inbound-ledger' } : {}),
      ...structuredClone(states.get(item.id) || { availability: 'active', availabilityReason: '', availabilityHistory: [] }) };
  }
  function projectResult(result) { return result.item ? { ...result, item: project(result.item) } : result; }
  async function duplicate(key, fingerprint) {
    const previous = receipts.get(key);
    if (!previous) return null;
    if (previous.fingerprint !== fingerprint) fail(409, '同一操作标识不能用于不同的物资资料或状态', 'preview_lifecycle_idempotency_conflict');
    const result = await service.scan(`NJU-RC-${previous.id}`);
    return { ok: true, duplicate: true, item: project(result.item), message: '操作已记录，没有重复创建或改变状态。' };
  }
  async function existingFlow(key) {
    if (!text(key)) return null;
    const flows = await fixture.listRows(MATERIAL_TABLES.flows); assertCompleteRows(flows);
    return flows.find(row => text(row['幂等键']) === text(key));
  }
  async function checkNewMovement(body, operation, applicationId = '') {
    if (!['入库', '出库'].includes(operation)) return;
    const disabled = [...states.entries()].some(([id, state]) => `NJU-RC-${id}` === text(body.assetCode) && state.availability === 'disabled');
    if (!disabled) return;
    const previous = await existingFlow(body.idempotencyKey);
    if (!previous) fail(409, '该物资已停用，不能登记新的入库或出库；原申请归还仍可继续。', 'preview_material_disabled');
    // Permit an exact replay, then let the real core perform its normal idempotency validation.
    if (text(previous['资产编码']) !== text(body.assetCode) || text(previous['申请单ID']) !== applicationId || text(previous['操作类型']) !== operation
      || previous['数量'] !== integer(body.quantity, '数量', { min: 1 }) || (previous['损耗数量'] || 0) !== integer(body.lossQuantity, '损耗数量', { optional: true })
      || readAnnotation(previous).note !== text(body.note) || (Object.hasOwn(body, 'destination') && text(previous['流转去向']) !== text(body.destination))) {
      fail(409, '同一操作标识不能用于不同的物资、数量、备注或去向', 'material_idempotency_conflict');
    }
  }
  async function overview() {
    return queue(async () => {
      const result = await service.overview();
      const inventory = result.inventory.map(project);
      return { ...result, inventory, lowStock: result.lowStock.map(project), thresholdNotices: result.thresholdNotices.map(project),
        stats: { ...result.stats, activeQuantity: inventory.filter(item => item.availability === 'active').reduce((sum, item) => sum + item.quantity, 0),
          disabledQuantity: inventory.filter(item => item.availability === 'disabled').reduce((sum, item) => sum + item.quantity, 0),
          totalUntrackedDifference: inventory.reduce((sum, item) => sum + item.untrackedDifference, 0) },
        capabilities: { ...result.capabilities, inventoryLifecycle: INVENTORY_LIFECYCLE_CAPABILITY } };
    });
  }
  async function schema() {
    return queue(async () => {
      const result = await service.schema();
      return { ...result, capabilities: { ...result.capabilities, inventoryLifecycle: INVENTORY_LIFECYCLE_CAPABILITY },
        creation: { fields: { ...result.fields, initialQuantity: { editable: true, type: 'number', options: [], min: 0, integer: true } },
          required: creationFields, assetCode: 'generated', stockInitialization: 'inbound-ledger' } };
    });
  }
  async function createInventory(body) {
    return queue(async () => {
      requestObject(body, [...creationFields, 'idempotencyKey']);
      if (creationFields.some(key => !Object.hasOwn(body, key))) fail(400, '请完整填写新物资资料、初始数量与预警设置');
      const key = operationKey(body.idempotencyKey), fields = (await service.schema()).fields, values = {};
      for (const name of creationFields) values[name] = name === 'initialQuantity' ? integer(body[name], '初始数量') : creationValue(name, body[name], fields[name]);
      const fingerprint = JSON.stringify({ kind: 'create', ...values }), repeated = await duplicate(key, fingerprint);
      if (repeated) return repeated;
      const snapshot = fixture.snapshot();
      let id, createdItem;
      try {
        const row = Object.fromEntries(Object.entries(inventoryColumns).map(([name, column]) => [column, values[name]]));
        const result = await fixture.client.appendRow(MATERIAL_TABLES.inventory, { ...row, '初始数量': values.initialQuantity,
          '现有数量': 0, '借出数量': 0, '归还数量': 0, '物资管理': [] });
        if (!result?._id) throw new Error('creation not acknowledged');
        id = result._id;
        await service.updateInventory(id, { threshold: values.threshold, thresholdEnabled: values.thresholdEnabled });
        if (values.initialQuantity > 0) await service.transaction({ assetCode: `NJU-RC-${id}`, operation: '入库', quantity: values.initialQuantity,
          note: '本地演示：新物资初始入库', destination: '新建物资存放位置', idempotencyKey: `preview:create-inbound:${id}` });
        createdItem = (await service.scan(`NJU-RC-${id}`)).item;
        if (createdItem.initial !== values.initialQuantity || createdItem.baselineQuantity !== 0 || createdItem.quantity !== values.initialQuantity) throw new Error('creation stock not confirmed');
      } catch {
        fixture.restore(snapshot);
        fail(502, '本地新建未完成，已回退本次合成数据；请核对资料后重试。', 'preview_lifecycle_create_failed');
      }
      states.set(id, { availability: 'active', availabilityReason: '', availabilityHistory: [
        { date: now(), operator: actor, action: 'create', reason: values.initialQuantity > 0 ? `新建物资，初始入库 ${values.initialQuantity}` : '新建物资，初始数量为零' },
      ] });
      createdIds.add(id);
      receipts.set(key, { fingerprint, id });
      return { ok: true, item: project(createdItem), message: '物资已在本地演示中创建，资产编码由系统生成。' };
    });
  }
  async function changeAvailability(id, body) {
    return queue(async () => {
      requestObject(body, ['availability', 'reason', 'idempotencyKey']);
      if (!['active', 'disabled'].includes(body.availability)) fail(400, '物资状态必须为 active 或 disabled');
      const key = operationKey(body.idempotencyKey), reason = reasonText(body.reason);
      const fingerprint = JSON.stringify({ kind: 'availability', id, availability: body.availability, reason }), repeated = await duplicate(key, fingerprint);
      if (repeated) return repeated;
      const item = project((await service.scan(`NJU-RC-${id}`)).item);
      if (item.availability === body.availability) fail(409, '物资已处于该状态，请刷新后核对');
      if (body.availability === 'disabled') {
        const flows = await fixture.listRows(MATERIAL_TABLES.flows); assertCompleteRows(flows);
        if (flows.some(row => text(row['资产编码']) === item.code && isSyncPending(row))) fail(409, '存在待同步流水，请先恢复申请状态同步，再停用物资。', 'material_sync_pending');
      }
      const state = { availability: body.availability, availabilityReason: reason, availabilityHistory: [
        ...item.availabilityHistory, { date: now(), operator: actor, action: body.availability === 'disabled' ? 'disable' : 'restore', reason },
      ] };
      states.set(id, state); receipts.set(key, { fingerprint, id });
      return { ok: true, item: project(item), message: body.availability === 'disabled' ? '本地物资已停用，库存与历史记录保留，原申请仍可归还。' : '本地物资已恢复使用，库存数量未变更。' };
    });
  }
  return {
    overview, schema, createInventory, changeAvailability,
    scan: code => queue(async () => projectResult(await service.scan(code))),
    listFlows: params => queue(() => service.listFlows(params)),
    updateInventory: (id, body) => queue(async () => projectResult(await service.updateInventory(id, body))),
    reviewApplication: (...args) => queue(() => service.reviewApplication(...args)),
    retrySync: id => queue(() => service.retrySync(id)), reviewFlow: (id, body) => queue(() => service.reviewFlow(id, body)),
    transaction: body => queue(async () => { await checkNewMovement(body, text(body.operation)); return projectResult(await service.transaction(body)); }),
    applicationAction: (id, action, body, photo) => queue(async () => { if (action === 'checkout') await checkNewMovement(body, '出库', id); return projectResult(await service.applicationAction(id, action, body, photo)); }),
  };
}
