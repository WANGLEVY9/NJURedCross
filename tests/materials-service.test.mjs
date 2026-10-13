import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterialsService, MATERIAL_TABLES, readAnnotation, applicationProgress, applicationSummary, flowSummary } from '../lib/materials/service.js';

const photo = { name: 'checkout.jpg' };
function fixture() {
  const tables = {
    [MATERIAL_TABLES.inventory]: [{ _id: 'a', '物资名称': '急救箱', '单位': '件', '中心': '苏州', '柜号': '1', '层数': '2', '初始数量': 12, '现有数量': 12 }, { _id: 'b', '物资名称': '血压计', '单位': '台', '中心': '苏州', '柜号': '1', '层数': '3', '初始数量': 8, '现有数量': 8 }],
    [MATERIAL_TABLES.applications]: [{ _id: 'app', '姓名': '测试同学', '借用用途': '活动', '借用件数': 5, '借用物资名及数量': '急救箱5件', '借出审批': '审批通过', '状态': '开始', '拟归还日期': '2099-01-01' }],
    [MATERIAL_TABLES.config]: [{ _id: 'config-a', '资产编码': 'NJU-RC-a', '预警阈值': 2, '阈值启用': true }],
    [MATERIAL_TABLES.flows]: [],
  };
  const columns = {
    inventory: [{ name: '物资名称', type: 'text' }, { name: '单位', type: 'single-select', data: { options: [{ name: '件' }, { name: '台' }] } }, { name: '中心', type: 'single-select', data: { options: [{ name: '苏州' }, { name: '仙林' }] } }, { name: '柜号', type: 'number' }, { name: '层数', type: 'number' }],
    config: [{ name: '资产编码', type: 'text' }, { name: '预警阈值', type: 'number' }, { name: '阈值启用', type: 'checkbox' }],
  };
  let sequence = 0, uploads = 0;
  const writes = [];
  const failures = new Map();
  const client = {
    async getMetadata() { return { tables: Object.entries(columns).map(([key, fields]) => ({ name: MATERIAL_TABLES[key], columns: structuredClone(fields) })) }; },
    async appendRow(table, row) { if (failures.get(`append:${table}`)) { failures.delete(`append:${table}`); throw new Error('secret-token upstream'); } const result = { ...structuredClone(row), _id: `flow-${++sequence}` }; tables[table].push(result); writes.push({ type: 'append', table, id: result._id, row: structuredClone(row) }); return structuredClone(result); },
    async updateRow(table, id, patch) { const key = `${table}:${id}`; const failure = failures.get(key); if (failure === 'before') { failures.delete(key); throw new Error('secret-token upstream'); } const row = tables[table].find(item => item._id === id); if (!row) throw new Error('not-found'); Object.assign(row, structuredClone(patch)); writes.push({ type: 'update', table, id, patch: structuredClone(patch) }); if (failure === 'after') { failures.delete(key); throw new Error('secret-token acknowledgement'); } return structuredClone(row); },
  };
  const options = { client, listRows: async table => { const rows = structuredClone(tables[table]); Object.defineProperty(rows, 'readMeta', { value: { total: rows.length, truncated: false } }); return rows; }, uploadPhoto: async () => { uploads += 1; return '/mock/photos/checkout.jpg'; }, actor: '测试管理员', today: () => '2026-10-04', locks: new Map() };
  const createService = overrides => createMaterialsService({ ...options, ...overrides });
  const service = createService();
  const checkoutBody = { assetCode: 'NJU-RC-a', quantity: 5, idempotencyKey: 'checkout', note: '已点清数量' };
  const checkout = () => service.applicationAction('app', 'checkout', checkoutBody, photo);
  const returnBody = (quantity, lossQuantity = 0, idempotencyKey = 'return') => ({ assetCode: 'NJU-RC-a', quantity, lossQuantity, idempotencyKey });
  return { tables, columns, client, service, createService, writes, failures, checkoutBody, checkout, returnBody, locks: options.locks, uploads: () => uploads };
}

