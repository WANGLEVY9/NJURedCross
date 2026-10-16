import test from 'node:test';
import assert from 'node:assert/strict';
import {organizationAccess, eventAccess, EVENT_CATEGORIES} from '../lib/events/organization-access.js';

const account = {accountId:'synthetic-account', studentId:'999990001', realName:'合成成员', emailVerified:true, status:'启用', role:'member'};
const profile = department => ({学号:account.studentId, 姓名:account.realName, 部门:department});
const read = department => organizationAccess(account, [profile(department)], {complete:true});

test('presidium and guidance group receive all six categories from verified organization evidence', () => {
  const organization = read('主席团 & 指导组');
  assert.deepEqual(organization.categories, EVENT_CATEGORIES);
  assert.equal(eventAccess({account, organization, category:'生命中心'}).approve, true);
  assert.equal(eventAccess({account, organization, category:'未知类别'}).create, false);
});

test('directors manage their center but cannot approve publication or infer specialty ownership', () => {
  const organization = read('生命中心主任团');
  assert.equal(eventAccess({account, organization, category:'生命中心'}).create, true);
  assert.equal(eventAccess({account, organization, category:'生命中心'}).approve, false);
  assert.equal(eventAccess({account, organization, category:'博爱中心'}).manage, false);
  assert.equal(eventAccess({account, organization, category:'献血车专项'}).create, false);
  assert.equal(eventAccess({account, organization, category:'一加助残专项'}).create, false);
  const chair = read('主席团 & 指导组');
  assert.equal(eventAccess({account, organization:chair, category:'献血车专项'}).create, false);
  assert.equal(eventAccess({account, organization:chair, category:'献血车专项'}).manage, true);
  assert.equal(eventAccess({account, organization:chair, category:'一加助残专项'}).create, true);
});

test('missing, incomplete, duplicate, mismatched or inactive membership never grants organization permissions', () => {
  const rows = [profile('主席团 & 指导组')];
  for (const organization of [
    organizationAccess(account, rows),
    organizationAccess(account, [...rows, ...rows], {complete:true}),
    organizationAccess(account, [{...rows[0], 姓名:'其他合成人员'}], {complete:true}),
    organizationAccess({...account,emailVerified:false}, rows, {complete:true}),
    organizationAccess({...account,status:'停用'}, rows, {complete:true}),
    organizationAccess({...account,department:'主席团 & 指导组'}, [], {complete:true}),
  ]) assert.equal(organization.global, false);
});

test('event owners can manage only their event and cannot self-grant approval or category-wide creation', () => {
  const access = eventAccess({account, organization:read('志愿者'), category:'博爱中心', ownerIds:[account.accountId]});
  assert.equal(access.manage, true);
  assert.equal(access.recordHours, true);
  assert.equal(access.exportHours, true);
  assert.equal(access.approve, false);
  assert.equal(access.create, false);
  assert.equal(eventAccess({account:{...account,status:'停用'},ownerIds:[account.accountId]}).manage, false);
});
