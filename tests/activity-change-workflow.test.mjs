import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow, WF, workflowEventApproved, workflowApprovalHash } from '../lib/events/workflow.js';
import { createActivityChangeStore } from '../lib/events/activity-change-store.js';

async function fixture(t) {
  const store = createActivityChangeStore(':memory:'); t.after(() => store.close());
  const tables = Object.fromEntries(Object.values(WF).map(name => [name, []]));
  let sequence = 0;
  const state = { failedResponse: false, denyReviewer: false };
  const routing = {
    assign: async () => ({ category: '博爱中心', reviewerId: 'reviewer', reviewerIds: ['reviewer'] }),
    async assertReviewer(_, actor) {
      if (state.denyReviewer || !['reviewer', 'super'].includes(actor)) throw Object.assign(new Error('非审核人'), { statusCode: 403 });
      return { role: actor === 'super' ? 'super_admin' : 'platform_admin', reviewerId: actor };
    },
  };
  const base = {
    async listRows(name, _view, _order, _columns, start = 0, limit = 1000) { return structuredClone((tables[name] || []).slice(start, start + limit)); },
    async getMetadata() { return { tables: [] }; },
    async appendRow(name, values) { const row = { ...values, _id: `row-${++sequence}` }; tables[name].push(row); return { _id: row._id }; },
    async updateRow(name, id, patch) {
      Object.assign(tables[name].find(row => row._id === id), patch);
      if (state.failedResponse && patch['申请版本'] === '2') throw new Error('合成响应中断');
    },
  };
  const workflow = createWorkflow(base, { activityChangeStore: store, approvalRouting: routing });
  const created = await workflow.create({ name: '合成变更活动', center: '博爱中心', date: '2030-10-29', slot: '09:00-12:00',
    capacity: 5, serviceHours: 3, trainingHours: 0, travelHours: 0, location: '原地点', work: '合成引导', submit: true }, 'owner');
  await workflow.approve(created._id, 'reviewer'); await workflow.publish(created._id);
  const event = tables[WF.events][0];
  const submit = (patch = { 地点: '新地点' }) => workflow.activityChanges.submit(event._id, patch, { actor: 'owner', requestId: 'change-1' });
  const review = (extra = {}) => workflow.activityChanges.review('change-1', { actor: 'reviewer', version: 1, decision: 'approve', ...extra });
  return { workflow, store, tables, event, submit, review, state };
}
test('real workflow keeps the formal event unchanged until approval and signs the resulting revision', async t => {
  const f = await fixture(t), before = structuredClone(f.event);
  f.tables[WF.registrations].push({ _id: 'registration-1', 活动ID: f.event['活动ID'], 报名状态: '已确认', 学号: 'synthetic' });
  const registrations = structuredClone(f.tables[WF.registrations]);
  await f.submit(); assert.deepEqual(f.event, before);
  const result = await f.review();
  assert.equal(result.status, 'approved');
  assert.equal(f.event['地点'], '新地点');
  assert.equal(f.event['状态'], '报名中');
  assert.equal(f.event['活动ID'], before['活动ID']);
  assert.equal(f.event['申请版本'], '2');
  assert.equal(f.event['批准版本'], '2');
  assert.equal(workflowEventApproved(f.event), true);
  assert.deepEqual(f.tables[WF.registrations], registrations);
});
test('authoritative reviewer permission is rechecked at review time', async t => {
  const f = await fixture(t); await f.submit(); f.state.denyReviewer = true;
  await assert.rejects(() => f.review(), /非审核人/);
  assert.equal(f.event['地点'], '原地点');
});
test('registration snapshots protect date and hour rules and capacity cannot undercut occupancy', async t => {
  const f = await fixture(t);
  f.tables[WF.registrations].push({ 活动ID: f.event['活动ID'], 报名状态: '已确认' }, { 活动ID: f.event['活动ID'], 报名状态: '待筛选' });
  await assert.rejects(() => f.submit({ 报名日期: '2030-10-30' }), /已有报名/);
  await assert.rejects(() => f.submit({ 服务时长: 4 }), /已有报名/);
  await assert.rejects(() => f.submit({ 容量: 1 }), /占位/);
});
test('new attendance evidence arriving after submission prevents approval', async t => {
  const f = await fixture(t); await f.submit();
  f.tables[WF.checkins].push({ 活动ID: f.event['活动ID'], 签到ID: 'synthetic' });
  await assert.rejects(() => f.review(), /已有签到/);
  assert.equal(f.store.get('change-1').status, 'pending');
});
test('formal configuration and receipt survive a lost response without a second revision', async t => {
  const f = await fixture(t); await f.submit(); f.state.failedResponse = true;
  await assert.rejects(() => f.review(), /响应中断/);
  assert.equal(workflowEventApproved(f.event), true);
  assert.equal(f.store.get('change-1').status, 'applying');
  assert.equal((await f.review({ version: 2 })).status, 'approved');
  assert.equal(f.event['申请版本'], '2');
});
test('formal edits after submission make the original request stale', async t => {
  const f = await fixture(t); await f.submit(); f.event['地点'] = '第三地点';
  f.event['批准摘要'] = workflowApprovalHash(f.event);
  await assert.rejects(() => f.review(), /已变化/);
  assert.equal(f.event['地点'], '第三地点');
});
test('return keeps the original signed event and allows a later corrected request', async t => {
  const f = await fixture(t), before = structuredClone(f.event); await f.submit();
  await f.review({ decision: 'return', reason: '请核对新地点' });
  assert.deepEqual(f.event, before);
  const next = await f.workflow.activityChanges.submit(f.event._id, { 地点: '已核对地点' }, { actor: 'owner', requestId: 'change-2' });
  assert.equal(next.status, 'pending');
});
test('non-owner reviewers cannot submit on behalf of an owner', async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.workflow.activityChanges.submit(f.event._id, { 地点: '新地点' }, { actor: 'reviewer', requestId: 'change-1' }), /仅负责人/);
});
test('server preview includes any regenerated notice before the owner submits', async t => {
  const f = await fixture(t), context = await f.workflow.activityChanges.context(f.event._id, 'owner');
  const result = await f.workflow.activityChanges.preview(f.event._id, { 地点: '新地点' }, { actor: 'owner', expectedDigest: context.expectedDigest });
  assert.ok(result.changes.some(change => change.field === '通知草稿' && change.after.includes('新地点')));
  assert.equal(f.event['地点'], '原地点');
  assert.equal(f.store.active(f.event['活动ID']), null);
});