test('管理端显式启用实名，默认摘要仍遮盖姓名且不增加个人字段', async () => {
  const f = fixture();
  Object.assign(f.tables[MATERIAL_TABLES.applications][0], { 邮箱: 'synthetic@example.test', 学号: 'TEST-STUDENT' });
  const masked = (await f.service.overview()).applications[0];
  assert.equal(masked.applicant, '测＊＊＊');
  const admin = f.createService({ revealApplicantNames: true });
  const full = (await admin.overview()).applications[0];
  assert.equal(full.applicant, '测试同学');
  assert.deepEqual(Object.keys(full), Object.keys(masked));
  assert.equal('email' in full, false);
  assert.equal('studentId' in full, false);
  assert.equal(f.writes.length, 0);
  const checkedOut = await admin.applicationAction('app', 'checkout', f.checkoutBody, photo);
  assert.equal(checkedOut.application.applicant, '测试同学');
  const repeated = await admin.applicationAction('app', 'checkout', f.checkoutBody, photo);
  assert.equal(repeated.application.applicant, '测试同学');
  assert.equal(repeated.duplicate, true);
  assert.equal(applicationSummary(f.tables[MATERIAL_TABLES.applications][0]).applicant, '测＊＊＊');
});

test('总览与扫码统一从基线叠加流水，数量整数校验不做四舍五入', async () => {
  const f = fixture(); await f.checkout();
  assert.equal((await f.service.scan('NJU-RC-a')).item.quantity, 7);
  assert.equal((await f.service.overview()).inventory.find(item => item.id === 'a').quantity, 7);
  for (const quantity of [1.7, '1.7', true, '', '1e2', null, -1, 9007199254740992]) {
    await assert.rejects(f.service.transaction({ assetCode: 'NJU-RC-a', operation: '入库', quantity }), /整数/);
  }
  assert.equal(f.tables[MATERIAL_TABLES.flows].length, 1);
});

test('正常备注不判损坏，归还按实际出库数量结清', async () => {
  const f = fixture(); await f.checkout();
  const result = await f.service.applicationAction('app', 'return', { ...f.returnBody(5), note: '外观完好，配件齐全' });
  assert.equal(result.application.returnStatus, '已全部归还');
  assert.equal(result.application.returned, true);
  assert.equal(result.application.lossQuantity, 0);
  assert.equal(result.item.quantity, 12);
  assert.equal(result.flow.note, '外观完好，配件齐全');
  assert.equal(result.flow.note.includes('RC-MATERIALS'), false);
});

test('分次归还累计损耗，损耗不再扣库存', async () => {
  const f = fixture(); await f.checkout();
  let result = await f.service.applicationAction('app', 'return', f.returnBody(2, 1, 'return-1'));
  assert.equal(result.application.returnProgress, 'partial'); assert.equal(result.application.outstandingQuantity, 2); assert.equal(result.item.quantity, 9);
  result = await f.service.applicationAction('app', 'return', f.returnBody(2, 0, 'return-2'));
  assert.equal(result.application.returnProgress, 'completed'); assert.equal(result.application.lossQuantity, 1); assert.equal(result.application.returnedQuantity, 4); assert.equal(result.application.status, '已归还'); assert.equal(result.application.returnStatus, '物品缺失/数量减少'); assert.equal(result.item.quantity, 11);
  assert.equal((await f.service.overview()).stats.totalLossQuantity, 1);
});

test('全部丢失允许零实物归还，责任结清而库存不增加', async () => {
  const f = fixture(); await f.checkout();
  const result = await f.service.applicationAction('app', 'return', { ...f.returnBody(0, 5), note: '遗失，已核查' });
  assert.equal(result.item.quantity, 7); assert.equal(result.application.returnedQuantity, 0); assert.equal(result.application.lossQuantity, 5); assert.equal(result.application.outstandingQuantity, 0); assert.equal(result.application.status, '已归还');
});

test('拒绝零空操作、超额归还、错误资产与重复出库', async () => {
  const f = fixture(); await f.checkout();
  await assert.rejects(f.service.applicationAction('app', 'return', f.returnBody(0)), /不能同时为零/);
  await assert.rejects(f.service.applicationAction('app', 'return', f.returnBody(6)), /超过待还/);
  await assert.rejects(f.service.applicationAction('app', 'return', f.returnBody(3, 3)), /超过待还/);
  await assert.rejects(f.service.applicationAction('app', 'return', { ...f.returnBody(1), assetCode: 'NJU-RC-b' }), /原出库资产一致/);
  await assert.rejects(f.service.applicationAction('app', 'checkout', { ...f.checkoutBody, idempotencyKey: 'again', assetCode: 'NJU-RC-b' }, photo), /不能重复出库/);
  assert.equal(f.tables[MATERIAL_TABLES.flows].length, 1); assert.equal(f.uploads(), 1);
});

