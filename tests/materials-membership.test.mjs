import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { MATERIAL_BORROW_EXCLUDED_DEPARTMENTS, materialBorrowEligibility } from '../lib/materials/membership-policy.js';
import { createMaterialMembershipReader, MEMBERSHIP_SOURCE_TABLE } from '../lib/materials/membership-source.js';
import { ACTIVITY_TEST_BASE } from '../lib/materials/activity-source.js';
import { createMaterialsFixtures } from '../lib/materials/fixtures.js';
import { createMaterialsService } from '../lib/materials/service.js';
import { createLocalMaterialsPortal } from '../lib/materials/local-portal.js';
import { createPreviewServer } from '../scripts/preview-materials.mjs';

const identity = { id: 'test-user', studentId: '123456789', emailVerified: true };
const request = { materialId: 'synthetic-kit', assetCode: 'NJU-RC-synthetic-kit', quantity: 1,
  name: '合成申请人', studentId: '123456789', email: 'test@example.test', purpose: '合成申请', consent: true,
  plannedBorrowDate: '2026-10-11', plannedReturnDate: '2026-10-12', idempotencyKey: 'membership-borrow' };
const sourceRows = [{ _id: 'source-a', 学号: identity.studentId, 部门: '主席团 & 指导组', 邮箱: 'private@example.test', 手机号: 'private-phone' }];
function source({ rows = sourceRows, auth = {}, metadata = null, rowPayload = null, failRows = false } = {}) {
  const calls = [];
  const reader = createMaterialMembershipReader({ token: 'fake-read-only-token', fetcher: async (input, options) => {
    const url = new URL(input); calls.push({ url, options });
    let payload;
    if (url.pathname.includes('app-access-token')) payload = { dtable_uuid: ACTIVITY_TEST_BASE, access_token: 'fake-access-token', use_api_gateway: true, ...auth };
    else if (url.pathname.endsWith('/metadata/')) payload = metadata || { metadata: { tables: [{ name: MEMBERSHIP_SOURCE_TABLE,
      columns: [{ name: '学号', type: 'text' }, { name: '部门', type: 'single-select' }] }] } };
    else {
      assert.equal(url.searchParams.get('table_name'), MEMBERSHIP_SOURCE_TABLE);
      assert.equal(url.searchParams.get('convert_keys'), 'true');
      assert.equal(url.searchParams.get('limit'), '100');
      if (failRows) throw new Error('fake-upstream-secret');
      const start = Number(url.searchParams.get('start'));
      payload = rowPayload || { rows: rows.slice(start, start + 100) };
    }
    return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
  } });
  return { reader, calls };
}
function local(membershipFor) {
  const fixture = createMaterialsFixtures();
  const service = createMaterialsService({ client: fixture.client, listRows: fixture.listRows });
  return { fixture, portal: createLocalMaterialsPortal({ service, fixture, membershipFor }) };
}

test('借用只排除普通志愿者（含苏州志愿者），其余红会成员部门均可申请', () => {
  assert.deepEqual(MATERIAL_BORROW_EXCLUDED_DEPARTMENTS, ['志愿者', '苏州志愿者']);
  for (const department of ['主席团 & 指导组', '综事中心主任团', '生命中心主任团', '博爱中心主任团', '工作组主任团', '博爱', '生命', '综事', '苏州'])
    assert.equal(materialBorrowEligibility({ status: 'verified', department }).eligible, true);
  for (const department of MATERIAL_BORROW_EXCLUDED_DEPARTMENTS)
    assert.equal(materialBorrowEligibility({ status: 'verified', department }).eligible, false);
  for (const department of ['', null, ['工作组主任团']])
    assert.equal(materialBorrowEligibility({ status: 'verified', department }).eligible, false);
  assert.equal(materialBorrowEligibility({ status: 'unverified', department: '工作组主任团' }).eligible, false);
});

