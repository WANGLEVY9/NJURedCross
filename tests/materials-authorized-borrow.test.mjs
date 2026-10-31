import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createMaterialsUserAccess } from '../lib/identity/materials-finance-access.js';
import { createPublicMaterialsPortal } from '../lib/materials/public-portal.js';
import { publicMaterialsTestServer } from './helpers/public-materials-server.js';
import { materialActor, materialBody } from './helpers/public-materials.js';

const account = { ...materialActor, accountId: materialActor.id, role: 'platform_admin', status: '启用' };
const access = createMaterialsUserAccess([createHash('sha256').update(account.accountId).digest('hex')]);

test('portal borrowing is granted to active verified super-admins and the delegated identity, never names or inventory scope', () => {
  assert.equal(access(account), true);
  assert.equal(access({ ...account, accountId: 'synthetic-super', role: 'super_admin' }), true);
  for (const patch of [{ role: 'member' }, { status: '停用' }, { emailVerified: false },
    { accountId: 'synthetic-other', permissions: ['materials'], canReview: true }, { accountId: undefined, realName: account.realName }])
    assert.equal(access({ ...account, ...patch }), false);
});

async function server(t, administrator = true) {
  const f = publicMaterialsTestServer(); t.after(() => new Promise(resolve => f.server.close(resolve)));
  f.fixture.profiles[0]['部门'] = '志愿者';
  let current = administrator ? { ...account } : { ...account, accountId: 'synthetic-other' };
  f.ctx.actorFor = () => ({ ...materialActor, emailVerified: current.emailVerified, canReview: true, canBorrow: access(current) });
  f.ctx.portal = createPublicMaterialsPortal({ getProfileBase: async () => f.fixture.profileBase,
    getInventory: async () => ({ summaries: f.fixture.summaries }), store: f.fixture.store,
    canBorrow: actor => actor?.canBorrow === true, today: () => '2026-10-21' });
  f.server.listen(0, '127.0.0.1'); await once(f.server, 'listening');
  const origin = `http://127.0.0.1:${f.server.address().port}`;
  t.after(() => f.fixture.store.close());
  return { ...f, origin, revoke: () => { current = { ...current, status: '停用' }; } };
}
const request = (f, body) => fetch(f.origin + '/api/public/materials/requests', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-csrf-token': f.csrf }, body: JSON.stringify(body) });

test('authorized portal borrowing works with a volunteer profile without modifying its department or bypassing stock rules', async t => {
  const f = await server(t);
  const eligibility = await (await fetch(f.origin + '/api/public/materials/borrow-eligibility')).json();
  assert.equal(eligibility.eligible, true); assert.equal(eligibility.source, 'authorized-account');
  const rejected = await request(f, { ...materialBody, quantity: 999 });
  assert.equal(rejected.status, 409); assert.equal(f.fixture.writes.length, 0);
  const accepted = await request(f, { ...materialBody, canBorrow: false, role: 'member' });
  assert.equal(accepted.status, 201, JSON.stringify(await accepted.clone().json()));
  assert.equal(f.fixture.profiles[0]['部门'], '志愿者');
  assert.equal(f.fixture.applications[0]['学号'], materialActor.studentId);
  assert.equal(f.fixture.writes.some(write => write.table === '个人主页（编辑版）'), false);
});

test('client permission claims and ordinary inventory-review authority cannot open borrowing; revocation applies before submission', async t => {
  const f = await server(t, false);
  assert.equal((await (await fetch(f.origin + '/api/public/materials/borrow-eligibility')).json()).eligible, false);
  assert.equal((await request(f, { ...materialBody, canBorrow: true, role: 'super_admin', permissions: ['materials'] })).status, 403);
  assert.equal(f.fixture.writes.length, 0);
  const granted = await server(t);
  assert.equal((await (await fetch(granted.origin + '/api/public/materials/borrow-eligibility')).json()).eligible, true);
  granted.revoke();
  assert.equal((await request(granted, materialBody)).status, 403);
  assert.equal(granted.fixture.writes.length, 0);
});
