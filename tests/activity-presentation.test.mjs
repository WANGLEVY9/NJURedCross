import test from 'node:test';
import assert from 'node:assert/strict';
import { activityPresentation, bloodRegistrationWeek } from '../public/app/portal/activity-presentation.js';
import {bloodPublicWeek} from '../public/app/shared/blood-publication.js';

test('blood public weeks roll over at Monday midnight in Beijing, including year boundaries',()=>{
  assert.deepEqual(bloodPublicWeek('报名中','2026-10-25T15:59:59Z'),{start:'2026-11-02',end:'2026-11-08'});
  assert.deepEqual(bloodPublicWeek('报名中','2026-10-25T16:00:00Z'),{start:'2026-11-09',end:'2026-11-15'});
  assert.deepEqual(bloodPublicWeek('报名中','2026-12-28T00:00:00+08:00'),{start:'2027-01-11',end:'2027-01-17'});
  assert.equal(bloodPublicWeek('进行中'),null);
  assert.equal(bloodPublicWeek('已结束'),null);
});

test('blood registration dates cover Monday through Sunday of the week after next', () => {
  assert.deepEqual(bloodRegistrationWeek('2026-10-23T12:00:00+08:00'), {start:'2026-11-02',end:'2026-11-08'});
  assert.deepEqual(bloodRegistrationWeek('2026-10-25T23:59:59+08:00'), {start:'2026-11-02',end:'2026-11-08'});
  assert.deepEqual(bloodRegistrationWeek('2026-10-25T16:00:00Z'), {start:'2026-11-09',end:'2026-11-15'});
  assert.deepEqual(bloodRegistrationWeek('2026-12-25T12:00:00+08:00'), {start:'2027-01-04',end:'2027-01-10'});
});

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
