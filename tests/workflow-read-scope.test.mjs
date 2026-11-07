import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow, WF, WORKFLOW_SCHEMA, workflowApprovalHash } from '../lib/events/workflow.js';
import { withRequestReads, displayRead } from '../lib/http/display-reads.js';

function fixture() {
  const reads = [];
  const tables = Object.fromEntries(Object.values(WF).map(name => [name, []]));
  const base = {
    getMetadata: async () => ({ tables: WORKFLOW_SCHEMA.map(table => ({ name: table.name, columns: table.columns.map(name => ({ name, type: 'text' })) })) }),
    listRows: async (table, _v, _o, _c, start = 0, limit = 1000) => { reads.push(table); return structuredClone((tables[table] || []).slice(start, start + limit)); },
    appendRow: async (table, row) => { const saved = { ...row, _id: `new-${tables[table].length}` }; tables[table].push(saved); return saved; },
    updateRow: async (table, id, patch) => { Object.assign(tables[table].find(row => row._id === id), patch); },
  };
  const event = { _id: 'event-row', 活动ID: 'EVT-1', 活动名称: '合成活动', 状态: '报名中', 报名日期: '2026-11-10', 容量: '10', 申请版本: '1', 批准版本: '1', 报名页配置: '{}' };
  event['批准摘要'] = workflowApprovalHash(event);
  tables[WF.events].push(event);
  tables[WF.registrations].push({ _id: 'registration-row', 活动ID: 'EVT-1', 报名ID: 'WR-1', 账号ID: 'account-1', 姓名: '合成同学', 学号: '000001', 报名状态: '待筛选', 是否报名成功: 'false' });
  return { reads, tables, workflow: createWorkflow(base, { mode: 'test', now: () => Date.parse('2026-11-07T10:00:00Z') }) };
}

test('confirming a registration only reads events and registrations', async () => {
  const f = fixture();
  await f.workflow.confirm('registration-row');
  const unique = [...new Set(f.reads)].sort();
  assert.deepEqual(unique, [WF.events, WF.registrations].sort());
  assert.equal(f.tables[WF.registrations][0]['报名状态'], '已确认');
});

test('the event projection reuses the registration snapshot instead of reading it twice', async () => {
  const f = fixture();
  await f.workflow.confirm('registration-row');
  assert.equal(f.reads.filter(table => table === WF.registrations).length, 1);
  assert.equal(f.reads.filter(table => table === WF.events).length, 1);
});

test('request-scoped reads coalesce and never leak into the next request', async () => {
  const client = {};
  let loads = 0;
  const load = async () => { loads += 1; return { ok: true }; };
  await withRequestReads(async () => {
    await displayRead(client, 'same-key', load, 5000, []);
    await displayRead(client, 'same-key', load, 5000, []);
  });
  assert.equal(loads, 1, 'one physical read per request');
  await displayRead(client, 'same-key', load, 5000, []);
  assert.equal(loads, 2, 'the next request must read again');
});
