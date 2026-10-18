import test from 'node:test';
import assert from 'node:assert/strict';
import { activityChangePatch, isActivityChangeSupported } from '../public/app/shared/activity-change.js';
const event = { 状态: '报名中', 活动名称: '合成活动', 容量: '5', 地点: '旧地点', 报名页配置: '{}' };
test('only independent published activities use the change-request editor', () => {
  assert.equal(isActivityChangeSupported(event), true);
  for (const config of [{ ordinary: {} }, { blood: {} }, { positionPlan: {} }, { bookingMode: 'grouped' }, { source: { kind: 'generated_blood' } }]) assert.equal(isActivityChangeSupported({ ...event, 报名页配置: JSON.stringify(config) }), false);
  assert.equal(isActivityChangeSupported({ ...event, 状态: '已结束' }), false);
  assert.equal(isActivityChangeSupported({ ...event, 报名页配置: 'invalid' }), false);
});
test('unchanged values and identity overrides cannot enter the patch', () => {
  assert.deepEqual(activityChangePatch(event, { 活动名称: '合成活动', 容量: 5, 活动ID: 'foreign', 批准摘要: 'forged' }), {});
});
test('preview includes only changed values without modifying the formal event', () => {
  const before = structuredClone(event);
  assert.deepEqual(activityChangePatch(event, { 地点: ' 新地点 ', 容量: 8 }), { 容量: '8', 地点: '新地点' });
  assert.deepEqual(event, before);
});
test('window changes produce matching date and full time range', () => {
  const patch = activityChangePatch(event, { windowStart: '2030-10-29T09:00', windowEnd: '2030-10-29T12:00' });
  assert.equal(patch['报名日期'], '2030-10-29');
  assert.equal(patch['报名时段'], '2030-10-29 09:00:00 — 2030-10-29 12:00:00');
});
test('invalid or reversed windows cannot be previewed', () => {
  for (const values of [{ windowStart: '' }, { windowStart: '2030-10-29T12:00', windowEnd: '2030-10-29T09:00' }]) assert.throws(() => activityChangePatch(event, values), /有效/);
});
