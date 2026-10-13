import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createMaterialsFixtures, FIXTURE_TABLES } from '../lib/materials/fixtures.js';
import { createMaterialsService } from '../lib/materials/service.js';
import { createPreviewLifecycle } from '../lib/materials/preview-lifecycle.js';
import { createLocalMaterialsPortal } from '../lib/materials/local-portal.js';
import { createPreviewServer } from '../scripts/preview-materials.mjs';

const member = { id: 'owner', memberCode: 'local-member' }, other = { id: 'other' }, admin = { id: 'admin', canReview: true };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const photo = () => new File([png], 'return.png', { type: 'image/png' });
const submit = overrides => ({ applicationId: 'synthetic-partial', quantity: 1, note: '分次归还', idempotencyKey: 'return-one', ...overrides });
const approve = { action: 'approve', revision: 1, physicalChecked: true };
async function fixtureFor(actor = member) {
  const fixture = createMaterialsFixtures();
  await fixture.client.updateRow(FIXTURE_TABLES.applications, 'synthetic-partial', { 本地申请人: actor.id });
  await fixture.client.updateRow(FIXTURE_TABLES.flows, 'synthetic-return-kit', { 损耗数量: 0 });
  return fixture;
}
async function setup() {
  const fixture = await fixtureFor();
  const core = createMaterialsService({ client: fixture.client, listRows: fixture.listRows, uploadPhoto: async () => 'local-photo' });
  const service = createPreviewLifecycle({ service: core, fixture });
  const portal = createLocalMaterialsPortal({ service, fixture });
  const stock = async () => (await service.overview()).inventory.find(item => item.id === 'synthetic-kit').quantity;
  return { fixture, service, portal, returns: portal.returns, stock };
}

