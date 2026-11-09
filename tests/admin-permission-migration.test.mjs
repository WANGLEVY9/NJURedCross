import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateAdminPermissions, prepareAdminPermissionPlan } from '../lib/identity/admin-permission-migration.js';
import { ACCOUNT_TABLE } from '../lib/identity/store.js';

const row = (id, scope, role = 'platform_admin') => ({ _id: id, 账号ID: `account-${id}`, 权限范围: scope, 角色: role });

function fixture() {
  const rows = [row('one', ' '), row('two', ''), row('configured', 'outreach'), row('super', '', 'super_admin')];
  const writes = [];
  let frozen = false;
  const base = {
    dtableUuid: 'synthetic-identity-base',
    getRow: async (table, id) => {
      assert.equal(table, ACCOUNT_TABLE);
      return { ...rows.find(item => item._id === id) };
    },
    updateRow: async (table, id, fields) => {
      assert.equal(table, ACCOUNT_TABLE);
      assert.equal(frozen, true);
      assert.deepEqual(Object.keys(fields), ['权限范围']);
      Object.assign(rows.find(item => item._id === id), fields);
      writes.push(id);
      if (id === 'one') throw new Error('synthetic response lost after commit');
    },
  };
  const plan = prepareAdminPermissionPlan(rows, base.dtableUuid);
  plan.entries[0].scopes = ['events'];
  plan.entries[1].scopes = [];
  return { base, rows, writes, plan, freezePlan: async () => { frozen = true; } };
}

test('approved migration is read-only on preview, verifies lost responses and can roll back', async () => {
  const { base, rows, writes, plan, freezePlan } = fixture();
  assert.deepEqual(await migrateAdminPermissions(base, rows, plan), { total: 2, pending: 2, changed: 0 });
  assert.deepEqual(writes, []);
  await migrateAdminPermissions(base, rows, plan, { mode: 'apply', freezePlan });
  assert.deepEqual(rows.map(item => item.权限范围), ['events', 'none', 'outreach', '']);
  assert.equal((await migrateAdminPermissions(base, rows, plan, { mode: 'apply', resume: true })).changed, 0);
  assert.deepEqual(writes, ['one', 'two']);
  await migrateAdminPermissions(base, rows, plan, { mode: 'rollback', resume: true });
  assert.deepEqual(rows.map(item => item.权限范围), [' ', '', 'outreach', '']);
});

test('preflight blocks an unreviewed grant, a changed row or a wrong Base before any write', async () => {
  const { base, rows, writes, plan, freezePlan } = fixture();
  const options = { mode: 'apply', freezePlan };
  await assert.rejects(migrateAdminPermissions(base, rows, { ...plan, baseUuid: 'wrong-base' }, options), /Base/);
  plan.entries[1].scopes = null;
  await assert.rejects(migrateAdminPermissions(base, rows, plan, options), /确认 scopes/);
  plan.entries[1].scopes = ['materials'];
  rows[1].权限范围 = 'materials';
  await assert.rejects(migrateAdminPermissions(base, rows, plan, options), /计划之外/);
  assert.deepEqual(writes, []);
});
