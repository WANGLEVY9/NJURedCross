import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberContext, attendanceContext } from '../lib/events/service-context.js';
import { serviceStatus } from '../public/app/console/pages/activity-service-state.js';
import { workflowRoutes } from '../lib/events/workflow-api.js';

const registration = { _id: 'r', 活动ID: 'e', 账号ID: 'a', 姓名: '模拟同学', 学号: '999990001', 报名日期: '2026-10-06', 报名时段: '14–17', 岗位: '服务岗', 报名状态: '已确认' };
const event = { 活动名称: '模拟活动' };
const profile = { 学号: registration.学号, 姓名: registration.姓名, 部门: '生命中心主任团', 急救证: '有', 手机号: 'not-for-response' };
const legacy = { ...registration, _id: 'old-r', 活动名称: event.活动名称, 签到表: [{ row_id: 'old-c' }] };
const checkin = { _id: 'old-c', 姓名: registration.姓名, 学号: registration.学号, 活动名称: [{ row_id: 'old-r' }], 活动时间: '2026-10-06T06:00:00Z', 备注: '模拟凭证', '现场照片（需体现日期时间）': ['https://table.nju.edu.cn/assets/test.png', 'https://evil.example/photo.png'] };

test('member filters use exact profile identity and department, not account roles or missing-data assumptions', () => {
  const [person] = memberContext([registration], [profile]);
  assert.equal(person.center, '生命中心'); assert.equal(person.membership, 'member'); assert.equal(person.certificate, '有');
  assert.equal(JSON.stringify(person).includes('not-for-response'), false);
  assert.equal(memberContext([registration], [{ ...profile, 部门: '志愿者' }])[0].membership, 'volunteer');
  for (const profiles of [[], [profile, profile], [{ ...profile, 姓名: '同学二' }], [{ ...profile, 部门: '未定义部门' }]]) {
    assert.equal(memberContext([{ ...registration, role: 'super_admin' }], profiles)[0].membership, 'unknown');
  }
});

test('attendance labels distinguish missing evidence, submitted photos, manual checks and verified records', () => {
  assert.equal(serviceStatus(null, false, registration, true), '待提交签到凭证');
  assert.equal(serviceStatus(null, false, registration, false), '待现场核验');
  assert.equal(serviceStatus(null, false, { ...registration, 签到照片ID: 'photo' }, true), '待管理员核验');
  assert.equal(serviceStatus(null, false, { ...registration, 报名状态: '已签到' }, false), '已核验待录入');
  assert.equal(serviceStatus({ 状态: '待批准' }, false, registration, false), '已提交');
});

test('legacy evidence requires matching identity, exact session and a reciprocal sign-in link', () => {
  const detail = attendanceContext(registration, event, [], [legacy], [checkin]);
  assert.equal(detail.legacy.length, 1); assert.equal(detail.verified, null);
  assert.deepEqual(detail.legacy[0].photos, ['https://table.nju.edu.cn/assets/test.png']);
  for (const wrong of [{ ...legacy, 报名日期: '2026-10-07' }, { ...legacy, 报名时段: '上午' }, { ...legacy, 岗位: '另一岗' }, { ...legacy, 姓名: '其他人' }]) {
    assert.equal(attendanceContext(registration, event, [], [wrong], [checkin]).legacy.length, 0);
  }
  assert.equal(attendanceContext(registration, event, [], [legacy], [{ ...checkin, 活动名称: ['other'] }]).legacy.length, 0);
  const ambiguous = attendanceContext(registration, event, [], [legacy, { ...legacy, _id: 'duplicate' }], [checkin]);
  assert.equal(ambiguous.legacy.length, 0); assert.match(ambiguous.warnings[0], /多条/);
});

test('website verification details cannot borrow another registration or account record', () => {
  const r = { ...registration, 签到行ID: 'wc' };
  const valid = { _id: 'wc', 报名行ID: 'r', 活动ID: 'e', 账号ID: 'a', 学号: registration.学号, 姓名: registration.姓名, 核验人: 'checker', 活动时间: '2026-10-06T06:10:00Z', 核验说明: '现场确认' };
  assert.equal(attendanceContext(r, event, [valid], [], []).verified.by, 'checker');
  assert.equal(attendanceContext(r, event, [{ ...valid, 账号ID: 'other' }], [], []).verified, null);
});

test('member and attendance detail routes require events permission before retrieving source records', async () => {
  let calls = 0, permitted = false;
  const ctx = { requireConsoleAccess: (_req, _res, scope) => { assert.equal(scope, 'events'); return permitted ? {} : null; },
    getWorkflow: async () => { calls++; return { members: async () => ({ people: [] }), attendanceDetail: async () => ({ legacy: [] }) }; }, json: (_res, status, body) => ({ status, body }) };
  for (const path of ['events/e/members', 'registrations/r/attendance-detail']) {
    const url = new URL(`http://localhost/api/volunteer/workflow/${path}`);
    await workflowRoutes({ method: 'GET', headers: {} }, null, url, ctx); assert.equal(calls, 0);
  }
  permitted = true;
  assert.equal((await workflowRoutes({ method: 'GET', headers: {} }, null, new URL('http://localhost/api/volunteer/workflow/events/e/members'), ctx)).status, 200);
});
