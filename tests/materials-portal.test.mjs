import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createMaterialsFixtures, FIXTURE_TABLES } from '../lib/materials/fixtures.js';
import { createMaterialsService } from '../lib/materials/service.js';
import { createPreviewLifecycle } from '../lib/materials/preview-lifecycle.js';
import { createLocalMaterialsPortal } from '../lib/materials/local-portal.js';
import { createPreviewServer } from '../scripts/preview-materials.mjs';
import { readActivitySource, ACTIVITY_TEST_BASE } from '../lib/materials/activity-source.js';
import { createLocalReimbursementService } from '../lib/reimbursements/local-service.js';

const member = { id: 'user-a', memberCode: 'local-member', redCrossDepartment: '工作组主任团' }, admin = { id: 'admin', canReview: true };
function setup() {
  const fixture = createMaterialsFixtures();
  const core = createMaterialsService({ client: fixture.client, listRows: fixture.listRows, uploadPhoto: async () => 'local-photo', today: () => '2026-10-08' });
  const service = createPreviewLifecycle({ service: core, fixture });
  return { fixture, service, portal: createLocalMaterialsPortal({ service, fixture,
    membershipFor: async actor => ({ status: 'verified', department: actor.id === member.id ? member.redCrossDepartment : '' }) }) };
}
const borrow = overrides => ({ materialId: 'synthetic-kit', assetCode: 'NJU-RC-synthetic-kit', quantity: 2,
  name: '测试申请人', studentId: 'LOCAL-TEST', email: 'test@example.invalid', purpose: '合成活动', consent: true,
  plannedBorrowDate: '2026-10-08', plannedReturnDate: '2026-10-10', idempotencyKey: 'borrow-key', ...overrides });
const inbound = overrides => ({ materialId: 'synthetic-kit', assetCode: 'NJU-RC-synthetic-kit', quantity: 3,
  location: '合成A柜1层', source: '采购', note: '合成采购', idempotencyKey: 'inbound-key', ...overrides });

test('catalog exposes only inventory fields and omits disabled material', async () => {
  const { portal, service } = setup();
  const before = await portal.catalog();
  assert.equal(before.length, 5);
  assert.deepEqual(Object.keys(before[0]).sort(), ['id', 'assetCode', 'name', 'unit', 'remaining', 'location', 'approvalMode'].sort());
  const code = before[0].assetCode;
  await service.transaction({ operation: '入库', assetCode: code, quantity: 2, idempotencyKey: 'stock' });
  assert.equal((await portal.catalog())[0].remaining, before[0].remaining + 2);
});
test('borrow stores stable identity, retains exact quantities, and only appends once', async () => {
  const { portal, fixture, service } = setup();
  const original = fixture.snapshot();
  const first = await portal.borrow(member, borrow());
  assert.equal((await portal.borrow(member, borrow())).duplicate, true);
  assert.equal(fixture.snapshot()[FIXTURE_TABLES.applications].length, original[FIXTURE_TABLES.applications].length + 1);
  assert.equal((await service.overview()).applications.find(item => item.id === first.request.id).requestedAssetCode, 'NJU-RC-synthetic-kit');
  assert.deepEqual(fixture.snapshot()[FIXTURE_TABLES.inventory], original[FIXTURE_TABLES.inventory]);
  await service.reviewApplication(first.request.id, true, {});
  await assert.rejects(service.applicationAction(first.request.id, 'checkout', { assetCode: 'NJU-RC-synthetic-speaker', quantity: 2, idempotencyKey: 'wrong' }, {}), /类别码一致/);
  await assert.rejects(service.applicationAction(first.request.id, 'checkout', { assetCode: 'NJU-RC-synthetic-kit', quantity: 1, idempotencyKey: 'wrong-qty' }, {}), /申请件数一致/);
  await service.applicationAction(first.request.id, 'checkout', { assetCode: 'NJU-RC-synthetic-kit', quantity: 2, idempotencyKey: 'correct' }, {});
  assert.equal((await service.overview()).inventory.find(item => item.id === 'synthetic-kit').quantity, (await setup().portal.catalog())[0].remaining - 2);
});
test('borrow rejects identity spoof, disabled items, fractional amounts and changed retries', async () => {
  const { portal } = setup();
  await assert.rejects(portal.borrow({ id: 'no-member' }, borrow()), { statusCode: 403 });
  await assert.rejects(portal.borrow(member, borrow({ assetCode: 'NJU-RC-synthetic-speaker' })), { statusCode: 409 });
  await assert.rejects(portal.borrow(member, borrow({ materialId: 'synthetic-tent', assetCode: 'NJU-RC-synthetic-tent' })), { statusCode: 409 });
  await assert.rejects(portal.borrow(member, borrow({ quantity: 1.5 })), { statusCode: 400 });
  await portal.borrow(member, borrow());
  await assert.rejects(portal.borrow(member, borrow({ quantity: 3 })), { statusCode: 409 });
});

