import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createMaterialsFixtures } from '../lib/materials/fixtures.js';
import { createMaterialsSandbox } from '../lib/materials/local-sandbox.js';
import { createMaterialsService, MATERIAL_TABLES } from '../lib/materials/service.js';
import { createPreviewLifecycle } from '../lib/materials/preview-lifecycle.js';
import { createLocalMovements } from '../lib/materials/local-movements.js';
import { createMaterialsSourceReader, MATERIAL_TEST_BASE } from '../lib/materials/source-reader.js';
import { createPreviewServer } from '../scripts/preview-materials.mjs';
import { movementApplications } from '../public/app/console/materials-model.js';

const kit = 'NJU-RC-synthetic-kit';
const photo = new File([Buffer.from('synthetic-photo')], 'test.png', { type: 'image/png' });
async function localFixture() {
  const original = createMaterialsFixtures();
  const input = { tables: (await original.client.getMetadata()).tables, rows: original.snapshot() };
  const store = createMaterialsSandbox(input);
  const core = createMaterialsService({ client: store.client, listRows: store.listRows, uploadPhoto: async () => '/api/preview/photos/test' });
  const service = createPreviewLifecycle({ service: core, fixture: store, seedDisabled: false });
  return { original, input, store, service, move: createLocalMovements(service) };
}
const inbound = (overrides = {}) => ({ direction: 'in', reason: '采购', assetCode: kit, quantity: 3,
  reference: '合成采购单', idempotencyKey: 'in:one', ...overrides });
const outbound = (overrides = {}) => ({ direction: 'out', reason: '借用备货', assetCode: kit, quantity: 2,
  applicationId: 'synthetic-approved', reference: '核对申请后放到合成领取点', idempotencyKey: 'out:one', ...overrides });

test('purchase, preparation and return share a ledger while remote snapshot and original stay unchanged', async () => {
  const f = await localFixture(), before = structuredClone(f.input);
  assert.equal((await f.service.scan(kit)).item.quantity, 10);
  assert.equal((await f.move(inbound())).item.quantity, 13);
  const checked = await f.move(outbound(), photo);
  assert.equal(checked.item.quantity, 11); assert.equal(checked.application.checkoutQuantity, 2);
  const returned = await f.move(inbound({ reason: '借用归还', quantity: 1, lossQuantity: 1,
    applicationId: 'synthetic-approved', idempotencyKey: 'return:one' }));
  assert.equal(returned.item.quantity, 12); assert.equal(returned.application.outstandingQuantity, 0);
  assert.equal(returned.application.lossQuantity, 1);
  assert.deepEqual(f.input, before); assert.deepEqual(f.original.snapshot(), before.rows);
});

test('duplicate preparation and returns never deduct or add twice, including all-loss return', async () => {
  const f = await localFixture();
  const first = await f.move(outbound(), photo), repeat = await f.move(outbound(), photo);
  assert.equal(first.item.quantity, 8); assert.equal(repeat.item.quantity, 8); assert.equal(repeat.duplicate, true);
  const body = inbound({ reason: '借用归还', quantity: 0, lossQuantity: 2, applicationId: 'synthetic-approved', idempotencyKey: 'loss:one' });
  assert.equal((await f.move(body)).item.quantity, 8);
  assert.equal((await f.move(body)).duplicate, true);
});

test('record-first registration moves an approved loan to borrowed and restores stock on full return', async () => {
  const f = await localFixture();
  const approved = (await f.service.overview()).applications;
  assert.ok(movementApplications(approved, null, '借用备货').some(row => row.id === 'synthetic-approved'));
  const checkout = await f.move(outbound(), photo);
  assert.equal(checkout.application.status, '借出（物资）');
  assert.equal(checkout.item.quantity, 8);
  const borrowed = (await f.service.overview()).applications;
  assert.ok(!movementApplications(borrowed, null, '借用备货').some(row => row.id === 'synthetic-approved'));
  assert.ok(movementApplications(borrowed, null, '借用归还').some(row => row.id === 'synthetic-approved'));
  const returned = await f.move(inbound({ reason: '借用归还', quantity: 2, applicationId: 'synthetic-approved', idempotencyKey: 'full-return' }));
  assert.equal(returned.application.status, '已归还');
  assert.equal(returned.item.quantity, 10);
  assert.ok(!movementApplications((await f.service.overview()).applications, null, '借用归还').some(row => row.id === 'synthetic-approved'));
});