test('只读个人主页资格匹配已验证账号学号，返回值不包含个人记录', async () => {
  const { reader, calls } = source();
  const result = await reader.membershipFor(identity);
  assert.deepEqual(result, { status: 'verified', department: '主席团 & 指导组' });
  assert.equal(calls.every(call => call.options.method === 'GET' && call.options.redirect === 'error'), true);
  assert.equal(calls.every(call => call.url.origin === 'https://table.nju.edu.cn'), true);
  assert.equal(JSON.stringify(result).includes(identity.studentId), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('token'), false);
});

test('未登录、未验证或无可靠学号时不访问远端，不能用院系、会员码替代部门', async () => {
  const { reader, calls } = source();
  for (const actor of [null, {}, { id: 'one' }, { ...identity, emailVerified: false }, { ...identity, studentId: 'not-an-id' }, { ...identity, studentId: 123456789 },
    { id: 'one', memberCode: 'member', department: '工作组主任团', canReview: true }])
    assert.equal((await reader.membershipFor(actor)).status, 'unverified');
  assert.equal(calls.length, 0);
});

test('资格分页完整读取，不按姓名猜测，也不从重复学号选取有利记录', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ _id: `other-${i}`, 学号: `88888${i}`, 姓名: '同名申请人', 部门: '志愿者' }));
  rows.push(...sourceRows);
  const { reader, calls } = source({ rows });
  assert.equal((await reader.membershipFor(identity)).status, 'verified');
  assert.deepEqual(calls.filter(call => call.url.pathname.endsWith('/rows/')).map(call => call.url.searchParams.get('start')), ['0', '100']);
  assert.equal((await source({ rows: rows.slice(0, 100) }).reader.membershipFor(identity)).status, 'unverified');
  rows.push({ _id: 'duplicate-student', 学号: identity.studentId, 部门: '志愿者' });
  assert.equal((await source({ rows }).reader.membershipFor(identity)).status, 'unverified');
});

test('错误 Base、外部接口和缺失部门字段均停止核验，不读取敏感账号库', async () => {
  for (const options of [{ auth: { dtable_uuid: 'sensitive-account-base' } },
    { auth: { use_api_gateway: false, dtable_server: 'https://external.example' } },
    { metadata: { tables: [{ name: MEMBERSHIP_SOURCE_TABLE, columns: [{ name: '学号', type: 'text' }, { name: '院系', type: 'text' }] }] } }]) {
    const { reader, calls } = source(options);
    await assert.rejects(reader.membershipFor(identity), { code: 'material_membership_source_failed' });
    assert.equal(calls.some(call => call.url.pathname.endsWith('/rows/')), false);
  }
});

test('无效分页、重复行号和来源故障拒绝核验，不泄漏错误详情', async () => {
  for (const options of [{ rowPayload: { rows: null } }, { rowPayload: { rows: [{ 学号: identity.studentId, 部门: '工作组主任团' }] } },
    { rows: [...sourceRows, ...sourceRows] }, { rowPayload: { rows: Array.from({ length: 101 }, (_, i) => ({ _id: `row-${i}` })) } }, { failRows: true }]) {
    await assert.rejects(source(options).reader.membershipFor(identity), error => {
      assert.equal(error.code, 'material_membership_source_failed');
      assert.equal(error.message.includes('secret'), false); return true;
    });
  }
});

test('红会成员无须 memberCode，提交仅追加本地申请、不扣库存', async () => {
  for (const department of ['主席团 & 指导组', '综事中心主任团', '生命中心主任团', '博爱中心主任团', '工作组主任团', '博爱', '生命', '综事', '苏州']) {
    const { fixture, portal } = local(async actor => ({ status: actor.id === identity.id ? 'verified' : 'unverified', department }));
    const before = fixture.snapshot();
    const result = await portal.borrow(identity, request);
    assert.equal(result.request.status, '待审批');
    assert.deepEqual(fixture.snapshot()['工位物资表'], before['工位物资表']);
    assert.equal(fixture.snapshot()['物资管理'].length, before['物资管理'].length + 1);
  }
});

