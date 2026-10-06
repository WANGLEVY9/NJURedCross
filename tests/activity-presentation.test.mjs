import test from 'node:test';
import assert from 'node:assert/strict';
import { activityPresentation } from '../public/app/portal/activity-presentation.js';

test('one programme summary retains all blood places across weeks and ordinary activities', () => {
  const shifts = Array.from({length: 72}, (_, index) => ({eventId: `slot-${index}`, type:'献血车志愿服务', location: index % 2 ? '中央' : '印象汇', startAt:index < 36 ? '2026-10-12' : '2026-10-19', remaining:index % 3 ? 1 : 0}));
  const ordinary = {eventId:'ordinary',type:'公益活动',name:'急救培训'};
  const result = activityPresentation([...shifts, ordinary]);
  assert.equal(result.blood.length, 72);
  assert.deepEqual(result.ordinary, [ordinary]);
  assert.deepEqual(result.summary, {shifts:72,points:2,remaining:48,dates:['2026-10-12','2026-10-19']});
});
test('empty, full and incomplete source fields do not invent places or dates', () => {
  assert.equal(activityPresentation([]).summary.remaining, 0);
  const { summary } = activityPresentation([{blood:true, remaining:0}, {blood:true,remaining:-1}, {blood:true,remaining:'2',startAt:'invalid'}]);
  assert.deepEqual(summary, {shifts:3,points:0,remaining:2,dates:[]});
});
