import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materialProductionFixture, productionOwner as owner, productionManager as admin } from './helpers/material-production-fixture.js';
import { openMaterialWorkflowStore, MATERIAL_WORKFLOW_TABLE } from '../lib/materials/workflow-store.js';
import { ensureMaterialWorkflowSchema } from '../lib/materials/workflow-schema.js';

const input = { applicationId: 'synthetic-overdue', quantity: 2, note: '正常分批归还', idempotencyKey: 'synthetic-return-1' };
async function fixture(t, options) { const f = await materialProductionFixture(options); t.after(() => f.close()); return f; }

test('formal loans are owned by verified student identity, never display name or client supplied identifiers', async t => {
  const f = await fixture(t);
  const result = await f.workflow.listLoans(owner);
  assert.equal(result.loans.length, 1); assert.equal(result.loans[0].outstanding, 5);
  assert.equal((await f.workflow.listLoans({ ...owner, id: 'other', studentId: '987654321' })).loans.length, 0);
  assert.equal((await f.workflow.listLoans({ ...owner, email: 'other@example.invalid' })).loans.length, 0);
  await assert.rejects(f.workflow.listLoans({ ...owner, emailVerified: false }), { statusCode: 403 });
  assert.equal(f.writes.length, 0);
});

test('returns persist in Table, survive a new store and block foreign, excess, duplicate and changed submissions', async t => {
  const f = await fixture(t), before = (await f.workflow.overview(admin)).stats.totalCurrentQuantity;
  await assert.rejects(f.workflow.submit(owner, { ...input, applicationId: 'synthetic-partial' }), { statusCode: 404 });
  await assert.rejects(f.workflow.submit(owner, { ...input, quantity: 6 }), { statusCode: 409 });
  const saved = await f.workflow.submit(owner, input);
  assert.equal((await f.workflow.submit(owner, input)).duplicate, true);
  await assert.rejects(f.workflow.submit(owner, { ...input, quantity: 1 }), { statusCode: 409 });
  await assert.rejects(f.workflow.submit(owner, { ...input, idempotencyKey: 'other-operation' }), { statusCode: 409 });
  assert.equal((await f.workflow.list({ id: 'another' })).records.length, 0);
  const serialized = JSON.stringify(await f.workflow.list(owner)); assert.doesNotMatch(serialized, /fingerprint|photo.*sha256|owner/);
  const next = openMaterialWorkflowStore({ file: ':memory:', getClient: async () => f.client, listRows: (_, table) => f.list(table) });
  t.after(() => next.close()); assert.equal((await next.get(saved.record.id)).document.quantity, 2);
  assert.equal((await f.workflow.overview(admin)).stats.totalCurrentQuantity, before);
});

test('physical review uses the formal durable application path, credits stock once, and does not flag a normal note as damage', async t => {
  const f = await fixture(t), record = (await f.workflow.submit(owner, input)).record;
  await assert.rejects(f.workflow.review(owner, record.id, { action: 'approve', revision: 1 }, f.context), { statusCode: 403 });
  await assert.rejects(f.workflow.review(admin, record.id, { action: 'approve', revision: 1, physicalChecked: false }, f.context), { statusCode: 400 });
  const before = (await f.workflow.overview(admin)).stats.totalCurrentQuantity;
  const reviewed = await f.workflow.review(admin, record.id, { action: 'approve', revision: 1, physicalChecked: true }, f.context);
  assert.equal(reviewed.record.status, 'approved');
  assert.equal((await f.workflow.overview(admin)).stats.totalCurrentQuantity, before + 2);
  const loan = (await f.workflow.listLoans(owner)).loans[0]; assert.equal(loan.outstanding, 3);
  const last = (await f.workflow.submit(owner, { ...input, quantity: 3, idempotencyKey: 'last-return' })).record;
  await f.workflow.review(admin, last.id, { action: 'approve', revision: 1, physicalChecked: true }, f.context);
  assert.equal((await f.workflow.listLoans(owner)).loans.length, 0);
  const row = f.data['物资管理'].find(row => row._id === input.applicationId);
  assert.equal(row['归还状态'], '已全部归还'); assert.equal(row['归还件数'], 5);
  await assert.rejects(f.workflow.review(admin, record.id, { action: 'approve', revision: 1, physicalChecked: true }, f.context), { statusCode: 409 });
});