test('幂等重放在状态校验之前，校验申请资产操作数量', async () => {
  const f = fixture(); await f.checkout();
  await f.service.applicationAction('app', 'return', f.returnBody(5));
  const result = await f.checkout(); assert.equal(result.duplicate, true); assert.equal(f.uploads(), 1);
  await assert.rejects(f.service.applicationAction('app', 'checkout', { ...f.checkoutBody, quantity: 4 }, photo), /操作标识/);
  await assert.rejects(f.service.transaction({ assetCode: 'NJU-RC-a', operation: '入库', quantity: 5, idempotencyKey: 'checkout' }), /操作标识/);
  assert.equal(f.tables[MATERIAL_TABLES.flows].length, 2);
});

test('状态同步失败流预先保存完整patch，原标识重试可恢复且无重复库存照片', async () => {
  const f = fixture(); f.failures.set(`${MATERIAL_TABLES.applications}:app`, 'before');
  const first = await f.checkout(); assert.equal(first.syncPending, true); assert.equal(first.item.quantity, 7);
  const flow = f.tables[MATERIAL_TABLES.flows][0], annotation = readAnnotation(flow);
  assert.equal(annotation.note, '已点清数量'); assert.equal(annotation.sync.state, 'pending'); assert.deepEqual(annotation.sync.patch['物资出库照片'], ['/mock/photos/checkout.jpg']);
  await assert.rejects(f.service.applicationAction('app', 'checkout', { ...f.checkoutBody, idempotencyKey: 'new' }, photo), /待同步流水/);
  await assert.rejects(f.service.transaction({ assetCode: 'NJU-RC-a', operation: '入库', quantity: 1 }), /待同步流水/);
  const retried = await f.checkout(); assert.equal(retried.duplicate, true); assert.equal(retried.application.syncPending, false); assert.equal(retried.application.status, '借出（物资）');
  assert.equal(f.tables[MATERIAL_TABLES.flows].length, 1); assert.equal(f.uploads(), 1); assert.equal((await f.service.scan('NJU-RC-a')).item.quantity, 7);
});

test('状态写入成功但回执失败，重试仍保持单次库存与单张照片', async () => {
  const f = fixture(); f.failures.set(`${MATERIAL_TABLES.applications}:app`, 'after');
  const first = await f.checkout(); assert.equal(first.syncPending, true); assert.equal(f.tables[MATERIAL_TABLES.applications][0]['状态'], '借出（物资）');
  const recovered = await f.service.retrySync(first.flowId); assert.equal(recovered.application.syncPending, false); assert.equal(recovered.application.status, '借出（物资）');
  assert.equal(f.tables[MATERIAL_TABLES.flows].length, 1); assert.deepEqual(f.tables[MATERIAL_TABLES.applications][0]['物资出库照片'], ['/mock/photos/checkout.jpg']);
  await f.service.retrySync(first.flowId); assert.equal(f.tables[MATERIAL_TABLES.flows].length, 1);
});

test('流水同步标记写入失败后仍可恢复', async () => {
  const f = fixture(); f.failures.set(`${MATERIAL_TABLES.flows}:flow-1`, 'before');
  const first = await f.checkout(); assert.equal(first.syncPending, true);
  assert.equal(f.tables[MATERIAL_TABLES.applications][0]['状态'], '借出（物资）');
  await f.service.retrySync(first.flowId); assert.equal(readAnnotation(f.tables[MATERIAL_TABLES.flows][0]).sync.state, 'synced');
  assert.equal((await f.service.scan('NJU-RC-a')).item.quantity, 7);
});

test('流写入失败不修改申请且错误不含上游敏感文本', async () => {
  const f = fixture(); f.failures.set(`append:${MATERIAL_TABLES.flows}`, true);
  await assert.rejects(f.checkout(), error => error.statusCode === 502 && !error.message.includes('secret-token'));
  assert.equal(f.tables[MATERIAL_TABLES.applications][0]['状态'], '开始'); assert.equal(f.tables[MATERIAL_TABLES.flows].length, 0);
});

