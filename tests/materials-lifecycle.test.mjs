import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMaterialsService, MATERIAL_TABLES } from '../lib/materials/service.js';
import { createMaterialsFixtures } from '../lib/materials/fixtures.js';
import { createPreviewLifecycle } from '../lib/materials/preview-lifecycle.js';

function fixture() {
  const data = createMaterialsFixtures();
  let uploads = 0;
  const core = createMaterialsService({ client: data.client, listRows: data.listRows,
    actor: '本地合成管理员', today: () => '2026-10-04', uploadPhoto: async () => { uploads++; return '/api/preview/photos/unit'; } });
  return { data, core, lifecycle: createPreviewLifecycle({ service: core, fixture: data }), uploads: () => uploads };
}
const newInventory = (overrides = {}) => ({ name: '本地新增急救包', unit: '个', center: '合成苏州中心', cabinet: '新柜', level: '1',
  initialQuantity: 5, threshold: 2, thresholdEnabled: true, idempotencyKey: 'create:unit', ...overrides });
const disable = (idempotencyKey = 'disable:unit', overrides = {}) => ({ availability: 'disabled', reason: '待检修，保留原借还', idempotencyKey, ...overrides });

test('local-demo capability与sidecar投影明确，生产core不宣告生命周期或写状态列', async () => {
  const f = fixture(), before = f.data.snapshot(), overview = await f.lifecycle.overview();
  assert.deepEqual(overview.capabilities.inventoryLifecycle, { mode: 'local-demo', create: true, availability: true });
  assert.equal(overview.inventory.length, 6);
  assert.equal(overview.inventory.find(item => item.id === 'synthetic-tent').availability, 'disabled');
  assert.equal(overview.stats.disabledQuantity, 2);
  assert.equal(overview.stats.activeQuantity + overview.stats.disabledQuantity, overview.stats.totalCurrentQuantity);
  const scan = await f.lifecycle.scan('NJU-RC-synthetic-tent');
  assert.match(scan.item.availabilityReason, /待检修/);
  assert.equal(scan.item.availabilityHistory[0].action, 'disable');
  assert.deepEqual(f.data.snapshot(), before);
  assert.equal((await f.core.overview()).capabilities, undefined);
  assert.equal((await f.core.scan('NJU-RC-synthetic-tent')).item.availability, undefined);
  const schema = await f.lifecycle.schema();
  assert.equal(schema.creation.fields.initialQuantity.editable, true);
  assert.equal(schema.creation.fields.initialQuantity.min, 0);
  assert.equal(schema.creation.assetCode, 'generated');
  const production = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(production, /preview-lifecycle|\/api\/preview\/materials/);
});

test('新增初始量只由首入库计一次，理论初始量与库存一致、基线零', async () => {
  const f = fixture(), before = f.data.snapshot(), result = await f.lifecycle.createInventory(newInventory());
  const item = result.item;
  assert.equal(item.initial, 5); assert.equal(item.baselineQuantity, 0); assert.equal(item.quantity, 5); assert.equal(item.difference, 0);
  assert.equal(item.availability, 'active'); assert.equal(item.availabilityHistory[0].action, 'create');
  assert.match(item.code, /^NJU-RC-synthetic-added-/);
  const after = f.data.snapshot();
  assert.equal(after[MATERIAL_TABLES.inventory].length, before[MATERIAL_TABLES.inventory].length + 1);
  assert.equal(after[MATERIAL_TABLES.config].length, before[MATERIAL_TABLES.config].length + 1);
  assert.equal(after[MATERIAL_TABLES.flows].length, before[MATERIAL_TABLES.flows].length + 1);
  const flow = after[MATERIAL_TABLES.flows].find(row => row['资产编码'] === item.code);
  assert.equal(flow['操作类型'], '入库'); assert.equal(flow['操作前数量'], 0); assert.equal(flow['操作后数量'], 5);
  assert.equal(flow['数量'], 5); assert.equal((await f.lifecycle.scan(item.code)).item.quantity, 5);
});

