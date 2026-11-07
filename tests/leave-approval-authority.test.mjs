import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow, WF, WORKFLOW_SCHEMA } from '../lib/events/workflow.js';

function fixture({ allowRegistrar = false, actor = 'ACC-REGISTRAR' } = {}) {
  const tables = Object.fromEntries(Object.values(WF).map(name => [name, []]));
  const base = {
    getMetadata: async () => ({ tables: WORKFLOW_SCHEMA.map(table => ({ name: table.name, columns: table.columns.map(name => ({ name, type: 'text' })) })) }),
    listRows: async (table, _v, _o, _c, start = 0, limit = 500) => structuredClone((tables[table] || []).slice(start, start + limit)),
    appendRow: async (table, row) => { const saved = { ...row, _id: `new-${(tables[table] || []).length}` }; (tables[table] ||= []).push(saved); return saved; },
    updateRow: async (table, id, patch) => { const row = (tables[table] || []).find(item => item._id === id); assert.ok(row); Object.assign(row, patch); },
  };
  tables[WF.events].push({
    _id: 'event-row', 活动ID: 'WF-BLOOD-1', 活动名称: '献血车志愿服务', 状态: '进行中', 报名日期: '2026-11-07',
    申请版本: '1', 批准版本: '1', 报名页配置: JSON.stringify({ region: '南京地区', center: '献血车专项' }),
  });
  tables[WF.registrations].push({
    _id: 'registration-row', 活动ID: 'WF-BLOOD-1', 报名ID: 'WR-1', 账号ID: 'member-1', 姓名: '合成同学', 学号: '231250082',
    报名状态: '已确认', 请假状态: '待审批', 请假原因: '课程冲突', 请假申请时间: '2026-11-06T10:00:00.000Z',
  });
  const routing = {
    assign: async () => null,
    assertRegistrar: async () => {
      if (!allowRegistrar) throw Object.assign(new Error('仅本项目负责人和本地区主席团可以处理报名'), { statusCode: 403 });
    },
  };
  return { tables, actor, workflow: createWorkflow(base, { mode: 'test', approvalRouting: routing }) };
}

test('regional presidium with the matching category can approve a blood-shift leave', async () => {
  const f = fixture({ allowRegistrar: true });
  await f.workflow.decideLeave('registration-row', true, '同意请假', f.actor);
  const row = f.tables[WF.registrations][0];
  assert.equal(row['请假状态'], '已批准');
  assert.equal(row['报名状态'], '已请假');
});

test('an account outside the event owners and regional roster still cannot approve', async () => {
  const f = fixture({ allowRegistrar: false });
  await assert.rejects(f.workflow.decideLeave('registration-row', true, '同意请假', f.actor), { statusCode: 403 });
  assert.equal(f.tables[WF.registrations][0]['请假状态'], '待审批');
});