test('vest borrowing is server-approved once, skips manual queue and still follows checkout/return stock accounting', async () => {
  const { portal, fixture, service } = setup();
  await fixture.client.updateRow(FIXTURE_TABLES.inventory, 'synthetic-kit', { 物资名称: '马甲' });
  const before = fixture.snapshot(), available = (await portal.catalog())[0];
  assert.equal(available.approvalMode, 'automatic');
  const [first, repeat] = await Promise.all([portal.borrow(member, borrow()), portal.borrow(member, borrow())]);
  assert.equal(first.request.approvalMode, 'automatic'); assert.equal(repeat.duplicate, true);
  const row = fixture.snapshot()[FIXTURE_TABLES.applications].find(item => item._id === first.request.id);
  assert.equal(row['借出审批'], '审批通过'); assert.equal(row['审批方式'], '自动通过'); assert.ok(row['审批时间']);
  assert.equal(fixture.snapshot()[FIXTURE_TABLES.applications].length, before[FIXTURE_TABLES.applications].length + 1);
  assert.deepEqual(fixture.snapshot()[FIXTURE_TABLES.flows], before[FIXTURE_TABLES.flows]);
  const overview = await service.overview();
  assert.equal(overview.pending.some(item => item.id === first.request.id), false);
  assert.equal(overview.applications.find(item => item.id === first.request.id).approvalMode, 'automatic');
  await assert.rejects(service.reviewApplication(first.request.id, true, {}), /只能审批待审批/);
  await assert.rejects(service.applicationAction(first.request.id, 'checkout', { assetCode: available.assetCode, quantity: 2, idempotencyKey: 'vest-checkout' }, null), /照片/);
  await service.applicationAction(first.request.id, 'checkout', { assetCode: available.assetCode, quantity: 2, idempotencyKey: 'vest-checkout' }, {});
  assert.equal((await portal.catalog())[0].remaining, available.remaining - 2);
  assert.equal((await portal.returns.listLoans(member)).loans[0].id, first.request.id);
  await service.applicationAction(first.request.id, 'return', { assetCode: available.assetCode, quantity: 2, idempotencyKey: 'vest-return' }, {});
  assert.equal((await portal.catalog())[0].remaining, available.remaining);
});

test('automatic vest approval retains membership, stock, identity and quantity checks', async () => {
  const { portal, fixture } = setup();
  await fixture.client.updateRow(FIXTURE_TABLES.inventory, 'synthetic-kit', { 物资名称: '马甲' });
  const before = fixture.snapshot()[FIXTURE_TABLES.applications].length;
  await assert.rejects(portal.borrow({ id: 'no-member' }, borrow()), { statusCode: 403 });
  await assert.rejects(portal.borrow(member, borrow({ quantity: 999 })), { statusCode: 409 });
  await assert.rejects(portal.borrow(member, borrow({ quantity: 1.5 })), { statusCode: 400 });
  await assert.rejects(portal.borrow(member, borrow({ assetCode: 'NJU-RC-synthetic-speaker' })), { statusCode: 409 });
  await assert.rejects(portal.borrow(member, borrow({ consent: false })), { statusCode: 400 });
  await fixture.client.updateRow(FIXTURE_TABLES.inventory, 'synthetic-tent', { 物资名称: '马甲' });
  await assert.rejects(portal.borrow(member, borrow({ materialId: 'synthetic-tent', assetCode: 'NJU-RC-synthetic-tent' })), { statusCode: 409 });
  assert.equal(fixture.snapshot()[FIXTURE_TABLES.applications].length, before);
});