test('同申请跨资产并发只允许一次出库，同资产并发避免透支', async () => {
  const f = fixture();
  const actions = await Promise.allSettled([f.checkout(), f.service.applicationAction('app', 'checkout', { ...f.checkoutBody, assetCode: 'NJU-RC-b', idempotencyKey: 'other' }, photo)]);
  assert.equal(actions.filter(item => item.status === 'fulfilled').length, 1); assert.equal(f.tables[MATERIAL_TABLES.flows].length, 1);
  const results = await Promise.allSettled([f.service.transaction({ assetCode: 'NJU-RC-a', operation: '报损', quantity: 5, note: '损坏', idempotencyKey: 'loss-a' }), f.service.transaction({ assetCode: 'NJU-RC-a', operation: '报损', quantity: 5, note: '损坏', idempotencyKey: 'loss-b' })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1); assert.equal((await f.service.scan('NJU-RC-a')).item.quantity, 2);
});

test('历史没有原出库流拒绝自动归还，保留原申请可读', async () => {
  const f = fixture(); Object.assign(f.tables[MATERIAL_TABLES.applications][0], { '状态': '借出（物资）', '实际借用日期': '2026-09-30', '归还件数': 1 });
  await assert.rejects(f.service.applicationAction('app', 'return', f.returnBody(4)), error => error.code === 'material_history_unverified');
  assert.equal((await f.service.overview()).applications[0].returnProgress, 'unverified'); assert.equal(f.writes.length, 0);
});

test('历史归还件数大于流水拒绝自动结清，重复checkout流也不推定有效', async () => {
  const f = fixture(); await f.checkout(); f.tables[MATERIAL_TABLES.applications][0]['归还件数'] = 2;
  await assert.rejects(f.service.applicationAction('app', 'return', f.returnBody(3)), /历史归还件数/);
  const row = f.tables[MATERIAL_TABLES.applications][0]; f.tables[MATERIAL_TABLES.flows].push({ ...f.tables[MATERIAL_TABLES.flows][0], _id: 'duplicate' });
  assert.equal(applicationProgress(row, f.tables[MATERIAL_TABLES.flows]).verified, false);
});

test('资料更新验证所有字段后才写，不能绕过流水修改基线', async () => {
  const f = fixture();
  await assert.rejects(f.service.updateInventory('a', { name: '新名', center: '未知中心' }), /已配置选项/); assert.equal(f.writes.length, 0);
  await assert.rejects(f.service.updateInventory('a', { quantity: 50 }), /库存数量须登记流水/);
  await assert.rejects(f.service.updateInventory('a', { cabinet: 1.7 }), /整数/);
  const result = await f.service.updateInventory('a', { name: '急救箱新版', center: '仙林', cabinet: 2, level: 4, threshold: 0, thresholdEnabled: false });
  assert.equal(result.item.name, '急救箱新版'); assert.equal(result.item.quantity, 12); assert.equal(result.item.threshold, null); assert.equal(result.item.thresholdEnabled, false);
  const enabled = await f.service.updateInventory('a', { thresholdEnabled: true }); assert.equal(enabled.item.threshold, 0);
});

test('字段类型与单选选项决定可编辑能力，仅投影物资字段配置', async () => {
  const f = fixture(); f.columns.inventory[0].type = 'formula'; f.columns.config[2] = { name: '阈值启用', type: 'single-select', data: { options: [{ name: '开启' }, { name: '关闭' }] } };
  const result = await f.service.schema(); assert.equal(result.fields.name.editable, false); assert.equal(result.fields.center.type, 'single-select'); assert.deepEqual(result.fields.center.options, ['苏州', '仙林']);
  await assert.rejects(f.service.updateInventory('a', { name: 'x' }), /未配置为可编辑/);
  await f.service.updateInventory('a', { thresholdEnabled: false }); assert.equal(f.tables[MATERIAL_TABLES.config][0]['阈值启用'], '关闭');
});

test('资料与配置跨表部分失败明确报出，可刷新后重试配置', async () => {
  const f = fixture(); f.failures.set(`${MATERIAL_TABLES.config}:config-a`, 'before');
  await assert.rejects(f.service.updateInventory('a', { name: '新名称', threshold: 4 }), error => error.code === 'material_metadata_partial' && error.message.includes('基本资料已保存'));
  assert.equal(f.tables[MATERIAL_TABLES.inventory][0]['物资名称'], '新名称'); assert.equal(f.tables[MATERIAL_TABLES.config][0]['预警阈值'], 2);
  const result = await f.service.updateInventory('a', { threshold: 4 }); assert.equal(result.item.threshold, 4); assert.equal(f.tables[MATERIAL_TABLES.flows].length, 0);
});

test('无配置项时验证资产关联列后创建，不修改库存或表结构', async () => {
  const f = fixture(); const result = await f.service.updateInventory('b', { threshold: 2, thresholdEnabled: true });
  assert.equal(result.item.threshold, 2); assert.equal(result.item.quantity, 8); assert.equal(f.tables[MATERIAL_TABLES.config].length, 2);
});

test('异常核查保留业务备注与同步patch，不伪造结清', async () => {
  const f = fixture(); f.failures.set(`${MATERIAL_TABLES.applications}:app`, 'before'); const first = await f.checkout();
  const reviewed = await f.service.reviewFlow(first.flowId, { note: '已联系借用人，等待同步' }); assert.equal(reviewed.flow.note, '已点清数量'); assert.equal(reviewed.flow.syncPending, true); assert.equal(reviewed.flow.resolution.operator, '测试管理员');
  assert.equal(f.tables[MATERIAL_TABLES.applications][0]['状态'], '开始');
  const recovered = await f.service.retrySync(first.flowId); assert.equal(recovered.flow.resolution.note, '已联系借用人，等待同步'); assert.equal(recovered.flow.syncPending, false);
});

test('完整流水分页与筛选，不公开恢复patch和SDK原始报错', async () => {
  const f = fixture(); await f.checkout(); await f.service.applicationAction('app', 'return', f.returnBody(4, 1));
  await f.service.transaction({ assetCode: 'NJU-RC-b', operation: '入库', quantity: 1, note: '补充' });
  const first = await f.service.listFlows({ page: '1', pageSize: '1', assetCode: 'NJU-RC-a', from: '2026-10-04', to: '2026-10-04' }); assert.equal(first.total, 2); assert.equal(first.totalPages, 2); assert.equal(first.flows.length, 1); assert.equal(JSON.stringify(first).includes('RC-MATERIALS'), false);
  const errors = await f.service.listFlows({ errorOnly: 'true' }); assert.equal(errors.total, 1); assert.equal(errors.flows[0].loss, 1);
  const search = await f.service.listFlows({ q: '补充', operator: '测试' }); assert.equal(search.total, 1); assert.equal(search.flows[0].assetCode, 'NJU-RC-b');
  const sanitized = flowSummary({ _id: 'old', '异常说明': '申请状态同步失败：secret-token', '操作类型': '归还' }); assert.equal(sanitized.syncPending, true); assert.equal(sanitized.note.includes('secret-token'), false);
});

test('截断的操作数据不得用于库存修改', async () => {
  const f = fixture();
  const service = createMaterialsService({ client: f.client, listRows: async table => { const rows = structuredClone(f.tables[table]); Object.defineProperty(rows, 'readMeta', { value: { truncated: table === MATERIAL_TABLES.flows } }); return rows; } });
  await assert.rejects(service.transaction({ assetCode: 'NJU-RC-a', operation: '入库', quantity: 1 }), error => error.code === 'incomplete_operational_data'); assert.equal(f.writes.length, 0);
});

test('审批并发仅允许一种结果，申请关联出库与无关联归还不得走通用库存入口', async () => {
  const f = fixture(); f.tables[MATERIAL_TABLES.applications][0]['状态'] = '待审批';
  const results = await Promise.allSettled([f.service.reviewApplication('app', true), f.service.reviewApplication('app', false, { reason: '不符合范围' })]); assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  await assert.rejects(f.service.transaction({ assetCode: 'NJU-RC-a', operation: '出库', quantity: 1, applicationId: 'app', destination: '借用申请' }), /通过申请单操作/);
  await assert.rejects(f.service.transaction({ assetCode: 'NJU-RC-a', operation: '归还', quantity: 1 }), /通过申请单操作/);
});

test('独立领用与消耗出库保存去向并减少库存，重放不重复扣减', async () => {
  const f = fixture();
  await assert.rejects(f.service.transaction({ assetCode: 'NJU-RC-a', operation: '出库', quantity: 2 }), /领用或消耗去向/);
  const body = { assetCode: 'NJU-RC-a', operation: '出库', quantity: 2, destination: '急救培训消耗', idempotencyKey: 'direct-checkout' };
  const first = await f.service.transaction(body);
  assert.equal(first.item.quantity, 10);
  assert.equal((await f.service.transaction(body)).duplicate, true);
  assert.equal(f.tables[MATERIAL_TABLES.flows].length, 1);
  assert.equal(f.tables[MATERIAL_TABLES.flows][0]['申请单ID'], '');
  const overview = await f.service.overview();
  assert.equal(overview.inventory[0].destinations[0].label, '急救培训消耗');
  assert.equal(overview.applications[0].hasHistory, false);
  assert.equal(overview.stats.overdueCount, 0);
});

test('固定时钟用于逾期与近14日趋势，待审批拒绝未借出申请不催还', async () => {
  const f = fixture();
  f.tables[MATERIAL_TABLES.applications][0]['拟归还日期'] = '2026-10-02';
  const base = structuredClone(f.tables[MATERIAL_TABLES.applications][0]);
  f.tables[MATERIAL_TABLES.applications].push(
    { ...base, _id: 'pending', '状态': '待审批', '借出审批': '待审核' },
    { ...base, _id: 'rejected', '状态': '审批不通过', '借出审批': '审批不通过' },
    { ...base, _id: 'not-borrowed', '状态': '开始' },
    { ...base, _id: 'legacy-borrowed', '状态': '借出（物资）', '实际借用日期': '2026-10-01' },
  );
  await f.checkout();
  const result = await f.service.overview();
  assert.equal(result.applications.find(item => item.id === 'app').overdueDays, 2);
  assert.deepEqual(result.overdue.map(item => item.id).sort(), ['app', 'legacy-borrowed']);
  assert.equal(result.series.labels[0], '2026-09-21');
  assert.equal(result.series.labels[13], '2026-10-04');
  assert.equal(result.series.outbound[13], 5);
  const futureClock = await f.createService({ today: () => '2026-10-05' }).overview();
  assert.equal(futureClock.applications.find(item => item.id === 'app').overdueDays, 3);
  assert.equal(futureClock.series.outbound[12], 5);
  assert.equal(applicationSummary({ ...base, '状态': '待审批', '实际借用日期': '2026-10-01' }, [], '2026-10-04').overdueDays, 0);
  assert.equal(applicationSummary({ ...base, '状态': '审批不通过', '实际借用日期': '2026-10-01' }, [], '2026-10-04').overdueDays, 0);
});

test('每请求独立service共享锁，库存并发不透支且操作人属于各自请求', async () => {
  const f = fixture(), first = f.createService({ actor: '管理员甲' }), second = f.createService({ actor: '管理员乙' });
  const results = await Promise.allSettled([
    first.transaction({ assetCode: 'NJU-RC-a', operation: '出库', quantity: 8, destination: '训练甲', idempotencyKey: 'actor-a' }),
    second.transaction({ assetCode: 'NJU-RC-a', operation: '出库', quantity: 8, destination: '训练乙', idempotencyKey: 'actor-b' }),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(f.tables[MATERIAL_TABLES.flows][0]['操作人'], '管理员甲');
  await second.transaction({ assetCode: 'NJU-RC-b', operation: '入库', quantity: 1 });
  assert.equal(f.tables[MATERIAL_TABLES.flows][1]['操作人'], '管理员乙');
  assert.equal((await first.scan('NJU-RC-a')).item.quantity, 4);
  assert.equal(f.locks.size, 0);
});

test('错误带statusCode时仍脱敏，更新与读取错误不公开上游secret', async () => {
  const f = fixture();
  const upstream = () => { const error = new Error('secret-token upstream'); error.statusCode = 401; throw error; };
  f.client.appendRow = upstream;
  await assert.rejects(f.service.transaction({ assetCode: 'NJU-RC-a', operation: '入库', quantity: 1 }), error => error.statusCode === 502 && !error.message.includes('secret-token'));
  f.client.updateRow = upstream;
  await assert.rejects(f.service.updateInventory('a', { name: '新名称' }), error => error.statusCode === 502 && !error.message.includes('secret-token'));
  await assert.rejects(f.createService({ listRows: upstream }).overview(), error => error.statusCode === 502 && !error.message.includes('secret-token'));
  f.client.getMetadata = upstream;
  await assert.rejects(f.service.schema(), error => error.statusCode === 502 && !error.message.includes('secret-token'));
});

test('更新返回零行或空回执但没有持久化时保留待同步，可重试恢复', async () => {
  for (const acknowledgement of [{ updated_row_count: 0 }, {}, { success: false }]) {
    const f = fixture(), original = f.client.updateRow;
    f.client.updateRow = async (table, id, patch) => table === MATERIAL_TABLES.applications ? acknowledgement : original(table, id, patch);
    const result = await f.checkout();
    assert.equal(result.syncPending, true);
    assert.equal(f.tables[MATERIAL_TABLES.applications][0]['状态'], '开始');
    assert.equal(readAnnotation(f.tables[MATERIAL_TABLES.flows][0]).sync.state, 'pending');
    f.client.updateRow = original;
    const recovered = await f.service.retrySync(result.flowId);
    assert.equal(recovered.application.status, '借出（物资）');
    assert.equal(recovered.flow.syncPending, false);
    assert.equal((await f.service.scan('NJU-RC-a')).item.quantity, 7);
    assert.equal(f.tables[MATERIAL_TABLES.flows].length, 1);
  }
});

test('流水标记未持久化不能报同步成功，读回确认后安全恢复', async () => {
  const f = fixture(), original = f.client.updateRow;
  f.client.updateRow = async (table, id, patch) => table === MATERIAL_TABLES.flows ? {} : original(table, id, patch);
  const first = await f.checkout();
  assert.equal(first.syncPending, true);
  assert.equal(f.tables[MATERIAL_TABLES.applications][0]['状态'], '借出（物资）');
  assert.equal(readAnnotation(f.tables[MATERIAL_TABLES.flows][0]).sync.state, 'pending');
  f.client.updateRow = original;
  const recovered = await f.service.retrySync(first.flowId);
  assert.equal(recovered.flow.syncPending, false);
  assert.equal(f.tables[MATERIAL_TABLES.flows].length, 1);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('并发核查与同步共享flow锁，两种顺序和幂等重放都保留核查与同步信息', async () => {
  for (const reviewFirst of [true, false]) {
    for (const replay of [false, true]) {
      const f = fixture(); f.failures.set(`${MATERIAL_TABLES.applications}:app`, 'before');
      const first = await f.checkout(), started = deferred(), release = deferred(), original = f.client.updateRow;
      let held = false;
      f.client.updateRow = async (table, id, patch) => {
        const isReview = table === MATERIAL_TABLES.flows && Boolean(readAnnotation(patch).resolution);
        const shouldHold = reviewFirst ? isReview : table === MATERIAL_TABLES.applications;
        if (!held && shouldHold) { held = true; started.resolve(); await release.promise; }
        return original(table, id, patch);
      };
      const reviewer = f.createService({ actor: '核查管理员' });
      const synchronize = () => replay ? f.checkout() : f.service.retrySync(first.flowId);
      const review = () => reviewer.reviewFlow(first.flowId, { note: '已联系借用人' });
      const leading = reviewFirst ? review() : synchronize();
      await started.promise;
      const trailing = reviewFirst ? synchronize() : review();
      await new Promise(resolve => setImmediate(resolve));
      release.resolve();
      await Promise.all([leading, trailing]);
      const annotation = readAnnotation(f.tables[MATERIAL_TABLES.flows][0]);
      assert.equal(annotation.sync.state, 'synced');
      assert.equal(annotation.resolution.note, '已联系借用人');
      assert.equal(annotation.resolution.operator, '核查管理员');
      assert.equal(annotation.note, '已点清数量');
      assert.equal(f.tables[MATERIAL_TABLES.flows].length, 1);
      assert.equal(f.locks.size, 0);
    }
  }
});
