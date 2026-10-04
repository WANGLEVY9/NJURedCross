import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkflow, WF } from '../lib/events/workflow.js';
import { BLOOD_SHIFTS } from '../lib/events/blood-roster.js';

const rules = { monday: '2026-10-12', week: 100, capacity: 8, serviceHours: 4, trainingHours: 2, travelHours: 2 };
function fixture() {
  const templates = ['周一','周二','周三','周四','周五','周六','周日'].flatMap(day => BLOOD_SHIFTS.map(shift => ({ 序号: day, 点位: '新街口中央', 活动时间: shift })));
  const tables = { [WF.events]: [], '市血液献血车排班表（模板表）': templates };
  const counts = { reads: {}, batches: 0, singles: 0 }; let seq = 0, failPartial = false, drop = false;
  const base = {
    async listRows(table, _v, _o, _c, start = 0, limit = 500) { counts.reads[table] = (counts.reads[table] || 0) + 1; return structuredClone((tables[table] || []).slice(start, start + limit).reverse()); },
    async appendRow() { counts.singles++; throw new Error('Unexpected single-row write'); },
    async batchAppendRows(table, rows) {
      counts.batches++; if (drop) return {};
      for (const row of rows) { tables[table].push({ ...row, _id: `persisted-${++seq}` }); if (failPartial) { failPartial = false; throw new Error('Ambiguous transport failure'); } }
      return { unrelated: true }; // API result order/shape is deliberately ignored.
    },
  };
  return { w: createWorkflow(base), tables, counts, partial: () => { failPartial = true; }, drop: () => { drop = true; } };
}
test('35 weekly shifts use one batch, constant reads and persisted IDs; retry writes nothing', async () => {
  const f = fixture(); const result = await f.w.prepareBloodWeek(rules, 'owner');
  assert.equal(result.count, 35); assert.equal(f.counts.batches, 1); assert.equal(f.counts.singles, 0);
  assert.equal(f.counts.reads[WF.events], 2);
  assert.equal(f.counts.reads['市血液献血车排班表（模板表）'], 1);
  assert.ok(result.events.every(row => row._id.startsWith('persisted-') && row['状态'] === '待审核'));
  await f.w.prepareBloodWeek(rules, 'owner'); assert.equal(f.counts.batches, 1); assert.equal(f.tables[WF.events].length, 35);
});
test('a conflicting late shift is rejected before any new shifts are written', async () => {
  const f = fixture(); await f.w.prepareBloodWeek(rules, 'owner');
  const last = f.tables[WF.events].pop(); const config = JSON.parse(last['报名页配置']); config.service = 99; last['报名页配置'] = JSON.stringify(config);
  f.tables[WF.events] = [last];
  await assert.rejects(f.w.prepareBloodWeek(rules, 'owner'), { statusCode: 409 });
  assert.equal(f.tables[WF.events].length, 1); assert.equal(f.counts.batches, 1);
});
test('partial batch persistence is resumed without duplicate shifts', async () => {
  const f = fixture(); f.partial(); await assert.rejects(f.w.prepareBloodWeek(rules, 'owner'));
  assert.equal(f.tables[WF.events].length, 1);
  const result = await f.w.prepareBloodWeek(rules, 'owner');
  assert.equal(result.count, 35); assert.equal(f.tables[WF.events].length, 35);
  assert.equal(new Set(result.events.map(row => JSON.parse(row['报名页配置']).blood.key)).size, 35);
});
test('unconfirmed batch response never reports success or falls back to blind single writes', async () => {
  const f = fixture(); f.drop(); await assert.rejects(f.w.prepareBloodWeek(rules, 'owner'));
  assert.equal(f.counts.batches, 1); assert.equal(f.counts.singles, 0);
});
test('concurrent identical weekly requests remain serialized and drafts remain drafts', async () => {
  const f = fixture(); const requests = await Promise.all([f.w.prepareBloodWeek({ ...rules, submit: false }, 'owner'), f.w.prepareBloodWeek({ ...rules, submit: false }, 'owner')]);
  assert.equal(f.counts.batches, 1); assert.equal(f.tables[WF.events].length, 35);
  assert.ok(requests.every(result => result.events.every(row => row['状态'] === '草稿')));
});
