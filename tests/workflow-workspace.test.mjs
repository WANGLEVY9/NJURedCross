import test from 'node:test';
import assert from 'node:assert/strict';
import { organizationAuthority } from '../lib/events/organization-authority.js';
import { workflowRoutes } from '../lib/events/workflow-api.js';

/**
 * 聚合端点 `/api/volunteer/workflow/workspace`：一次返回目录与选中活动详情，
 * 让前端不必等目录回来再请求详情。权限过滤必须在两个集合上都生效。
 */
const account = { accountId: 'director', username: 'director', role: 'member', emailVerified: true, studentId: '999990001', realName: '合成主任' };
const events = [
  { _id: 'a', 活动ID: 'WF-a', 组织类别: '生命中心', 报名页配置: '{}', 负责人账号ID: 'director' },
  { _id: 'b', 活动ID: 'WF-b', 组织类别: '博爱中心', 报名页配置: '{}', 负责人账号ID: 'other' },
];
const base = { query: async () => [{ 学号: account.studentId, 姓名: account.realName, 部门: '生命中心主任团' }] };

function fixture() {
  const calls = [];
  const workflow = {
    catalog: async () => { calls.push('catalog'); return { events: events.map(e => ({ ...e })) }; },
    detail: async (id) => {
      calls.push(`detail:${id}`);
      return {
        events: events.map(e => ({ ...e })),
        registrations: [{ _id: 'r1', 活动ID: 'WF-a' }, { _id: 'r2', 活动ID: 'WF-b' }],
        ledger: [],
      };
    },
  };
  return { calls, workflow };
}

async function call(path) {
  const authority = await organizationAuthority(account, base, events);
  const { calls, workflow } = fixture();
  const ctx = {
    requirePortalSession: () => account,
    getEventAuthority: async () => authority,
    requireCsrf: () => true,
    json: (_res, _status, payload) => payload,
    getWorkflow: async () => workflow,
    getAuthorityBase: async () => base,
    actor: () => account.accountId,
    readJson: async () => ({}),
    audit: async () => {},
  };
  const result = await workflowRoutes(
    { method: 'GET', headers: {} },
    {},
    new URL(`https://test.invalid/api/volunteer/workflow${path}`),
    ctx,
  );
  return { result, calls };
}

test('workspace returns the catalogue and the selected activity detail in one call', async () => {
  const { result, calls } = await call('/workspace?event=a');
  assert.deepEqual(result.events.map(e => e._id), ['a'], '目录仍按权限过滤');
  assert.ok(result.detail, '选中活动的详情随目录一起返回');
  assert.deepEqual(result.detail.events.map(e => e._id), ['a'], '详情同样按权限过滤');
  assert.deepEqual(calls, ['catalog', 'detail:a']);
});

test('workspace omits the detail when no activity is selected', async () => {
  const { result, calls } = await call('/workspace');
  assert.deepEqual(result.events.map(e => e._id), ['a']);
  assert.equal(result.detail, undefined);
  assert.deepEqual(calls, ['catalog']);
});

test('workspace keeps the detail empty for an activity outside the caller scope', async () => {
  const { result } = await call('/workspace?event=b');
  assert.equal(result.detail, undefined, '越权活动不会出现在目录里，因此没有详情');
});
