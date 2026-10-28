import { materialFailure as fail, materialDigest as hash } from './workflow-store.js';
import { MATERIAL_TABLES, applicationProgress, integer, readAnnotation } from './service.js';
import { assertCompleteRows } from '../events/safety.js';
import { validateAttendancePhoto } from '../events/photo-validation.js';

const txt = value => String(value ?? '').trim();
function text(value, label, max = 500, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f]/.test(value.replace(/[\r\n\t]/g, ''))) throw fail(400, `请填写${label}，不超过 ${max} 个字符。`);
  return value.trim();
}
function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k))) throw fail(400, '请求包含不支持的字段。');
}
function signedIn(actor) { if (!actor?.id) throw fail(401, '请先登录。'); }
function manager(actor) { signedIn(actor); if (actor.canReview !== true) throw fail(403, '需要物资管理权限。'); }
const publicRecord = record => Object.fromEntries(Object.entries(record).filter(([key]) => !['owner', 'fingerprint', 'photo', 'kind', 'creation', 'actor', 'processingActor'].includes(key)));

/** Formal Table records and Box photos; no fixture, memory rollback or demo writer. */
export function createProductionMaterialWorkflow({ store, getClient, listRows, getCore, readOverview, performApplication, photos, beforeStockWrite = async () => {}, now = () => new Date().toISOString() }) {
  const rows = async table => { const result = await listRows(await getClient(), table); assertCompleteRows(result); return result; };
  async function records(kind, required = true) {
    const result = await store.entries(required);
    return { ready: result.ready, entries: result.records.filter(entry => entry.document.kind === kind) };
  }
  async function ownedLoans(actor) {
    signedIn(actor);
    if (!actor.emailVerified || !/^\d{6,20}$/.test(actor.studentId || '')) throw fail(403, '请先完成校园邮箱与实名信息核验。');
    const [applications, flows, inventory, registered] = await Promise.all([rows(MATERIAL_TABLES.applications), rows(MATERIAL_TABLES.flows), rows(MATERIAL_TABLES.inventory), records('return', false)]);
    return applications.filter(row => txt(row['学号']) === actor.studentId
      && (!txt(row['邮箱']) || txt(row['邮箱']).toLowerCase() === txt(actor.email).toLowerCase())
      && txt(row['姓名']) === txt(actor.realName)).map(row => {
      const progress = applicationProgress(row, flows), item = inventory.find(item => `NJU-RC-${item._id}` === progress.assetCode);
      return { id: row._id, code: `REQ-${row._id}`, assetCode: progress.assetCode, name: item?.['物资名称'] || row['借用物资名及数量'], unit: item?.['单位'] || '件',
        status: txt(row['状态']), verified: progress.verified && !progress.syncPending, outstanding: progress.outstandingQuantity,
        plannedReturnDate: row['拟归还日期'] || null, pendingReturn: registered.entries.some(entry => entry.document.applicationId === row._id && entry.document.status === 'pending') };
    }).filter(item => item.verified && item.outstanding > 0 && item.status.includes('借出'));
  }
  async function listLoans(actor) {
    return { ok: true, loans: await ownedLoans(actor), registrationReady: (await store.inspect()).ready };
  }
  async function list(actor, reviewing = false, kind = 'return') {
    if (reviewing) manager(actor); else signedIn(actor);
    const result = await records(kind, false);
    return { ok: true, registrationReady: result.ready, records: result.entries.filter(entry => reviewing || entry.document.owner === actor.id).map(entry => publicRecord(entry.document)) };
  }
  async function submit(actor, body, photo) {
    signedIn(actor); fields(body, ['applicationId', 'quantity', 'note', 'idempotencyKey']);
    const key = text(body.idempotencyKey, '操作标识', 160), applicationId = text(body.applicationId, '原借用单', 160);
    const quantity = integer(body.quantity, '归还数量', { min: 1 }), note = text(body.note, '归还说明', 500, true);
    let bytes;
    if (photo) {
      if (!(photo instanceof File) || !/^image\/(jpeg|png|webp)$/.test(photo.type)) throw fail(400, '归还照片仅支持 JPG、PNG 和 WebP。');
      if (!photo.size || photo.size > 8 * 1024 ** 2) throw fail(413, '归还照片须小于 8 MB。');
      bytes = Buffer.from(await photo.arrayBuffer());
      const validated = await validateAttendancePhoto(bytes, { maxBytes: 8 * 1024 ** 2 });
      if (validated.contentType !== photo.type) throw fail(400, '照片内容与文件类型不一致。');
    }
    const id = `return:${hash([actor.id, key])}`, fingerprint = hash([applicationId, quantity, note, photo?.type || '', bytes ? hash(bytes) : '']);
    const existing = await store.get(id);
    if (existing) {
      if (existing.document.owner !== actor.id || existing.document.fingerprint !== fingerprint) throw fail(409, '同一操作标识不能用于不同归还内容。');
      return { ok: true, duplicate: true, record: publicRecord(existing.document) };
    }
    const loan = (await ownedLoans(actor)).find(item => item.id === applicationId);
    if (!loan) throw fail(404, '借用单不存在、不属于当前账号或已结清，请刷新后核对。');
    if (loan.pendingReturn) throw fail(409, '该借用单已有待核对归还，请等待管理员处理。');
    if (quantity > loan.outstanding) throw fail(409, `归还数量不能超过待还数量 ${loan.outstanding}。`);
    const storedPhoto = photo ? { ...await photos.put({ sha256: hash(bytes), bytes }), type: photo.type } : null;
    const record = { id, kind: 'return', fingerprint, owner: actor.id, code: `RT-${id.slice(-10).toUpperCase()}`, applicationId, applicationCode: loan.code,
      assetCode: loan.assetCode, name: loan.name, unit: loan.unit, quantity, note, status: 'pending', revision: 1, createdAt: now(),
      photo: storedPhoto, photoUrl: storedPhoto ? `/api/public/materials/returns/${encodeURIComponent(id)}/photo` : null };
    await store.save(record);
    return { ok: true, record: publicRecord(record) };
  }
  async function photo(actor, id) {
    signedIn(actor); const entry = await store.get(id), record = entry?.document;
    if (!record || record.kind !== 'return' || record.owner !== actor.id && actor.canReview !== true || !record.photo) throw fail(404, '归还照片不存在。');
    const bytes = await photos.read(record.photo);
    if (bytes.length !== record.photo.size || hash(bytes) !== record.photo.sha256) throw fail(503, '归还照片校验失败，请联系管理员。');
    return { bytes, type: record.photo.type };
  }
  async function review(actor, id, body, context, kind = 'return') {
    manager(actor); fields(body, ['action', 'revision', 'physicalChecked', 'note']);
    const entry = await store.get(id); let record = entry?.document, version = entry?.version;
    if (!record || record.kind !== kind) throw fail(404, '登记不存在。');
    if (!['approve', 'reject'].includes(body.action)) throw fail(400, '请选择通过或退回。');
    const note = text(body.note, '核对意见', 500, body.action === 'approve');
    if (record.status !== 'pending' || record.revision !== body.revision) throw fail(409, '登记状态或版本已变化，请刷新。');
    if (record.processing && (body.action !== 'approve' || record.processingActor !== actor.id || record.reviewNote !== note)) throw fail(409, '原核对操作尚未确认，请由原审核人按原意见重试，不能退回或更换内容。');
    if (body.action === 'approve') {
      if (body.physicalChecked !== true) throw fail(400, '请先核对实物、数量和完好情况。');
      if (!record.processing) {
        record = { ...record, processing: true, processingActor: actor.id, reviewNote: note };
        version = (await store.save(record, version)).version;
      }
      const key = `material-review:${hash(id)}`;
      const result = kind === 'return' ? await performApplication(context, record.applicationId, 'return', {
        assetCode: record.assetCode, quantity: record.quantity, lossQuantity: 0, idempotencyKey: key,
        note: `${record.code} · ${record.note}${note ? ` · 核对：${note}` : ''}`,
      }, null) : await transaction(actor, { assetCode: record.assetCode, operation: '入库', quantity: record.quantity,
        note: `${record.code} · ${record.source} · ${record.location} · ${record.note}${note ? ` · 核对：${note}` : ''}`, idempotencyKey: key });
      record = { ...record, flowId: result.flowId || result.result?._id || null };
    }
    record = { ...record, processing: false, status: body.action === 'approve' ? 'approved' : 'rejected', revision: record.revision + 1, reviewer: actor.id, reviewNote: note, reviewedAt: now() };
    await store.save(record, version);
    return { ok: true, record: publicRecord(record) };
  }
  async function assertActive(assetCode, operation) {
    if (!['入库', '出库'].includes(operation)) return;
    const states = await records('asset', false);
    if (states.entries.some(entry => `NJU-RC-${entry.document.inventoryId}` === assetCode && entry.document.availability === 'disabled')) throw fail(409, '该物资已停用，不能新增入库或出库；原借用单仍可归还。', 'material_disabled');
  }
  async function projectOverview(actor, snapshot) {
    manager(actor);
    const states = await records('asset', false), map = new Map(states.entries.map(entry => [entry.document.inventoryId, entry.document]));
    const project = item => {
      const state = map.get(item.id);
      return { ...item, availability: state?.availability || 'active', availabilityReason: state?.availabilityReason || '', availabilityHistory: state?.availabilityHistory || [],
        ...(state?.initialization ? { initialization: state.initialization, untrackedDifference: 0 } : {}) };
    };
    const inventory = snapshot.inventory.map(project);
    return { ...snapshot, inventory, lowStock: snapshot.lowStock.map(project), thresholdNotices: (snapshot.thresholdNotices || []).map(project),
      stats: { ...snapshot.stats, totalUntrackedDifference: inventory.reduce((sum, item) => sum + (item.untrackedDifference || 0), 0) },
      capabilities: { inventoryLifecycle: { mode: 'production', create: states.ready, availability: states.ready } } };
  }
  async function overview(actor) { manager(actor); return projectOverview(actor, await readOverview(await getClient())); }
  async function schema(actor) {
    manager(actor); const result = await getCore(actor).schema(), ready = (await store.inspect()).ready;
    return { ...result, capabilities: { stockMovements: { mode: 'production', remoteWrites: true }, inventoryLifecycle: { mode: 'production', create: ready, availability: ready } },
      registrationReady: ready, creation: { fields: { ...result.fields, initialQuantity: { editable: true, type: 'number', options: [] } },
        required: ['name', 'unit', 'center', 'cabinet', 'level', 'initialQuantity', 'threshold', 'thresholdEnabled'] } };
  }
  async function scan(actor, code) { manager(actor); const result = await getCore(actor).scan(code); return { ...result, item: (await projectOverview(actor, { inventory: [result.item], lowStock: [], stats: {} })).inventory[0] }; }
  async function transaction(actor, body) {
    manager(actor); fields(body, ['assetCode', 'operation', 'quantity', 'lossQuantity', 'note', 'destination', 'idempotencyKey']);
    const key = text(body.idempotencyKey, '操作标识', 128), fingerprint = hash([actor.id, body]);
    await beforeStockWrite(body.assetCode);
    const plan = await getCore(actor).planTransaction(body);
    if (plan.previous && (plan.previous['操作人'] !== (actor.realName || actor.id) || txt(plan.previous['流转去向']) !== txt(body.destination) || readAnnotation(plan.previous).note !== txt(body.note))) throw fail(409, '原流水的操作人或登记内容不一致，请人工核查。');
    if (!plan.previous) await assertActive(body.assetCode, body.operation);
    // Confirm the existing keyed flow even after an upstream acknowledgement loss.
    const result = await store.once(`flow:${key}`, fingerprint, async () => {
      if (plan.previous) return { ok: true, duplicate: true, flowId: plan.previous._id };
      const saved = await (await getClient()).appendRow(MATERIAL_TABLES.flows, plan.row);
      if (!saved?._id) throw fail(503, '流水保存结果待确认。');
      return { ok: true, flowId: saved._id, message: '库存流水已记录。' };
    }, async () => {
      const matches = (await rows(MATERIAL_TABLES.flows)).filter(row => row['幂等键'] === key);
      const expected = plan.previous || plan.row;
      if (matches.length !== 1 || !Object.entries(expected).every(([name, value]) => name.startsWith('_') || JSON.stringify(matches[0][name] ?? '') === JSON.stringify(value ?? ''))) return null;
      return { ok: true, duplicate: true, flowId: matches[0]._id, item: (await scan(actor, body.assetCode)).item, message: '库存流水已确认，没有重复登记。' };
    });
    return { ...result, item: (await scan(actor, body.assetCode)).item };
  }
  async function createInventory(actor, body) {
    manager(actor); fields(body, ['name', 'unit', 'center', 'cabinet', 'level', 'initialQuantity', 'threshold', 'thresholdEnabled', 'idempotencyKey']);
    const core = getCore(actor), configuration = await schema(actor);
    if (!configuration.registrationReady) throw fail(503, '请先完成物资登记表配置。', 'materials_schema_pending');
    const values = Object.fromEntries(['name', 'unit', 'center', 'cabinet', 'level'].map(key => {
      const field = configuration.fields[key], value = field?.type === 'number' ? integer(body[key], key) : text(body[key], key, 120);
      if (!field?.editable || field.type === 'single-select' && !field.options.includes(value)) throw fail(400, '请按物资字段配置填写名称、单位与位置。');
      return [key, value];
    }));
    const initial = integer(body.initialQuantity, '初始数量'), threshold = integer(body.threshold, '预警阈值');
    if (typeof body.thresholdEnabled !== 'boolean') throw fail(400, '请填写预警启用状态。');
    await core.validateInventoryFields({ ...values, threshold, thresholdEnabled: body.thresholdEnabled });
    const metadata = await (await getClient()).getMetadata();
    if (!['初始数量', '现有数量'].every(name => metadata.tables.find(t => t.name === MATERIAL_TABLES.inventory)?.columns.some(c => c.name === name && c.type === 'number'))) throw fail(503, '库存数量字段尚未配置完成。');
    if (metadata.tables.find(t => t.name === MATERIAL_TABLES.config)?.columns.find(c => c.name === '资产编码')?.type !== 'text') throw fail(503, '物资预警配置的资产编码字段尚未配置完成。');
    const key = text(body.idempotencyKey, '操作标识', 160), id = `create:${hash([actor.id, key])}`, fingerprint = hash({ ...values, initial, threshold, enabled: body.thresholdEnabled });
    let entry = await store.get(id);
    if (entry && entry.document.fingerprint !== fingerprint) throw fail(409, '同一操作标识不能用于不同新物资。');
    if (entry?.document.status === 'completed') return { ok: true, duplicate: true, item: (await scan(actor, `NJU-RC-${entry.document.inventoryId}`)).item };
    if (!entry) entry = await store.save({ id, kind: 'create', owner: actor.id, fingerprint, status: 'pending' });
    const row = { '物资名称': values.name, '单位': values.unit, '中心': values.center, '柜号': values.cabinet, '层数': values.level, '初始数量': initial, '现有数量': 0 };
    const created = await store.once(`asset:${id}`, fingerprint, async () => {
      const result = await (await getClient()).appendRow(MATERIAL_TABLES.inventory, row);
      if (!result?._id) throw fail(503, '新增物资保存结果待核对。');
      return { id: result._id };
    });
    await core.updateInventory(created.id, { threshold, thresholdEnabled: body.thresholdEnabled });
    const stateId = `asset:${hash(created.id)}`;
    if (!await store.get(stateId)) await store.save({ id: stateId, kind: 'asset', inventoryId: created.id, availability: 'active', initialization: 'inbound-ledger', availabilityHistory: [] });
    if (initial) await transaction(actor, { assetCode: `NJU-RC-${created.id}`, operation: '入库', quantity: initial, note: '新物资首次入库', destination: '新物资存放位置', idempotencyKey: `create-inbound:${hash(id)}` });
    if (entry.document.status !== 'completed') await store.save({ ...entry.document, status: 'completed', inventoryId: created.id }, entry.version);
    return { ok: true, duplicate: entry.document.status === 'completed', item: (await scan(actor, `NJU-RC-${created.id}`)).item, message: '物资资料与首次入库已保存。' };
  }
  async function changeAvailability(actor, inventoryId, body) {
    manager(actor); fields(body, ['availability', 'reason', 'idempotencyKey']);
    if (!['active', 'disabled'].includes(body.availability)) throw fail(400, '物资状态不正确。');
    const reason = text(body.reason, '变更原因', 2000), key = text(body.idempotencyKey, '操作标识', 160), id = `asset:${hash(inventoryId)}`;
    const entry = await store.get(id), state = entry?.document || { id, kind: 'asset', inventoryId, availabilityHistory: [] };
    const fingerprint = hash([actor.id, inventoryId, body.availability, reason]), last = state.availabilityHistory.find(event => event.key === key);
    if (last?.key === key) {
      if (last.fingerprint !== fingerprint) throw fail(409, '同一操作标识不能用于不同状态变更。');
      return { ok: true, duplicate: true, item: (await scan(actor, `NJU-RC-${inventoryId}`)).item };
    }
    const snapshot = await overview(actor), item = snapshot.inventory.find(item => item.id === inventoryId);
    if (!item) throw fail(404, '物资不存在。');
    if (item.availability === body.availability) throw fail(409, '物资已处于该状态，请刷新核对。');
    if (body.availability === 'disabled') await beforeStockWrite(item.code);
    if (body.availability === 'disabled' && (await rows(MATERIAL_TABLES.flows)).some(row => row['资产编码'] === item.code && /"state":"pending"/.test(row['异常说明'] || ''))) throw fail(409, '存在待同步流水，请先处理后再停用。');
    await store.save({ ...state, availability: body.availability, availabilityReason: reason,
      availabilityHistory: [...state.availabilityHistory, { key, fingerprint, date: now(), operator: actor.realName || actor.id, action: body.availability === 'disabled' ? 'disable' : 'restore', reason }] }, entry?.version || 0);
    return { ok: true, item: (await scan(actor, item.code)).item, message: '物资状态已保存，库存与历史记录保留。' };
  }
  async function filterAvailable(items) {
    const states = await records('asset', false);
    const disabled = new Set(states.entries.filter(e => e.document.availability === 'disabled').map(e => e.document.inventoryId));
    return items.filter(item => !disabled.has(item.id));
  }
  return { listLoans, submit, list, photo, review, overview, schema, scan, transaction, createInventory, changeAvailability, assertActive, filterAvailable,
    inbound: { list: actor => list(actor, true, 'inbound'), review: (actor, id, body, context) => review(actor, id, body, context, 'inbound') } };
}