test('零数量新增不产生空流水，创建重放及冲突不产生重复资产', async () => {
  const f = fixture(), before = f.data.snapshot(), body = newInventory({ initialQuantity: 0, threshold: 0, thresholdEnabled: false });
  const first = await f.lifecycle.createInventory(body), duplicate = await f.lifecycle.createInventory(body);
  assert.equal(first.item.quantity, 0); assert.equal(first.item.threshold, null); assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.item.id, first.item.id);
  assert.equal(f.data.snapshot()[MATERIAL_TABLES.flows].length, before[MATERIAL_TABLES.flows].length);
  await assert.rejects(f.lifecycle.createInventory({ ...body, name: '另一物资' }), error => error.code === 'preview_lifecycle_idempotency_conflict');
  assert.equal(f.data.snapshot()[MATERIAL_TABLES.inventory].length, 7);
});

test('所有新增字段先验证，未知字段与非法数量不会留下资产配置或流水', async () => {
  const f = fixture(), before = f.data.snapshot();
  for (const body of [newInventory({ assetCode: 'user-code' }), newInventory({ availability: 'active' }), newInventory({ center: '未知中心' }),
    newInventory({ name: '' }), newInventory({ thresholdEnabled: 'false' }), newInventory({ threshold: 1.7 }),
    ...[1.7, '1.7', true, '', '1e2', null, -1].map(initialQuantity => newInventory({ initialQuantity }))]) {
    await assert.rejects(f.lifecycle.createInventory(body), error => error.statusCode === 400);
    assert.deepEqual(f.data.snapshot(), before);
  }
  const metadata = f.data.client.getMetadata;
  f.data.client.getMetadata = async () => {
    const result = await metadata(); result.tables.find(table => table.name === MATERIAL_TABLES.inventory).columns.find(column => column.name === '层数').type = 'number'; return result;
  };
  await assert.rejects(f.lifecycle.createInventory(newInventory({ level: 1.7 })), /整数/);
  assert.deepEqual(f.data.snapshot(), before);
});

test('资产配置首入库任一步骤失败都原子回退，原key重试只创建一份', async () => {
  for (const failingTable of [MATERIAL_TABLES.inventory, MATERIAL_TABLES.config, MATERIAL_TABLES.flows]) {
    const f = fixture(), before = f.data.snapshot(), append = f.data.client.appendRow;
    f.data.client.appendRow = async (table, row) => { if (table === failingTable) throw new Error('secret-token injected storage failure'); return append(table, row); };
    await assert.rejects(f.lifecycle.createInventory(newInventory()), error => error.code === 'preview_lifecycle_create_failed' && !error.message.includes('secret-token'));
    assert.deepEqual(f.data.snapshot(), before);
    assert.ok((await f.lifecycle.overview()).inventory.every(item => !item.initialization));
    f.data.client.appendRow = append;
    const created = await f.lifecycle.createInventory(newInventory());
    assert.equal(created.item.quantity, 5);
    assert.equal(f.data.snapshot()[MATERIAL_TABLES.inventory].length, 7);
    assert.equal(f.data.snapshot()[MATERIAL_TABLES.config].length, 7);
    assert.equal(f.data.snapshot()[MATERIAL_TABLES.flows].length, before[MATERIAL_TABLES.flows].length + 1);
  }
});

test('新建首入库解释零基线差额，保留旧资产真实异常且停用恢复不产生假异常', async () => {
  const f = fixture();
  await f.data.client.updateRow(MATERIAL_TABLES.inventory, 'synthetic-tent', { '现有数量': 1 });
  const before = await f.lifecycle.overview();
  assert.equal(before.stats.totalUntrackedDifference, 1);
  const created = await f.lifecycle.createInventory(newInventory());
  assert.equal(created.item.untrackedDifference, 0);
  assert.equal(created.item.initialization, 'inbound-ledger');
  assert.equal(created.item.baselineDifference, 5, '显示真实初始量与零库存基线的差额');
  assert.equal((await f.core.scan(created.item.code)).item.untrackedDifference, 5, '生产core保留原历史算法');
  const after = await f.lifecycle.overview();
  assert.equal(after.stats.totalUntrackedDifference, before.stats.totalUntrackedDifference);
  assert.equal(after.inventory.find(item => item.id === 'synthetic-tent').untrackedDifference, 1);
  const stopped = await f.lifecycle.changeAvailability(created.item.id, disable());
  const restored = await f.lifecycle.changeAvailability(created.item.id, { availability: 'active', reason: '检修完成', idempotencyKey: 'new:restore' });
  for (const item of [stopped.item, restored.item, (await f.lifecycle.scan(created.item.code)).item]) {
    assert.equal(item.untrackedDifference, 0); assert.equal(item.initialization, 'inbound-ledger'); assert.equal(item.baselineDifference, 5);
  }
  const empty = await f.lifecycle.createInventory(newInventory({ initialQuantity: 0, idempotencyKey: 'create:zero' }));
  assert.equal(empty.item.untrackedDifference, 0); assert.equal(empty.item.initialization, 'inbound-ledger');
  assert.equal((await f.lifecycle.overview()).stats.totalUntrackedDifference, 1);
});