test('lost flow acknowledgement and interrupted application update resume without duplicate stock or changing reviewer', async t => {
  for (const failure of ['append', 'update']) {
    const f = await fixture(t), record = (await f.workflow.submit(owner, input)).record;
    if (failure === 'append') f.state.failAppendAfter = '物资流水表'; else f.state.failUpdateBefore = '物资管理';
    const body = { action: 'approve', revision: 1, physicalChecked: true, note: '已核对' };
    await assert.rejects(f.workflow.review(admin, record.id, body, f.context));
    await assert.rejects(f.workflow.review({ ...admin, id: 'other-reviewer' }, record.id, body, f.context), { statusCode: 409 });
    await assert.rejects(f.workflow.review(admin, record.id, { ...body, action: 'reject' }, f.context), { statusCode: 409 });
    await f.workflow.review(admin, record.id, body, f.context);
    const flow = f.data['物资流水表'].filter(row => row['申请单ID'] === input.applicationId && row['操作类型'] === '归还');
    assert.equal(flow.length, 1); assert.equal(flow[0]['数量'], 2);
  }
});

test('review rejection requires an opinion and does not mutate inventory; stale revisions are rejected', async t => {
  const f = await fixture(t), record = (await f.workflow.submit(owner, input)).record, before = structuredClone(f.data['物资流水表']);
  await assert.rejects(f.workflow.review(admin, record.id, { action: 'reject', revision: 1, note: ' ' }, f.context), { statusCode: 400 });
  await assert.rejects(f.workflow.review(admin, record.id, { action: 'reject', revision: 99, note: '数量有误' }, f.context), { statusCode: 409 });
  await f.workflow.review(admin, record.id, { action: 'reject', revision: 1, note: '数量有误' }, f.context);
  assert.deepEqual(f.data['物资流水表'], before); assert.equal((await f.workflow.list(owner)).records[0].reviewNote, '数量有误');
});

test('missing auxiliary schema is explicit readiness, never a fabricated empty success or a real row write', async t => {
  const f = await fixture(t, { schemaReady: false });
  const loans = await f.workflow.listLoans(owner); assert.equal(loans.loans.length, 1); assert.equal(loans.registrationReady, false);
  assert.equal((await f.workflow.list(owner)).registrationReady, false);
  await assert.rejects(f.workflow.submit(owner, input), { statusCode: 503 }); assert.equal(f.writes.length, 0);
  assert.equal((await f.workflow.schema(admin)).capabilities.stockMovements.mode, 'production');
});

test('new inventory has a zero baseline plus one initial inbound; duplicate creation and availability cannot inflate stock', async t => {
  const f = await fixture(t), body = { name: '新增合成物资', unit: '件', center: '合成苏州中心', cabinet: 'D', level: '1', initialQuantity: 3, threshold: 1, thresholdEnabled: true, idempotencyKey: 'create-one' };
  const first = await f.workflow.createInventory(admin, body), again = await f.workflow.createInventory(admin, body);
  assert.equal(again.item.id, first.item.id); assert.equal(again.duplicate, true); assert.equal(first.item.quantity, 3); assert.equal(first.item.baselineQuantity, 0);
  await assert.rejects(f.workflow.createInventory(admin, { ...body, initialQuantity: 4 }), { statusCode: 409 });
  const disabled = { availability: 'disabled', reason: '检修', idempotencyKey: 'disable-one' };
  await f.workflow.changeAvailability(admin, first.item.id, disabled);
  assert.equal((await f.workflow.changeAvailability(admin, first.item.id, disabled)).duplicate, true);
  assert.equal((await f.workflow.filterAvailable([first.item])).length, 0);
  await assert.rejects(f.workflow.transaction(admin, { assetCode: first.item.code, operation: '出库', quantity: 1, destination: '合成领用', idempotencyKey: 'movement-one' }), { statusCode: 409 });
  await f.workflow.changeAvailability(admin, first.item.id, { availability: 'active', reason: '检修完成', idempotencyKey: 'restore-one' });
  assert.equal((await f.workflow.scan(admin, first.item.code)).item.quantity, 3);
});

test('durable intent rejects unknown inventory append after restart instead of creating another asset', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'material-production-'));
  const f = await fixture(t, { intentFile: join(dir, 'intent.sqlite') });
  let count = 0;
  const task = async () => { count++; throw Error('Unknown upstream result'); };
  await assert.rejects(f.store.once('synthetic-command', 'fingerprint', task));
  const next = openMaterialWorkflowStore({ file: join(dir, 'intent.sqlite'), getClient: async () => f.client, listRows: (_, table) => f.list(table) });
  t.after(() => next.close());
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(next.once('synthetic-command', 'fingerprint', task), { code: 'materials_write_uncertain' }); assert.equal(count, 1);
});

