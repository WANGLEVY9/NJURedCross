import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMaterialsFinanceAccess } from '../lib/identity/materials-finance-access.js';
import { normalizePermissions } from '../lib/permissions.js';
const account = { accountId: 'synthetic-owner-delegate', role: 'platform_admin', status: '启用', emailVerified: true };
const allowed = createMaterialsFinanceAccess([createHash('sha256').update(account.accountId).digest('hex')]);

test('scoped delegation uses a verified active server identity and is revoked by disabling or downgrading it', () => {
  assert.equal(allowed(account), true);
  for (const patch of [{ accountId: 'synthetic-other' }, { accountId: undefined }, { role: 'member' }, { status: '停用' }, { emailVerified: false }]) {
    assert.equal(allowed({ ...account, ...patch }), false);
  }
  assert.equal(allowed({ role: 'platform_admin', realName: '合成同名账号', permissions: ['materials'], financePermissions: ['initial', 'final', 'view', 'payment'] }), false);
});

test('a module permission or self-declared financial role never expands ordinary administrators into other departments', () => {
  assert.deepEqual(normalizePermissions('materials', 'platform_admin', account), ['materials']);
  assert.deepEqual(normalizePermissions('outreach', 'platform_admin', { ...account, accountId: 'synthetic-other' }), ['outreach']);
  assert.deepEqual(normalizePermissions('materials', 'member', { ...account, role: 'member' }), []);
});