test('停用与恢复必须明确原因，历史保留，同key重放不重复历史且跨动作冲突', async () => {
  const f = fixture(), before = f.data.snapshot();
  await assert.rejects(f.lifecycle.changeAvailability('synthetic-kit', disable('bad', { reason: '' })), /原因/);
  await assert.rejects(f.lifecycle.changeAvailability('synthetic-kit', disable('bad', { availability: 'toggle' })), /active 或 disabled/);
  await assert.rejects(f.lifecycle.changeAvailability('synthetic-kit', { ...disable('bad'), quantity: 0 }), /不支持/);
  const stopped = await f.lifecycle.changeAvailability('synthetic-kit', disable());
  assert.equal(stopped.item.availability, 'disabled'); assert.equal(stopped.item.quantity, 10); assert.equal(stopped.item.availabilityHistory.length, 1);
  assert.equal((await f.lifecycle.changeAvailability('synthetic-kit', disable())).duplicate, true);
  assert.equal((await f.lifecycle.scan(stopped.item.code)).item.availabilityHistory.length, 1);
  await assert.rejects(f.lifecycle.changeAvailability('synthetic-kit', disable('disable:unit', { reason: '改变原因' })), error => error.code === 'preview_lifecycle_idempotency_conflict');
  await assert.rejects(f.lifecycle.createInventory(newInventory({ idempotencyKey: 'disable:unit' })), error => error.code === 'preview_lifecycle_idempotency_conflict');
  const restored = await f.lifecycle.changeAvailability('synthetic-kit', { availability: 'active', reason: '检修完成', idempotencyKey: 'restore:unit' });
  assert.equal(restored.item.availability, 'active'); assert.equal(restored.item.quantity, 10);
  assert.deepEqual(restored.item.availabilityHistory.map(item => item.action), ['disable', 'restore']);
  assert.equal(restored.item.availabilityHistory[1].operator, '本地合成管理员');
  assert.deepEqual(f.data.snapshot(), before);
});

test('有借出物资允许停用并继续原归还，拦截新入出库而保留盘点报损', async () => {
  const f = fixture(); await f.lifecycle.changeAvailability('synthetic-kit', disable());
  for (const body of [{ operation: '入库', quantity: 1 }, { operation: '出库', quantity: 1, destination: '新领用' }]) {
    await assert.rejects(f.lifecycle.transaction({ ...body, assetCode: 'NJU-RC-synthetic-kit', idempotencyKey: `new:${body.operation}` }), error => error.code === 'preview_material_disabled');
  }
  await assert.rejects(f.lifecycle.applicationAction('synthetic-approved', 'checkout', { assetCode: 'NJU-RC-synthetic-kit', quantity: 2, idempotencyKey: 'new:loan' }, {}), error => error.code === 'preview_material_disabled');
  const returned = await f.lifecycle.applicationAction('synthetic-partial', 'return', { assetCode: 'NJU-RC-synthetic-kit', quantity: 1, lossQuantity: 0, idempotencyKey: 'old:return' });
  assert.equal(returned.item.quantity, 11); assert.equal(returned.item.availability, 'disabled'); assert.equal(returned.application.outstandingQuantity, 0);
  const loss = await f.lifecycle.transaction({ assetCode: 'NJU-RC-synthetic-kit', operation: '报损', quantity: 1, note: '核查库存报损', idempotencyKey: 'old:loss' });
  assert.equal(loss.item.quantity, 10);
  const adjusted = await f.lifecycle.transaction({ assetCode: 'NJU-RC-synthetic-kit', operation: '盘点增加', quantity: 1, note: '盘点核实', idempotencyKey: 'old:adjust' });
  assert.equal(adjusted.item.quantity, 11); assert.equal(adjusted.item.availability, 'disabled');
});

