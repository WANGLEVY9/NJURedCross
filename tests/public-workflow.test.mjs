import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { workflowApprovalHash } from '../lib/events/workflow.js';
import { projectWorkflowEvents } from '../lib/events/public-workflow.js';

function published(patch = {}) {
  const row = { _id: 'blood-row', 活动ID: 'WF-blood', 活动名称: '献血车第100周', 活动类别: '献血车志愿服务', 状态: '报名中', 申请版本: '1', 批准版本: '1', 容量: '8', 报名日期: '2026-10-12', 报名时段: '上午 11~15点', 地点: '新街口中央', 工作内容: '志愿服务', 负责人账号ID: 'private-account', 报名页配置: JSON.stringify({ blood: { start: '2026-10-12T11:00:00+08:00', end: '2026-10-12T15:00:00+08:00' } }), ...patch };
  row['批准摘要'] = workflowApprovalHash(row);
  return row;
}
test('only approved published workflow activities join the anonymous catalogue', () => {
  const row = published();
  const stale = { ...row, _id: 'changed', 容量: '9' };
  const events = projectWorkflowEvents([row, stale, published({ 状态: '待审核' }), published({ 状态: '停点' }), published({ 状态: '已归档' })], []);
  assert.equal(events.length, 1);
  assert.equal(events[0].workflowId, 'blood-row');
  assert.equal(events[0].eventId, 'workflow:blood-row');
  assert.equal(events[0].startAt, '2026-10-12T11:00:00+08:00');
  assert.ok(!JSON.stringify(events).includes('private-account'));
});
test('public workflow counters include only the selected activity without personal data', () => {
  const registrations = ['已确认', '已签到', '待筛选', '未入选', '已请假'].map(报名状态 => ({ 活动ID: 'WF-blood', 报名状态, 邮箱: 'private@smail.nju.edu.cn' }));
  registrations.push({ 活动ID: 'another', 报名状态: '已确认' });
  const [event] = projectWorkflowEvents([published()], registrations);
  assert.equal(event.confirmed, 2); assert.equal(event.remaining, 6); assert.equal(event.pending, 1);
  assert.ok(!JSON.stringify(event).includes('private@'));
});
test('the public catalogue combines existing projects and workflow activities', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('async function loadPublicEvents('), source.indexOf('async function getMaterialsOverview('));
  const context = { process: { env: { PLATFORM_TEST_WORKFLOW: 'true' } }, volunteerBaseUuid: 'test', TEST_WORKFLOW_BASE: 'test', eventProjectTable: 'projects', eventSessionTable: 'sessions', eventRegistrationTable: 'registrations',
    listAllRows: async (_client, table) => table === 'projects' ? [{ name: 'existing', eventId: 'legacy', status: '报名中' }] : [],
    isPubliclyListed: () => true, publicEventProjection: row => row, projectWorkflowEvents,
    getWorkflow: async () => ({ publicRead: async () => ({ events: [published()], registrations: [] }) }),
  };
  vm.createContext(context); vm.runInContext(block + ';globalThis.load=loadPublicEvents', context);
  const result = await context.load({});
  assert.equal(result.length, 2); assert.ok(result.some(event => event.workflowId === 'blood-row'));
  context.process.env.PLATFORM_TEST_WORKFLOW = 'false';
  assert.equal((await context.load({})).length, 1);
});