test('client-supplied vest name or approval mode cannot bypass another material approval', async () => {
  const { portal, fixture, service } = setup();
  const result = await portal.borrow(member, borrow({ items: '马甲', approvalMode: 'automatic', approval: '审批通过' }));
  assert.equal(result.request.approvalMode, 'manual'); assert.equal(result.request.status, '待审批');
  await assert.rejects(service.applicationAction(result.request.id, 'checkout', { assetCode: 'NJU-RC-synthetic-kit', quantity: 2, idempotencyKey: 'spoof' }, {}), /先通过审批/);
  await fixture.client.updateRow(FIXTURE_TABLES.inventory, 'synthetic-kit', { 物资名称: '马甲收纳袋' });
  const bag = await portal.borrow(member, borrow({ idempotencyKey: 'bag' }));
  assert.equal(bag.request.approvalMode, 'manual');
});
test('inbound requires physical review, owner isolation and cannot double-increase stock', async () => {
  const { portal, service } = setup();
  const before = (await portal.catalog())[0].remaining;
  const request = await portal.submitInbound(admin, inbound());
  assert.equal((await portal.catalog())[0].remaining, before);
  assert.equal((await portal.submitInbound(admin, inbound())).duplicate, true);
  assert.equal(portal.listInbound({ id: 'other', memberCode: 'member' }).records.length, 0);
  assert.throws(() => portal.reviewInbound(member, request.record.id, {}), { statusCode: 403 });
  await assert.rejects(portal.reviewInbound(admin, request.record.id, { action: 'approve', revision: 1 }), /实物/);
  const approved = await portal.reviewInbound(admin, request.record.id, { action: 'approve', revision: 1, physicalChecked: true });
  assert.equal((await portal.catalog())[0].remaining, before + 3);
  assert.equal(approved.record.status, 'approved');
  await assert.rejects(portal.reviewInbound(admin, request.record.id, { action: 'approve', revision: 1, physicalChecked: true }), { statusCode: 409 });
  assert.equal((await service.listFlows(new URLSearchParams({ assetCode: 'NJU-RC-synthetic-kit' }))).flows.filter(item => item.operation === '入库').length, 1);
});
test('inbound cannot conceal a loan return and rejection leaves stock intact', async () => {
  const { portal } = setup(); const before = (await portal.catalog())[0].remaining;
  await assert.rejects(portal.submitInbound(admin, inbound({ source: '借用归还' })), { statusCode: 400 });
  const result = await portal.submitInbound(admin, inbound());
  await assert.rejects(portal.reviewInbound(admin, result.record.id, { action: 'reject', revision: 1 }), { statusCode: 400 });
  await portal.reviewInbound(admin, result.record.id, { action: 'reject', revision: 1, note: '实物不一致' });
  assert.equal((await portal.catalog())[0].remaining, before);
});
test('HTTP public reads are available anonymously; writes require session, CSRF and reviewer', async t => {
  const server = await createPreviewServer({ seedSyncFailure: false, signedIn: false, portalActor: { ...member, canReview: false } });
  server.listen(0); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${root}/api/public/materials/catalog`)).status, 200);
  const guest = await fetch(`${root}/api/auth/session`), cookie = guest.headers.get('set-cookie').split(';')[0];
  const request = (path, body, token) => fetch(root + path, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) }, body: JSON.stringify(body) });
  assert.equal((await request('/api/public/materials/requests', borrow())).status, 401);
  const signed = await (await request('/api/auth/login', {})).json();
  assert.equal((await request('/api/public/materials/requests', borrow())).status, 403);
  assert.equal((await request('/api/public/materials/requests', borrow(), signed.csrfToken)).status, 201);
  assert.equal((await request('/api/preview/materials/inbound/missing/review', {}, signed.csrfToken)).status, 403);
  assert.equal((await fetch(root + '/api/materials/overview', { headers: { Cookie: cookie } })).status, 403);
});
test('activity source makes GET requests only, paginates definitions and projects no personal fields', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    const path = new URL(url);
    let body;
    if (path.pathname.includes('app-access-token')) body = { dtable_uuid: ACTIVITY_TEST_BASE, access_token: 'test-only', use_api_gateway: true };
    else if (path.pathname.endsWith('/metadata/')) body = { metadata: { tables: [{ name: '登记审批' }] } };
    else { assert.equal(path.searchParams.get('table_name'), '登记审批'); const start = Number(path.searchParams.get('start'));
      body = { rows: Array.from({ length: start === 0 ? 100 : 1 }, (_, i) => ({ _id: `${start + i}`, 活动名称: '合成活动', 活动日期: '2026-10-08', 场地: '合成地点', 邮箱: 'private@example.invalid' })) }; }
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  const result = await readActivitySource({ token: 'test-only', fetcher });
  assert.equal(result.activities.length, 101); assert.equal(calls.every(call => call.method === 'GET'), true);
  assert.equal(JSON.stringify(result).includes('private@example.invalid'), false);
  await assert.rejects(readActivitySource({ token: 'test-only', fetcher: async () => new Response(JSON.stringify({ dtable_uuid: 'sensitive-base' })) }), { code: 'activity_source_failed' });
});
test('reimbursement preserves expense date, voucher note and activity identity through review/resubmission', async () => {
  const service = createLocalReimbursementService({ workflowVersion: 1, processFiles: async files => ({ merged: Buffer.from('synthetic'), sources: files.map(file => ({ name: file.name, checks: [] })), pageCount: 1 }) });
  await service.summaries.saveActivity(admin, { id: 'applications:synthetic', name: '合成活动' });
  const upload = async () => (await service.preprocess(member, [{ name: 'synthetic.pdf', bytes: Buffer.from('synthetic') }])).bundle.id;
  const body = { name: '测试', purpose: '活动材料', amount: '0.30', bundleId: await upload(), idempotencyKey: 'financial-one',
    activityId: 'applications:synthetic', expenseDate: '2026-10-08', voucherNote: '凭证对应第一项', expenseItems: [{ label: '甲', amount: '0.10' }, { label: '乙', amount: '0.20' }] };
  const result = await service.submit(member, body);
  assert.equal(result.request.amountCents, 30); assert.equal(result.request.activityName, '合成活动'); assert.equal(result.request.voucherNote, body.voucherNote);
  await assert.rejects(service.submit(member, { ...body, expenseDate: '2026-02-30', idempotencyKey: 'invalid' }), { statusCode: 400 });
  assert.equal(service.list({ id: 'other' }).requests.length, 0);
  await service.review(admin, result.request.id, { action: 'return', revision: 1, note: '补充原件' });
  const revised = await service.submit(member, { ...body, bundleId: await upload(), idempotencyKey: 'financial-two', voucherNote: '已补充' }, result.request.id);
  assert.equal(revised.request.voucherNote, '已补充'); assert.equal(revised.request.expenseDate, '2026-10-08');
});