test('非内部成员不能伪造部门、学号、会员码或管理员权限绕过后端', async () => {
  const { fixture, portal } = local(async () => ({ status: 'verified', department: '志愿者' }));
  const before = fixture.snapshot();
  const forgedActor = { ...identity, memberCode: 'member', canReview: true, department: '工作组主任团' };
  await assert.rejects(portal.borrow(forgedActor, { ...request, studentId: '999999999', department: '工作组主任团', redCrossDepartment: '工作组主任团', memberCode: 'member', canReview: true }), { statusCode: 403 });
  await fixture.client.updateRow('工位物资表', 'synthetic-kit', { 物资名称: '马甲' });
  await assert.rejects(portal.borrow(forgedActor, request), { statusCode: 403 });
  assert.deepEqual(fixture.snapshot()['物资管理'], before['物资管理']);
  assert.deepEqual(fixture.snapshot()['物资流水表'], before['物资流水表']);
});

test('部门变更后重复申请仍须核验，原借用人的归还列表继续可读', async () => {
  let department = '工作组主任团';
  const { fixture, portal } = local(async () => ({ status: 'verified', department }));
  const first = await portal.borrow(identity, request);
  department = '志愿者';
  await assert.rejects(portal.borrow(identity, request), { statusCode: 403 });
  assert.equal((await portal.returns.listLoans(identity)).ok, true);
  assert.equal(fixture.snapshot()['物资管理'].filter(row => row._id === first.request.id).length, 1);
});

test('无核验器和核验异常默认阻止申请，错误不回显凭据', async () => {
  const absent = local();
  await assert.rejects(absent.portal.borrow(identity, request), { statusCode: 403 });
  const failed = local(async () => { throw new Error('fake-token-secret'); });
  assert.deepEqual(await failed.portal.borrowEligibility(identity), { ok: true, local: true, eligible: false, status: 'unavailable', department: '', message: '暂时无法核验借用资格，请稍后重试。' });
  await assert.rejects(failed.portal.borrow(identity, request), { statusCode: 503 });
});

test('HTTP 资格接口仅返回本账号结果，POST 伪造字段被拒绝，API 副本不会借用合成资格', async t => {
  const actor = { id: 'synthetic-outsider', memberCode: 'member', canReview: true, redCrossDepartment: '志愿者' };
  const server = await createPreviewServer({ seedSyncFailure: false, portalActor: actor });
  server.listen(0); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(root + '/api/auth/session');
  const cookie = session.headers.get('set-cookie').split(';')[0], { csrfToken } = await session.json();
  const before = await (await fetch(root + '/api/materials/overview', { headers: { Cookie: cookie } })).json();
  const eligibility = await (await fetch(root + '/api/public/materials/borrow-eligibility', { headers: { Cookie: cookie } })).json();
  assert.equal(eligibility.eligible, false); assert.equal(eligibility.status, 'not-internal');
  assert.equal('studentId' in eligibility, false); assert.equal('members' in eligibility, false);
  const denied = await fetch(root + '/api/public/materials/requests', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, department: '工作组主任团' }) });
  assert.equal(denied.status, 403);
  const after = await (await fetch(root + '/api/materials/overview', { headers: { Cookie: cookie } })).json();
  assert.deepEqual(after.applications, before.applications); assert.deepEqual(after.inventory, before.inventory);
  const realCopy = await createPreviewServer({ seedSyncFailure: false, sourceInfo: { capturedAt: 'synthetic-test-only', counts: {} } });
  realCopy.listen(0); await once(realCopy, 'listening'); t.after(() => new Promise(resolve => realCopy.close(resolve)));
  const result = await (await fetch(`http://127.0.0.1:${realCopy.address().port}/api/public/materials/borrow-eligibility`)).json();
  assert.equal(result.eligible, false); assert.equal(result.status, 'unverified');
});