test('return lists only owned, verifiable outstanding loans, including after membership changes', async () => {
  const { returns, fixture } = await setup();
  assert.equal((await returns.listLoans({ id: member.id })).loans.length, 1);
  assert.equal((await returns.listLoans(other)).loans.length, 0);
  await assert.rejects(returns.listLoans(null), { statusCode: 401 });
  await assert.rejects(returns.submit(other, submit(), photo()), { statusCode: 404 });
  await fixture.client.updateRow(FIXTURE_TABLES.applications, 'synthetic-pending', { 本地申请人: member.id });
  await assert.rejects(returns.submit(member, submit({ applicationId: 'synthetic-pending' }), photo()), { statusCode: 409 });
  await fixture.client.updateRow(FIXTURE_TABLES.flows, 'synthetic-out-kit', { 数量: 4.5 });
  assert.equal((await returns.listLoans(member)).loans.length, 0);
  await assert.rejects(returns.submit(member, submit(), photo()), { statusCode: 409 });
});
test('return submission keeps stock unchanged, isolates evidence and rejects conflicting retries', async () => {
  const { returns, stock } = await setup(), before = await stock();
  const first = await returns.submit(member, submit(), photo());
  assert.equal(await stock(), before);
  assert.equal((await returns.submit(member, submit(), photo())).duplicate, true);
  assert.equal(returns.list(other).records.length, 0);
  assert.throws(() => returns.photo(other, first.record.id), { statusCode: 404 });
  assert.deepEqual(returns.photo(member, first.record.id).bytes, png);
  assert.deepEqual(returns.photo(admin, first.record.id).bytes, png);
  await assert.rejects(returns.submit(member, submit({ quantity: 2 }), photo()), { statusCode: 409 });
  await assert.rejects(returns.submit(member, submit(), new File(['different'], 'changed.png', { type: 'image/png' })), { statusCode: 409 });
  await assert.rejects(returns.submit(member, submit({ idempotencyKey: 'another' }), photo()), /待核对/);
});
test('return validates quantities, photo and original loan; purchase inbound is administrator-only', async () => {
  const { returns, portal } = await setup();
  await assert.rejects(returns.submit(member, submit({ quantity: 1.5 }), photo()), { statusCode: 400 });
  await assert.rejects(returns.submit(member, submit({ quantity: 999 }), photo()), { statusCode: 409 });
  const noPhoto = await returns.submit(member, submit({ idempotencyKey: 'no-photo' }), null);
  assert.equal(noPhoto.record.photoUrl, null);
  await assert.rejects(returns.submit(member, submit(), new File(['x'], 'x.pdf', { type: 'application/pdf' })), { statusCode: 400 });
  await assert.rejects(returns.submit(member, submit(), new File([Buffer.alloc(8 * 1024 * 1024 + 1)], 'x.png', { type: 'image/png' })), { statusCode: 413 });
  await assert.rejects(returns.submit(member, submit({ applicationId: 'synthetic-overdue' }), photo()), { statusCode: 404 });
  assert.throws(() => portal.returns.review(member, 'missing', approve), { statusCode: 403 });
  await assert.rejects(portal.submitInbound(member, {}), { statusCode: 403 });
});
test('physical verification credits partial returns once, supports disabled assets and full settlement', async () => {
  const { returns, service, stock } = await setup(), before = await stock();
  const request = await returns.submit(member, submit(), photo());
  await assert.rejects(returns.review(admin, request.record.id, { action: 'approve', revision: 1 }), /实物/);
  await service.changeAvailability('synthetic-kit', { availability: 'disabled', reason: '维修', idempotencyKey: 'disable' });
  const result = await returns.review(admin, request.record.id, approve);
  assert.equal(result.record.status, 'approved'); assert.equal(await stock(), before + 1);
  await assert.rejects(returns.review(admin, request.record.id, approve), { statusCode: 409 });
  const loan = (await returns.listLoans(member)).loans[0];
  const rest = await returns.submit(member, submit({ quantity: loan.outstanding, idempotencyKey: 'rest' }), photo());
  await returns.review(admin, rest.record.id, approve);
  assert.equal((await returns.listLoans(member)).loans.length, 0);
});
test('a return without a photo still requires physical verification and credits inventory exactly once', async () => {
  const { returns, stock, service } = await setup(), before = await stock();
  const result = await returns.submit(member, submit(), null);
  assert.equal(result.record.photoUrl, null);
  assert.equal(await stock(), before);
  assert.equal((await returns.submit(member, submit(), null)).duplicate, true);
  assert.throws(() => returns.photo(admin, result.record.id), { statusCode: 404 });
  await assert.rejects(returns.review(admin, result.record.id, { action: 'approve', revision: 1 }), /实物/);
  assert.throws(() => returns.review(other, result.record.id, approve), { statusCode: 403 });
  await returns.review(admin, result.record.id, approve);
  assert.equal(await stock(), before + 1);
  await assert.rejects(returns.review(admin, result.record.id, approve), { statusCode: 409 });
  const flow = (await service.overview()).recentFlows.find(item => item.id === returns.list(member).records[0].flowId);
  assert.ok(flow);
  assert.equal(await stock(), before + 1);
});
test('rejection and competing administrator return do not double-credit inventory', async () => {
  const { returns, service, stock } = await setup(), before = await stock();
  const first = await returns.submit(member, submit(), photo());
  await assert.rejects(returns.review(admin, first.record.id, { action: 'reject', revision: 1 }), { statusCode: 400 });
  await returns.review(admin, first.record.id, { action: 'reject', revision: 1, note: '数量不一致' });
  assert.equal(await stock(), before);
  const loan = (await returns.listLoans(member)).loans[0];
  const next = await returns.submit(member, submit({ quantity: loan.outstanding, idempotencyKey: 'retry' }), photo());
  await service.applicationAction(loan.id, 'return', { assetCode: loan.assetCode, quantity: loan.outstanding, idempotencyKey: 'manual' }, photo());
  await assert.rejects(returns.review(admin, next.record.id, approve), /已结清/);
  assert.equal(await stock(), before + loan.outstanding);
});
test('pending return synchronization recovers using the same flow, without another stock credit', async () => {
  const { returns, fixture, stock } = await setup(), before = await stock();
  const first = await returns.submit(member, submit(), photo());
  fixture.failNextUpdate(FIXTURE_TABLES.applications, first.record.applicationId);
  const pending = await returns.review(admin, first.record.id, approve);
  assert.equal(pending.syncPending, true); assert.equal(await stock(), before + 1);
  await assert.rejects(returns.review(admin, first.record.id, { action: 'reject', revision: 1, note: '取消' }), /只能重试/);
  const recovered = await returns.review(admin, first.record.id, approve);
  assert.equal(recovered.record.status, 'approved'); assert.equal(recovered.record.flowId, pending.record.flowId);
  assert.equal(await stock(), before + 1);
});
test('HTTP return multipart, private photo, CSRF and administrator routes enforce boundaries', async t => {
  const fixture = await fixtureFor();
  const server = await createPreviewServer({ fixture, seedSyncFailure: false, portalActor: member });
  server.listen(0); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(root + '/api/auth/session'), cookie = session.headers.get('set-cookie').split(';')[0], data = await session.json();
  const form = () => { const f = new FormData(); Object.entries(submit()).forEach(([k, v]) => f.set(k, String(v))); f.set('photo', photo()); return f; };
  assert.equal((await fetch(root + '/api/public/materials/returns', { method: 'POST', headers: { Cookie: cookie }, body: form() })).status, 403);
  const response = await fetch(root + '/api/public/materials/returns', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': data.csrfToken }, body: form() });
  assert.equal(response.status, 201); const result = await response.json();
  const image = await fetch(root + result.record.photoUrl, { headers: { Cookie: cookie } });
  assert.equal(image.headers.get('cache-control'), 'no-store'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal((await fetch(root + '/api/preview/materials/returns', { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await fetch(root + '/api/public/materials/inbound', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': data.csrfToken }, body: '{}' })).status, 403);
});