test('creation validates warning-field schema before writing any new asset, and stopping an asset respects pending receipts', async t => {
  const f = await fixture(t), body = { name: '合成物资', unit: '件', center: '合成苏州中心', cabinet: 'D', level: '1', initialQuantity: 1, threshold: 1, thresholdEnabled: true, idempotencyKey: 'invalid-schema' };
  const column = f.metadata.tables.find(table => table.name === '物资配置表').columns.find(c => c.name === '阈值启用');
  column.type = 'single-select'; column.data = { options: [{ name: '未知状态' }] };
  await assert.rejects(f.workflow.createInventory(admin, body), { statusCode: 409 }); assert.equal(f.writes.length, 0);
  f.state.pendingRecovery = true;
  await assert.rejects(f.workflow.changeAvailability(admin, 'synthetic-stickers', { availability: 'disabled', reason: '检修', idempotencyKey: 'pending-stop' }), { statusCode: 409 });
  assert.equal(f.writes.length, 0);
});

test('lost acknowledgement only reconciles the exact stock row, not a row with changed notes or destination', async t => {
  const f = await fixture(t), append = f.client.appendRow;
  f.client.appendRow = async (table, row) => {
    const result = await append(table, row);
    if (table === '物资流水表') { f.data[table].find(r => r._id === result._id)['流转去向'] = '冲突内容'; throw Error('Synthetic unknown acknowledgement'); }
    return result;
  };
  const body = { assetCode: 'NJU-RC-synthetic-stickers', operation: '入库', quantity: 1, note: '合成采购', idempotencyKey: 'conflicting-ack' };
  await assert.rejects(f.workflow.transaction(admin, body), { code: 'materials_write_uncertain' });
  await assert.rejects(f.workflow.transaction(admin, body), { statusCode: 409 });
  assert.equal(f.data['物资流水表'].filter(row => row['幂等键'] === body.idempotencyKey).length, 1);
});

test('truncated rows and corrupted or duplicate registration records fail closed', async t => {
  const f = await fixture(t); f.state.truncated = '物资管理'; await assert.rejects(f.workflow.listLoans(owner)); f.state.truncated = '';
  await f.workflow.submit(owner, input); f.data[MATERIAL_WORKFLOW_TABLE][0]['摘要'] = 'corrupt'; await assert.rejects(f.workflow.list(owner), { statusCode: 503 });
});

test('formal stock transactions reject invalid input before recording an uncertain write and preserve pending-recovery guards', async t => {
  const f = await fixture(t), body = { assetCode: 'NJU-RC-synthetic-stickers', operation: '入库', quantity: 1, note: '补货', idempotencyKey: 'valid-after-error' };
  await assert.rejects(f.workflow.transaction(admin, { ...body, quantity: -1 }), { statusCode: 400 });
  f.state.pendingRecovery = true; await assert.rejects(f.workflow.transaction(admin, body), { statusCode: 409 }); f.state.pendingRecovery = false;
  const result = await f.workflow.transaction(admin, body); assert.ok(result.flowId);
  assert.equal(f.data['物资流水表'].filter(row => row['幂等键'] === body.idempotencyKey).length, 1);
});

test('schema preview never writes; explicit additions preserve other tables and never call row mutations', async () => {
  const metadata = { tables: [{ name: '其他部门表', _id: 'other', columns: [{ name: '原列', type: 'text' }] }] }, calls = [];
  const client = { dtableUuid: 'synthetic-business', getMetadata: async () => structuredClone(metadata),
    addTable: async (name, _language, columns) => { calls.push(name); metadata.tables.push({ name, columns: columns.map(c => ({ name: c.column_name, type: c.column_type })) }); } };
  assert.equal((await ensureMaterialWorkflowSchema(client, { expectedUuid: 'synthetic-business' })).apply, false); assert.equal(calls.length, 0);
  await assert.rejects(ensureMaterialWorkflowSchema(client, { expectedUuid: 'wrong' }));
  await assert.rejects(ensureMaterialWorkflowSchema(client, { expectedUuid: 'synthetic-business', apply: true }));
  const result = await ensureMaterialWorkflowSchema(client, { expectedUuid: 'synthetic-business', apply: true, confirmation: 'ADD-MATERIALS-WORKFLOW' });
  assert.equal(result.existingColumnsPreserved, true); assert.deepEqual(calls, [MATERIAL_WORKFLOW_TABLE]);
});