test('return cannot be ordinary restock, use another asset, exceed the loan, or settle unverified history', async () => {
  const f = await localFixture();
  await f.move(outbound(), photo);
  await assert.rejects(f.move(inbound({ applicationId: 'synthetic-approved' })), /不能代替借用/);
  await assert.rejects(f.move(inbound({ reason: '借用归还' })), /原借用申请/);
  await assert.rejects(f.move(inbound({ reason: '借用归还', applicationId: 'synthetic-approved', quantity: 3 })), /不能超过/);
  await assert.rejects(f.move(inbound({ reason: '借用归还', applicationId: 'synthetic-approved', assetCode: 'NJU-RC-synthetic-pressure', quantity: 1 })), /原出库资产/);
  assert.equal((await f.service.scan(kit)).item.quantity, 8);
});

test('invalid reasons, zero movements, missing evidence and excess stock are rejected before ledger changes', async () => {
  const f = await localFixture(), before = f.store.snapshot();
  for (const body of [inbound({ direction: 'out' }), inbound({ direction: 'constructor' }), inbound({ reason: '错误' }), inbound({ quantity: 0 }),
    inbound({ quantity: 1.2 }), inbound({ lossQuantity: 1 }), inbound({ idempotencyKey: '' }), inbound({ reference: '' }), inbound({ operation: '入库' })])
    await assert.rejects(f.move(body));
  await assert.rejects(f.move(outbound()), /照片/);
  await assert.rejects(f.move(outbound({ quantity: 11 }), photo), /库存/);
  assert.deepEqual(f.store.snapshot(), before);
});

test('consumption requires a destination and does not create or settle a loan', async () => {
  const f = await localFixture();
  const result = await f.move(outbound({ reason: '消耗', applicationId: '', reference: '合成宣传活动消耗' }));
  assert.equal(result.item.quantity, 8);
  const rows = f.store.snapshot();
  const flow = rows[MATERIAL_TABLES.flows].find(row => row._id === result.flowId);
  assert.equal(flow['申请单ID'], ''); assert.equal(flow['流转去向'], '合成宣传活动消耗');
  assert.equal(rows[MATERIAL_TABLES.applications].find(row => row._id === 'synthetic-approved')['状态'], '开始');
});

test('return picker filters by original asset and excludes settled, pending sync or unverified loans', () => {
  const borrowed = { id: 'one', assetCode: kit, checkoutQuantity: 2, status: '借出（物资）', returned: false, returnProgress: 'not-returned' };
  const applications = [borrowed, { ...borrowed, id: 'other', assetCode: 'NJU-RC-other' },
    { ...borrowed, id: 'settled', returned: true }, { ...borrowed, id: 'sync', syncPending: true }, { ...borrowed, id: 'history', returnProgress: 'unverified' }];
  assert.deepEqual(movementApplications(applications, { code: kit }, '借用归还').map(row => row.id), ['one']);
});

