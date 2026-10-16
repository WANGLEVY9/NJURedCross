import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { assertCompleteRows } from '../events/safety.js';

export const MATERIAL_TABLES = { applications: '物资管理', inventory: '工位物资表', config: '物资配置表', flows: '物资流水表' };
const annotationTag = '\n[RC-MATERIALS-V1]';
const operations = ['入库', '出库', '归还', '盘点增加', '盘点减少', '报损'];
const stockOperations = ['入库', '出库', '盘点增加', '盘点减少', '报损'];
const safeNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = value => String(value ?? '').trim();
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const flagOff = value => value === false || /^(false|否|no|n|0|禁用|关闭)$/i.test(text(value));
const masked = value => text(value) ? `${text(value).slice(0, 1)}${'＊'.repeat(Math.min(3, Math.max(0, text(value).length - 1)))}` : '未填写';
const meta = rows => rows?.readMeta || { total: rows.length, truncated: false, maxRows: null };
function fail(status, message, code = 'material_validation_failed') { const error = new Error(message); error.statusCode = status; error.code = code; throw error; }
export function materialCode(row) { return `NJU-RC-${row._id}`; }
export function integer(value, label, { min = 0, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return 0;
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !/^\d+$/.test(value.trim()))) fail(400, `${label}必须是${min === 1 ? '正' : '非负'}整数`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) fail(400, `${label}必须是${min === 1 ? '正' : '非负'}整数`);
  return number;
}
export function operationDelta(operation, quantity) { return ['入库', '归还', '盘点增加'].includes(operation) ? quantity : ['出库', '报损', '盘点减少'].includes(operation) ? -quantity : 0; }
export function readAnnotation(flow) {
  const raw = String(flow['异常说明'] || '');
  const position = raw.lastIndexOf(annotationTag);
  if (position >= 0) {
    try { const value = JSON.parse(raw.slice(position + annotationTag.length)); if (value.v === 1) return { note: raw.slice(0, position), ...value }; } catch {}
  }
  // Old versions included SDK messages here. Keep credentials out of the UI.
  if (raw.startsWith('申请状态同步失败')) return { note: '历史申请状态同步失败，请人工核查原申请与流水。', legacyPending: true };
  return { note: raw, v: 1 };
}
function writeAnnotation(note, value) { return `${note}${annotationTag}${JSON.stringify({ ...value, v: 1 })}`; }
export function isSyncPending(flow) { const annotation = readAnnotation(flow); return annotation.legacyPending || annotation.sync?.state === 'pending'; }
function userNote(value, required = false) {
  const note = text(value);
  if ((required && !note) || note.length > 2000 || note.includes('[RC-MATERIALS-V1]')) fail(400, '备注应为 1 至 2000 个字符，且不能包含系统标记');
  return note;
}
function lateDays(value, currentDay) {
  if (!value) return 0;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 0;
  const due = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date)}T00:00:00+08:00`);
  return Math.max(0, Math.floor((new Date(`${currentDay}T00:00:00+08:00`) - due) / 86400000));
}

export function inventorySummaries(inventory, configs, flows, applications = []) {
  const configMap = new Map(configs.map(row => [text(row['资产编码']), row]));
  const applicationMap = new Map(applications.map(row => [row._id, row]));
  const statsMap = new Map();
  for (const flow of flows) {
    const code = text(flow['资产编码']);
    const quantity = safeNumber(flow['数量']);
    const operation = text(flow['操作类型']);
    const stats = statsMap.get(code) || { delta: 0, inbound: 0, outbound: 0, returned: 0, loss: 0, adjustment: 0, destinations: [] };
    stats.delta += operationDelta(operation, quantity);
    if (operation === '入库') stats.inbound += quantity;
    if (operation === '出库') stats.outbound += quantity;
    if (operation === '归还') { stats.returned += quantity; stats.loss += safeNumber(flow['损耗数量']); }
    if (operation === '报损') stats.loss += quantity;
    if (operation === '盘点增加') stats.adjustment += quantity;
    if (operation === '盘点减少') stats.adjustment -= quantity;
    const application = applicationMap.get(text(flow['申请单ID']));
    const destination = text(flow['流转去向']);
    if (operation === '出库' && (application || destination)) stats.destinations.push({ applicationId: application?._id || '', applicant: application ? masked(application['姓名']) : '', purpose: text(application?.['借用用途']), label: destination || `${masked(application?.['姓名'])} · ${text(application?.['借用用途'])}`, quantity, date: flow['操作时间'] || null });
    statsMap.set(code, stats);
  }
  return inventory.map(row => {
    const code = materialCode(row), config = configMap.get(code) || {};
    const flow = statsMap.get(code) || {};
    const initial = safeNumber(row['初始数量']), baselineQuantity = safeNumber(row['现有数量']);
    const quantity = baselineQuantity + safeNumber(flow.delta);
    const thresholdEnabled = !flagOff(config['阈值启用']);
    const fallback = initial > 0 ? Math.min(initial, Math.max(1, Math.ceil(initial * 0.2))) : 0;
    const configured = config['预警阈值'];
    const threshold = thresholdEnabled ? (configured !== null && configured !== undefined && configured !== '' && Number.isFinite(Number(configured)) && Number(configured) >= 0 ? Number(configured) : fallback) : null;
    const thresholdStatus = threshold !== null && quantity <= threshold ? (quantity < initial ? 'critical' : 'notice') : null;
    const baselineBorrowed = safeNumber(row['借出数量']), baselineReturned = safeNumber(row['归还数量']);
    const baselineOutstanding = Math.max(0, baselineBorrowed - baselineReturned);
    return { id: row._id, code, name: text(row['物资名称']) || '未命名物资', center: text(row['中心']) || '未分类', unit: text(row['单位']) || '件', cabinet: text(row['柜号']) || '未标注', level: text(row['层数']) || '未标注', initial, baselineQuantity, quantity, difference: initial - quantity, baselineDifference: initial - baselineQuantity, baselineBorrowed, baselineReturned, baselineOutstanding,
      untrackedDifference: Math.max(0, Math.abs(initial - baselineQuantity) - baselineOutstanding), threshold, thresholdEnabled,
      outbound: safeNumber(flow.outbound), returned: safeNumber(flow.returned), inbound: safeNumber(flow.inbound), loss: safeNumber(flow.loss), adjustment: safeNumber(flow.adjustment), destinations: flow.destinations || [], sourceStatuses: Array.isArray(row['物资管理']) ? row['物资管理'].map(String) : [], lowStock: thresholdStatus === 'critical', thresholdStatus };
  });
}

export function applicationProgress(application, flows) {
  const related = flows.filter(row => text(row['申请单ID']) === application._id && ['出库', '归还'].includes(text(row['操作类型'])));
  const checkouts = related.filter(row => row['操作类型'] === '出库');
  const checkout = checkouts.length === 1 ? checkouts[0] : null;
  const assetCode = checkout ? text(checkout['资产编码']) : '';
  const returns = related.filter(row => row['操作类型'] === '归还');
  const returnedQuantity = returns.reduce((sum, row) => sum + safeNumber(row['数量']), 0);
  const lossQuantity = returns.reduce((sum, row) => sum + safeNumber(row['损耗数量']), 0);
  const checkoutQuantity = checkout ? safeNumber(checkout['数量']) : 0;
  const invalid = !checkout || !assetCode || !Number.isSafeInteger(checkoutQuantity) || checkoutQuantity <= 0 || returns.some(row => text(row['资产编码']) !== assetCode || !Number.isSafeInteger(safeNumber(row['数量'])) || safeNumber(row['数量']) < 0 || !Number.isSafeInteger(safeNumber(row['损耗数量'])) || safeNumber(row['损耗数量']) < 0) || returnedQuantity + lossQuantity > checkoutQuantity || safeNumber(application['归还件数']) > returnedQuantity;
  const hasHistory = related.length > 0 || text(application['状态']).includes('借出') || Boolean(application['实际借用日期']);
  return { assetCode, checkoutQuantity, returnedQuantity, lossQuantity, outstandingQuantity: checkout ? Math.max(0, checkoutQuantity - returnedQuantity - lossQuantity) : null,
    returnProgress: invalid ? (hasHistory ? 'unverified' : 'not-borrowed') : returnedQuantity + lossQuantity >= checkoutQuantity ? 'completed' : returnedQuantity + lossQuantity > 0 ? 'partial' : 'not-returned', syncPending: related.some(isSyncPending), verified: !invalid, hasHistory };
}
export function applicationSummary(row, flows = [], currentDay = day(), { revealApplicantNames = false } = {}) {
  const progress = applicationProgress(row, flows);
  const returned = progress.verified ? progress.outstandingQuantity === 0 : Boolean(row['实际归还日期']) || text(row['归还状态']).includes('已全部归还') || text(row['状态']).includes('已归还');
  const status = text(row['状态']), approval = text(row['借出审批']);
  const borrowed = status.includes('借出') || Boolean(row['实际借用日期']) || flows.some(flow => text(flow['申请单ID']) === row._id && text(flow['操作类型']) === '出库');
  const awaitingOrRejected = status.includes('待审批') || status.includes('待审核') || approval === '待审核' || /不通过|拒绝/.test(`${status} ${approval}`);
  return { id: row._id, code: `REQ-${row._id}`, approvalMode: row['审批方式'] === '自动通过' ? 'automatic' : 'manual', requestedAssetCode: text(row['申请资产编码']), materialId: text(row['申请物资ID']), applicant: revealApplicantNames === true ? text(row['姓名']) || '未填写' : masked(row['姓名']), purpose: text(row['借用用途']) || '未填写', items: text(row['借用物资名及数量'] || row['借用物资类型']) || '未填写', quantity: safeNumber(row['借用件数']), status: status || '未填写', approval: approval || '待审核', returnStatus: text(row['归还状态']), plannedBorrowDate: row['拟借用日期'] || null, plannedReturnDate: row['拟归还日期'] || null, actualBorrowDate: row['实际借用日期'] || null, actualReturnDate: row['实际归还日期'] || null, returned, overdueDays: !returned && borrowed && !awaitingOrRejected ? lateDays(row['拟归还日期'], currentDay) : 0, ...progress };
}
export function flowSummary(row, applications = []) {
  const annotation = readAnnotation(row);
  const application = applications.find(item => item._id === text(row['申请单ID']));
  return { id: row._id, applicationId: text(row['申请单ID']), operation: text(row['操作类型']) || '未标注', material: text(row['物资名称']) || '未标注', assetCode: text(row['资产编码']), quantity: safeNumber(row['数量']), loss: safeNumber(row['损耗数量']), before: safeNumber(row['操作前数量']), after: safeNumber(row['操作后数量']), operator: text(row['操作人']) || '未标注', date: row['操作时间'] || null, note: annotation.note, destination: text(row['流转去向']) || (application ? `${masked(application['姓名'])} · ${text(application['借用用途'])}` : ''), syncPending: Boolean(annotation.legacyPending || annotation.sync?.state === 'pending'), resolution: annotation.resolution || null };
}

/** These locks protect one Node process. Multi-instance deployments need a shared transaction store. */
export function createMaterialsService({ client, listRows, uploadPhoto = async () => null, actor = '管理员', today = day, locks = new Map(), revealApplicantNames = false }) {
  // Only authenticated materials-management callers opt into full applicant names.
  const summarizeApplication = (row, flows = [], currentDay = today()) => applicationSummary(row, flows, currentDay, { revealApplicantNames });
  const list = async table => { try { return await listRows(table); } catch { fail(502, '数据服务读取失败，请稍后重试。', 'material_storage_failed'); } };
  const append = async (table, row) => {
    let result;
    try { result = await client.appendRow(table, row); } catch { fail(502, '数据服务写入失败，请稍后重试。', 'material_storage_failed'); }
    if (!result?._id) fail(502, '数据服务未确认记录结果，请核查后重试。', 'material_storage_failed');
    return result;
  };
  const update = async (table, id, patch) => {
    let result;
    try { result = await client.updateRow(table, id, patch); } catch { fail(502, '数据服务更新失败，请稍后重试。', 'material_storage_failed'); }
    if (result?.success === false || result?.updated_row_count === 0) fail(502, '数据服务未确认更新结果，请核查后重试。', 'material_storage_failed');
    // SDK response shapes differ. Read back before acknowledging success or marking a flow synchronized.
    const rows = await list(table); assertCompleteRows(rows);
    const persisted = rows.find(row => row._id === id);
    const confirmed = persisted && Object.entries(patch).every(([key, value]) => ['实际借用日期', '实际归还日期'].includes(key) && /^\d{4}-\d{2}-\d{2}$/.test(value) ? text(persisted[key]).slice(0, 10) === value : isDeepStrictEqual(persisted[key], value));
    if (!confirmed) fail(502, '数据服务更新结果尚未确认，请刷新核查后重试。', 'material_storage_failed');
    return result;
  };
  async function withLocks(keys, task) {
    const ordered = [...new Set(keys.filter(Boolean))].sort();
    async function acquire(index) {
      if (index === ordered.length) return task();
      const key = ordered[index], previous = locks.get(key) || Promise.resolve();
      let release; const current = new Promise(resolve => { release = resolve; }); locks.set(key, current);
      await previous;
      try { return await acquire(index + 1); } finally { release(); if (locks.get(key) === current) locks.delete(key); }
    }
    return acquire(0);
  }
  async function bundle(includeApplications = true) {
    const [inventory, configs, flows, applications] = await Promise.all([list(MATERIAL_TABLES.inventory), list(MATERIAL_TABLES.config), list(MATERIAL_TABLES.flows), includeApplications ? list(MATERIAL_TABLES.applications) : []]);
    assertCompleteRows(inventory, configs, flows, applications);
    const summaries = inventorySummaries(inventory, configs, flows, applications);
    return { inventory, configs, flows, applications, summaries, summaryByCode: new Map(summaries.map(item => [item.code, item])) };
  }
  function actorName() { return typeof actor === 'function' ? actor() : actor; }
  function target(data, id) { const application = data.applications.find(row => row._id === id); if (!application) fail(404, '申请单不存在'); return application; }
  function asset(data, code) { const item = data.summaryByCode.get(code); if (!item) fail(404, '物资资产编码不存在'); return item; }
  function pendingGuard(data, applicationId, assetCode) { if (data.flows.some(row => isSyncPending(row) && ((applicationId && text(row['申请单ID']) === applicationId) || (assetCode && text(row['资产编码']) === assetCode)))) fail(409, '存在待同步流水，请先在流水记录中重试同步；历史异常需人工核查。', 'material_sync_pending'); }
  function transactionRow(body, item, operation, applicationId = '') {
    if (!operations.includes(operation)) fail(400, '不支持该物资操作');
    const quantity = integer(body.quantity, '数量', { min: operation === '归还' ? 0 : 1 });
    const loss = integer(body.lossQuantity, '损耗数量', { optional: true });
    if (operation !== '归还' && loss !== 0) fail(400, '只有归还操作可以登记借出物资损耗');
    if (operation === '归还' && quantity + loss === 0) fail(400, '实物归还与损耗数量不能同时为零');
    const after = item.quantity + operationDelta(operation, quantity);
    if (!Number.isSafeInteger(item.quantity) || after < 0 || !Number.isSafeInteger(after)) fail(409, `库存数量无效或不足，当前可用 ${item.quantity} ${item.unit}`);
    const key = text(body.idempotencyKey) || randomBytes(16).toString('hex');
    if (key.length > 160) fail(400, '操作标识过长');
    return { '流水编号': `TX-${randomBytes(7).toString('hex').toUpperCase()}`, '申请单ID': applicationId, '资产编码': item.code, '物资名称': item.name, '操作类型': operation, '数量': quantity, '操作前数量': item.quantity, '操作后数量': after, '操作人': actorName(), '操作时间': today(), '异常说明': userNote(body.note), '流转去向': text(body.destination), '损耗数量': loss, '幂等键': key };
  }
  function duplicate(data, key, body, operation, applicationId = '') {
    if (!key) return null;
    const rows = data.flows.filter(row => text(row['幂等键']) === key);
    if (!rows.length) return null;
    if (rows.length !== 1) fail(409, '操作标识对应多条流水，请人工核查');
    const row = rows[0];
    if (text(row['资产编码']) !== text(body.assetCode) || text(row['申请单ID']) !== applicationId || text(row['操作类型']) !== operation || safeNumber(row['数量']) !== integer(body.quantity, '数量') || safeNumber(row['损耗数量']) !== integer(body.lossQuantity, '损耗数量', { optional: true })) fail(409, '同一操作标识不能用于不同的物资或数量', 'material_idempotency_conflict');
    return row;
  }
  async function synchronize(originalFlow, data) {
    return withLocks([`flow:${originalFlow._id}`], async () => {
    const rows = await list(MATERIAL_TABLES.flows); assertCompleteRows(rows);
    const flow = rows.find(row => row._id === originalFlow._id); if (!flow) fail(404, '流水不存在');
    const position = data.flows.findIndex(row => row._id === flow._id); if (position >= 0) data.flows[position] = flow;
    const annotation = readAnnotation(flow), sync = annotation.sync;
    if (annotation.legacyPending || !sync || sync.applicationId !== text(flow['申请单ID']) || sync.assetCode !== text(flow['资产编码']) || sync.operation !== text(flow['操作类型']) || !sync.patch || typeof sync.patch !== 'object') fail(409, '该流水缺少可验证的同步记录，请人工核查申请单和原出库记录。', 'material_history_unverified');
    const application = target(data, sync.applicationId);
    // A durable exact patch makes a retry safe even if the application update succeeded but acknowledgement failed.
    if (sync.state !== 'synced') {
      await update(MATERIAL_TABLES.applications, application._id, sync.patch);
      const next = { ...annotation, sync: { ...sync, state: 'synced' } }; delete next.note;
      await update(MATERIAL_TABLES.flows, flow._id, { '异常说明': writeAnnotation(annotation.note, next) });
      flow['异常说明'] = writeAnnotation(annotation.note, next); Object.assign(application, sync.patch);
    }
    return { ok: true, flow: flowSummary(flow, data.applications), application: summarizeApplication(application, data.flows), message: '申请状态已同步，库存未重复变更。' };
    });
  }
  async function overview() {
    const data = await bundle(), currentDay = today(), applications = data.applications.map(row => summarizeApplication(row, data.flows, currentDay)), inventory = data.summaries;
    const pending = applications.filter(item => item.status.includes('待审批') || item.approval === '待审核');
    const overdue = applications.filter(item => item.overdueDays > 0 && !item.returned);
    const abnormalReturns = applications.filter(item => item.lossQuantity > 0 || item.returnStatus.includes('物品缺失') || item.syncPending);
    const lowStock = inventory.filter(item => item.lowStock), thresholdNotices = inventory.filter(item => item.thresholdStatus === 'notice');
    const currentDate = new Date(`${currentDay}T00:00:00+08:00`);
    const labels = Array.from({ length: 14 }, (_, index) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(currentDate.getTime() - (13 - index) * 86400000)));
    const inbound = labels.map(() => 0), outbound = labels.map(() => 0);
    for (const row of data.flows) { const index = labels.indexOf(text(row['操作时间']).slice(0, 10)); if (index < 0) continue; const delta = operationDelta(text(row['操作类型']), safeNumber(row['数量'])); if (delta > 0) inbound[index] += delta; else outbound[index] -= delta; }
    return { ok: true, policy: { thresholdRule: '优先采用配置表阈值；未配置时采用初始数量的 20%（至少 1）', source: '物资配置表 + 物资流水表' }, reads: { applications: meta(data.applications), inventory: meta(data.inventory), config: meta(data.configs), flows: meta(data.flows) }, stats: { categoryCount: inventory.length, totalInventoryItems: inventory.length, totalInitialQuantity: inventory.reduce((sum, item) => sum + item.initial, 0), totalCurrentQuantity: inventory.reduce((sum, item) => sum + item.quantity, 0), totalDifference: inventory.reduce((sum, item) => sum + item.difference, 0), totalUntrackedDifference: inventory.reduce((sum, item) => sum + item.untrackedDifference, 0), totalLossQuantity: inventory.reduce((sum, item) => sum + item.loss, 0), lowStockCount: lowStock.length, thresholdNoticeCount: thresholdNotices.length, pendingCount: pending.length, borrowedCount: applications.filter(item => !item.returned && item.status.includes('借出')).length, overdueCount: overdue.length, abnormalReturnCount: abnormalReturns.length, flowCount: data.flows.length }, series: { labels, inbound, outbound }, inventory, applications: applications.sort((a, b) => b.overdueDays - a.overdueDays), pending, overdue, abnormalReturns, lowStock, thresholdNotices, recentFlows: sortedFlows(data.flows).slice(0, 8).map(row => flowSummary(row, data.applications)) };
  }
  async function scan(code) { if (!/^NJU-RC-[A-Za-z0-9_-]+$/.test(code)) fail(400, '无法识别物资二维码'); const data = await bundle(false); return { ok: true, item: asset(data, code) }; }
  function sortedFlows(rows) { return rows.slice().sort((a, b) => text(b['操作时间'] || b._mtime).localeCompare(text(a['操作时间'] || a._mtime)) || text(b._ctime || b._id).localeCompare(text(a._ctime || a._id))); }
  async function listFlows(params = {}) {
    const get = key => text(typeof params.get === 'function' ? params.get(key) : params[key]);
    const page = get('page') ? integer(get('page'), '页码', { min: 1 }) : 1;
    const pageSize = get('pageSize') ? integer(get('pageSize'), '每页数量', { min: 1 }) : 20;
    if (pageSize > 200) fail(400, '每页数量不能超过 200');
    for (const key of ['from', 'to']) if (get(key) && (!/^\d{4}-\d{2}-\d{2}$/.test(get(key)) || Number.isNaN(Date.parse(get(key))))) fail(400, '日期筛选应为 YYYY-MM-DD');
    if (get('from') && get('to') && get('from') > get('to')) fail(400, '开始日期不能晚于结束日期');
    const [flows, applications] = await Promise.all([list(MATERIAL_TABLES.flows), list(MATERIAL_TABLES.applications)]); assertCompleteRows(flows, applications);
    const projected = sortedFlows(flows).map(row => flowSummary(row, applications)).filter(item => {
      if (get('assetCode') && item.assetCode !== get('assetCode')) return false;
      if (get('operation') && item.operation !== get('operation')) return false;
      if (get('operator') && !item.operator.toLowerCase().includes(get('operator').toLowerCase())) return false;
      if (get('from') && text(item.date).slice(0, 10) < get('from')) return false;
      if (get('to') && text(item.date).slice(0, 10) > get('to')) return false;
      if (['1', 'true'].includes(get('errorOnly')) && !(item.loss > 0 || item.operation === '报损' || item.syncPending)) return false;
      return !get('q') || [item.material, item.assetCode, item.applicationId, item.operator, item.note, item.destination, item.resolution?.note].some(value => text(value).toLowerCase().includes(get('q').toLowerCase()));
    });
    return { ok: true, flows: projected.slice((page - 1) * pageSize, page * pageSize), total: projected.length, page, pageSize, totalPages: Math.ceil(projected.length / pageSize), reads: { flows: meta(flows), applications: meta(applications) } };
  }
  async function reviewApplication(id, approved, body = {}) {
    return withLocks([`application:${id}`], async () => {
      const rows = await list(MATERIAL_TABLES.applications); assertCompleteRows(rows);
      const row = rows.find(item => item._id === id); if (!row) fail(404, '申请单不存在');
      if (!text(row['状态']).includes('待审批')) fail(409, '只能审批待审批的申请单');
      const patch = approved ? { '借出审批': '审批通过', '状态': '开始' } : { '借出审批': '审批不通过', '状态': '审批不通过', '不通过理由': userNote(body.reason, true) };
      const result = await update(MATERIAL_TABLES.applications, id, patch);
      return { ok: true, result, application: summarizeApplication({ ...row, ...patch }), message: approved ? '申请已通过审批。' : '申请已拒绝。' };
    });
  }
  async function applicationAction(id, action, body, photo) {
    const operation = action === 'checkout' ? '出库' : action === 'return' ? '归还' : ''; if (!operation) fail(400, '不支持该申请操作');
    const code = text(body.assetCode), key = text(body.idempotencyKey);
    return withLocks([`application:${id}`, `asset:${code}`, key && `key:${key}`], async () => {
      const data = await bundle(), application = target(data, id), item = asset(data, code);
      const previous = duplicate(data, key, body, operation, id);
      if (previous) {
        if (isSyncPending(previous)) { const recovered = await synchronize(previous, data); return { ...recovered, duplicate: true, item: asset(data, code) }; }
        return { ok: true, duplicate: true, flowId: previous._id, item, application: summarizeApplication(application, data.flows), message: '操作已记录，没有重复变更库存。' };
      }
      pendingGuard(data, id, code);
      const progress = applicationProgress(application, data.flows);
      if (operation === '出库') {
        if (text(application['申请资产编码']) && text(application['申请资产编码']) !== code) fail(409, '出库物资必须与申请选择的类别码一致');
        if (text(application['申请资产编码']) && integer(body.quantity, '数量', { min: 1 }) !== safeNumber(application['借用件数'])) fail(409, '出库数量须与申请件数一致');
        if (text(application['借出审批']) !== '审批通过') fail(409, '申请单须先通过审批');
        if (progress.hasHistory || text(application['状态']).includes('已归还')) fail(409, '申请单已有出库或历史借还记录，不能重复出库');
        if (!photo) fail(400, '出库时需要上传照片');
      } else {
        if (!progress.verified) fail(409, '缺少可验证的单资产出库记录，或历史归还件数与流水不一致，请人工核查后处理。', 'material_history_unverified');
        if (progress.assetCode !== code) fail(409, '归还物资必须与原出库资产一致');
        if (progress.outstandingQuantity === 0) fail(409, '申请单已结清，不能再次归还');
        if (!text(application['状态']).includes('借出')) fail(409, '只有已借出的申请单可以归还');
      }
      const destination = text(body.destination) || `${masked(application['姓名'])} · ${text(application['借用用途']) || '未填写'}`;
      const row = transactionRow({ ...body, destination }, item, operation, id);
      if (operation === '归还' && row['数量'] + row['损耗数量'] > progress.outstandingQuantity) fail(409, `实物归还与损耗总数不能超过待还数量 ${progress.outstandingQuantity}`);
      let photoPath;
      try { photoPath = photo ? await uploadPhoto(photo) : null; } catch { fail(502, '照片上传失败，未写入物资流水，请稍后重试。'); }
      if (operation === '出库' && !photoPath) fail(502, '照片上传未确认成功，未写入物资流水。');
      const patch = operation === '出库' ? { '状态': '借出（物资）', '实际借用日期': today() } : (() => {
        const returned = progress.returnedQuantity + row['数量'], loss = progress.lossQuantity + row['损耗数量'];
        const full = returned + loss === progress.checkoutQuantity;
        return { '归还件数': returned, ...(full || loss > 0 ? { '归还状态': loss > 0 ? '物品缺失/数量减少' : '已全部归还' } : {}), ...(full ? { '实际归还日期': today(), '状态': '已归还' } : {}) };
      })();
      if (photoPath) { const field = operation === '出库' ? '物资出库照片' : '物资归还照片'; patch[field] = [...(Array.isArray(application[field]) ? application[field] : []), photoPath]; }
      row['异常说明'] = writeAnnotation(row['异常说明'], { sync: { state: 'pending', applicationId: id, assetCode: code, operation, patch } });
      const result = await append(MATERIAL_TABLES.flows, row), flow = { ...row, ...result };
      data.flows.push(flow);
      const updatedItem = inventorySummaries(data.inventory, data.configs, data.flows, data.applications).find(value => value.code === code);
      try {
        const recovered = await synchronize(flow, data);
        return { ...recovered, result: { _id: flow._id }, item: updatedItem, flowId: flow._id, message: operation === '出库' ? '出库已记录。' : '归还已记录。' };
      } catch {
        return { ok: true, syncPending: true, flowId: flow._id, item: updatedItem, application: summarizeApplication(application, data.flows), message: '流水已记录，申请状态待同步，请在流水记录中重试同步。' };
      }
    });
  }
  async function transaction(body) {
    const code = text(body.assetCode), key = text(body.idempotencyKey), operation = text(body.operation);
    if (!stockOperations.includes(operation) || text(body.applicationId)) fail(400, '申请借出与归还须通过申请单操作；库存登记支持入库、独立出库、盘点增减和报损');
    if (operation === '出库' && (!text(body.destination) || text(body.destination).length > 2000 || text(body.destination).includes('[RC-MATERIALS-V1]'))) fail(400, '独立出库须填写 1 至 2000 个字符的领用或消耗去向');
    return withLocks([`asset:${code}`, key && `key:${key}`], async () => {
      const data = await bundle(), item = asset(data, code), previous = duplicate(data, key, body, operation);
      if (previous) return { ok: true, duplicate: true, item, flowId: previous._id, message: '操作已记录，没有重复变更库存。' };
      pendingGuard(data, '', code);
      const row = transactionRow(body, item, operation);
      if (['报损', '盘点减少', '盘点增加'].includes(operation)) row['异常说明'] = userNote(body.note, true);
      const result = await append(MATERIAL_TABLES.flows, row);
      return { ok: true, result: { _id: result._id }, flowId: result._id, item: { ...item, quantity: row['操作后数量'] }, message: '库存流水已记录。' };
    });
  }
  async function retrySync(id) {
    const rows = await list(MATERIAL_TABLES.flows); assertCompleteRows(rows);
    const row = rows.find(item => item._id === id); if (!row) fail(404, '流水不存在');
    return withLocks([`application:${text(row['申请单ID'])}`, `asset:${text(row['资产编码'])}`], async () => {
      const data = await bundle(), flow = data.flows.find(item => item._id === id);
      if (!flow) fail(404, '流水不存在'); return synchronize(flow, data);
    });
  }
  async function reviewFlow(id, body) {
    return withLocks([`flow:${id}`], async () => {
      const flows = await list(MATERIAL_TABLES.flows); assertCompleteRows(flows);
      const row = flows.find(item => item._id === id); if (!row) fail(404, '流水不存在');
      const annotation = readAnnotation(row), note = userNote(body.note, true);
      const next = { ...annotation, resolution: { note, operator: actorName(), date: today() } }; delete next.note;
      const patch = { '异常说明': writeAnnotation(annotation.note, next) };
      await update(MATERIAL_TABLES.flows, id, patch);
      return { ok: true, flow: flowSummary({ ...row, ...patch }), message: '核查记录已保存，借还数量和结清状态未变更。' };
    });
  }
  const fieldDefinitions = { name: ['inventory', '物资名称'], unit: ['inventory', '单位'], center: ['inventory', '中心'], cabinet: ['inventory', '柜号'], level: ['inventory', '层数'], threshold: ['config', '预警阈值'], thresholdEnabled: ['config', '阈值启用'] };
  async function getMetadata() {
    try { return await client.getMetadata(); } catch { fail(502, '无法读取物资字段配置，请稍后重试。', 'material_storage_failed'); }
  }
  async function getFields() {
    const metadata = await getMetadata();
    const fields = {};
    for (const [key, [table, name]] of Object.entries(fieldDefinitions)) {
      const column = metadata?.tables?.find(item => item.name === MATERIAL_TABLES[table])?.columns?.find(item => item.name === name);
      const type = column?.type || null, options = (column?.data?.options || []).map(item => text(item.name)).filter(Boolean);
      const supported = key === 'threshold' ? type === 'number' : key === 'thresholdEnabled' ? ['checkbox', 'single-select', 'text'].includes(type) : ['text', 'long-text', 'single-select', 'number'].includes(type);
      fields[key] = { editable: Boolean(column && supported && (type !== 'single-select' || options.length)), type, options };
    }
    return fields;
  }
  async function schema() { return { ok: true, fields: await getFields(), baselineEditable: false }; }
  function columnValue(key, value, field) {
    if (!field.editable) fail(409, `字段 ${key} 尚未配置为可编辑，请核查物资表字段。`);
    if (key === 'threshold') return integer(value, '预警阈值');
    if (key === 'thresholdEnabled') {
      if (typeof value !== 'boolean') fail(400, '预警启用状态必须为布尔值');
      if (field.type === 'checkbox') return value;
      if (field.type === 'text') return value ? '开启' : '关闭';
      const candidate = field.options.find(option => value ? /^(true|是|yes|y|1|开启|启用)$/i.test(option) : flagOff(option));
      if (!candidate) fail(409, '预警启用字段缺少对应选项，请管理员核查配置');
      return candidate;
    }
    const result = text(value); if (!result || result.length > 120) fail(400, '物资资料字段应为 1 至 120 个字符');
    if (field.type === 'single-select' && !field.options.includes(result)) fail(400, `字段 ${key} 必须选择已配置选项`);
    if (field.type === 'number') return integer(value, '位置字段');
    return result;
  }
  async function updateInventory(id, body) {
    const allowed = Object.keys(fieldDefinitions);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key)) || !Object.keys(body).length) fail(400, '仅允许修改名称、单位、位置和预警设置；库存数量须登记流水。');
    return withLocks([`asset:NJU-RC-${id}`], async () => {
      const [data, fields] = await Promise.all([bundle(false), getFields()]);
      const row = data.inventory.find(item => item._id === id); if (!row) fail(404, '物资不存在');
      const config = data.configs.find(item => text(item['资产编码']) === materialCode(row));
      const inventoryPatch = {}, configPatch = {};
      for (const [key, value] of Object.entries(body)) { const [table, column] = fieldDefinitions[key]; (table === 'inventory' ? inventoryPatch : configPatch)[column] = columnValue(key, value, fields[key]); }
      if (Object.keys(configPatch).length && !config) {
        // Only append when the linking column is explicitly writable; do not mutate schema or guess select values.
        const metadata = await getMetadata();
        const codeColumn = metadata?.tables?.find(item => item.name === MATERIAL_TABLES.config)?.columns?.find(item => item.name === '资产编码');
        if (codeColumn?.type !== 'text') fail(409, '物资配置表的资产编码字段未配置为文本，无法安全创建预警配置');
      }
      if (Object.keys(inventoryPatch).length) await update(MATERIAL_TABLES.inventory, id, inventoryPatch);
      try {
        if (Object.keys(configPatch).length) {
          if (config) await update(MATERIAL_TABLES.config, config._id, configPatch);
          else await append(MATERIAL_TABLES.config, { '资产编码': materialCode(row), ...configPatch });
        }
      } catch {
        fail(502, Object.keys(inventoryPatch).length ? '物资基本资料已保存，但预警设置未确认成功；请刷新核对后重新保存预警设置。' : '预警设置未确认成功，请刷新核对后重试。', 'material_metadata_partial');
      }
      const refreshed = await bundle(false);
      return { ok: true, item: asset(refreshed, materialCode(row)), message: '物资资料已保存。' };
    });
  }
  return { overview, scan, schema, updateInventory, listFlows, reviewApplication, applicationAction, transaction, retrySync, reviewFlow };
}