test('待同步物资先恢复状态同步再停用，恢复同步与归还不受停用规则误拦', async () => {
  const f = fixture(); f.data.failNextUpdate(MATERIAL_TABLES.applications, 'synthetic-sync');
  const checkout = await f.lifecycle.applicationAction('synthetic-sync', 'checkout', { assetCode: 'NJU-RC-synthetic-camera', quantity: 1, idempotencyKey: 'pending' }, {});
  assert.equal(checkout.syncPending, true);
  await assert.rejects(f.lifecycle.changeAvailability('synthetic-camera', disable()), error => error.code === 'material_sync_pending');
  assert.equal((await f.lifecycle.scan('NJU-RC-synthetic-camera')).item.availability, 'active');
  await f.lifecycle.retrySync(checkout.flowId);
  const stopped = await f.lifecycle.changeAvailability('synthetic-camera', disable());
  assert.equal(stopped.item.quantity, 2);
  const returned = await f.lifecycle.applicationAction('synthetic-sync', 'return', { assetCode: stopped.item.code, quantity: 1, idempotencyKey: 'camera:return' });
  assert.equal(returned.item.quantity, 3); assert.equal(returned.item.availability, 'disabled');
});

test('成功入出库停用后允许原key重放，参数冲突仍拒绝且库存照片不重复', async () => {
  const f = fixture(), body = { assetCode: 'NJU-RC-synthetic-kit', operation: '入库', quantity: 1, idempotencyKey: 'before:disable' };
  await f.lifecycle.transaction(body); await f.lifecycle.changeAvailability('synthetic-kit', disable());
  assert.equal((await f.lifecycle.transaction(body)).duplicate, true);
  await assert.rejects(f.lifecycle.transaction({ ...body, quantity: 2 }), error => error.code === 'material_idempotency_conflict');
  await assert.rejects(f.lifecycle.transaction({ ...body, note: '变更备注' }), error => error.code === 'material_idempotency_conflict');
  await assert.rejects(f.lifecycle.transaction({ ...body, destination: '变更去向' }), error => error.code === 'material_idempotency_conflict');
  assert.equal((await f.lifecycle.scan(body.assetCode)).item.quantity, 11);
  const checkoutBody = { assetCode: 'NJU-RC-synthetic-camera', quantity: 1, idempotencyKey: 'old:checkout' };
  await f.lifecycle.applicationAction('synthetic-sync', 'checkout', checkoutBody, {});
  await f.lifecycle.changeAvailability('synthetic-camera', disable('disable:camera'));
  assert.equal((await f.lifecycle.applicationAction('synthetic-sync', 'checkout', checkoutBody, {})).duplicate, true);
  assert.equal(f.uploads(), 1);
});

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('所有preview写操作串行，出库成功后停用，排队的新出库不能越过停用', async () => {
  const f = fixture(), entered = deferred(), release = deferred(), original = f.data.client.appendRow;
  f.data.client.appendRow = async (table, row) => {
    if (table === MATERIAL_TABLES.flows && row['幂等键'] === 'race:first') { entered.resolve(); await release.promise; }
    return original(table, row);
  };
  const first = f.lifecycle.transaction({ assetCode: 'NJU-RC-synthetic-kit', operation: '出库', quantity: 1, destination: '首笔领用', idempotencyKey: 'race:first' });
  await entered.promise;
  const stop = f.lifecycle.changeAvailability('synthetic-kit', disable());
  const trailing = f.lifecycle.transaction({ assetCode: 'NJU-RC-synthetic-kit', operation: '出库', quantity: 1, destination: '后续领用', idempotencyKey: 'race:last' });
  const rejected = assert.rejects(trailing, error => error.code === 'preview_material_disabled');
  release.resolve(); await Promise.all([first, stop, rejected]);
  const item = (await f.lifecycle.scan('NJU-RC-synthetic-kit')).item;
  assert.equal(item.quantity, 9); assert.equal(item.availability, 'disabled');
  assert.equal(f.data.snapshot()[MATERIAL_TABLES.flows].filter(row => String(row['幂等键']).startsWith('race:')).length, 1);
});