test('source snapshot follows full pagination, and no API calls follow local writes', async () => {
  const source = createMaterialsFixtures(), sourceRows = source.snapshot(), metadata = await source.client.getMetadata();
  sourceRows[MATERIAL_TABLES.inventory] = Array.from({ length: 101 }, (_, index) => ({ _id: `item-${index}`, 物资名称: '合成物资', 现有数量: 10, 初始数量: 10 }));
  const before = structuredClone(sourceRows), calls = [];
  const reader = createMaterialsSourceReader({ server: 'https://table.nju.edu.cn', token: 'test-private', fetcher: async (url, options) => {
    calls.push({ url, method: options.method });
    const parsed = new URL(url);
    const payload = parsed.pathname.includes('app-access-token') ? { dtable_uuid: MATERIAL_TEST_BASE, access_token: 'test-private-access', use_api_gateway: true }
      : parsed.pathname.endsWith('/metadata/') ? { metadata }
      : { rows: sourceRows[parsed.searchParams.get('table_name')].slice(Number(parsed.searchParams.get('start')), Number(parsed.searchParams.get('start')) + 100) };
    return new Response(JSON.stringify(payload));
  } });
  const captured = await reader.snapshot();
  assert.equal(captured.rows[MATERIAL_TABLES.inventory].length, 101);
  const requestCount = calls.length, store = createMaterialsSandbox(captured);
  const core = createMaterialsService({ client: store.client, listRows: store.listRows });
  await core.transaction({ assetCode: 'NJU-RC-item-100', operation: '入库', quantity: 5, idempotencyKey: 'last-page' });
  assert.equal((await core.scan('NJU-RC-item-100')).item.quantity, 15);
  assert.equal(calls.length, requestCount); assert.ok(calls.every(call => call.method === 'GET'));
  assert.deepEqual(sourceRows, before); assert.doesNotMatch(JSON.stringify(captured), /test-private/);
});

test('snapshot rejects missing tables, repeated pagination and truncation instead of inventing data', async () => {
  const fixture = createMaterialsFixtures(), metadata = await fixture.client.getMetadata();
  const build = rowCount => createMaterialsSourceReader({ server: 'https://table.nju.edu.cn', token: 'test-only', fetcher: async url => {
    const payload = String(url).includes('app-access-token') ? { dtable_uuid: MATERIAL_TEST_BASE, access_token: 'test-only', use_api_gateway: true }
      : String(url).includes('metadata') ? { metadata }
      : { rows: Array.from({ length: rowCount }, (_, index) => ({ _id: `repeated-${index}` })) };
    return new Response(JSON.stringify(payload));
  } });
  await assert.rejects(build(100).snapshot(), { code: 'snapshot_incomplete' });
  await assert.rejects(build(3).snapshot({ maxRows: 2 }), { code: 'snapshot_incomplete' });
  assert.throws(() => createMaterialsSandbox({ tables: metadata.tables, rows: {} }), /缺少/);
});

test('HTTP movements stay local with session and CSRF guards and read-only source labeling', async t => {
  const f = await localFixture(), before = structuredClone(f.input);
  const server = await createPreviewServer({ fixture: f.store, seedSyncFailure: false, sourceInfo: { capturedAt: 'test', counts: {} } });
  server.listen(0); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/auth/session`), cookie = response.headers.get('set-cookie').split(';')[0], session = await response.json();
  assert.equal(session.preview.synthetic, false); assert.equal(session.preview.remoteWrites, false);
  const url = `${origin}/api/preview/materials/movements`;
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(inbound()) })).status, 403);
  headers['X-CSRF-Token'] = session.csrfToken;
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://other.invalid' }, body: JSON.stringify(inbound()) })).status, 403);
  const recorded = await fetch(url, { method: 'POST', headers, body: JSON.stringify(inbound()) });
  assert.equal(recorded.status, 201); assert.equal((await recorded.json()).item.quantity, 13);
  const overview = await (await fetch(`${origin}/api/materials/overview`, { headers: { Cookie: cookie } })).json();
  assert.equal(overview.inventory.find(item => item.code === kit).quantity, 13);
  assert.deepEqual(f.input, before);
  const schema = await (await fetch(`${origin}/api/materials/schema`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(schema.capabilities.stockMovements, { mode: 'local-only', remoteWrites: false });
  await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers, body: '{}' });
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(inbound()) })).status, 401);
});
