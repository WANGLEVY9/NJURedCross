import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bloodWeekPlan} from '../scripts/preview-blood-week-plan.mjs';

test('blood week has sixteen unique two-hour sessions with 480 places, not assigned service hours',()=>{
 const p=bloodWeekPlan();
 assert.equal(p.mode,'plan-only');assert.equal(p.writes,0);assert.equal(p.emails,0);
 assert.equal(p.sessionCount,16);assert.equal(p.totalCapacity,480);
 assert.equal(p.registrationEnd,'2026-10-28T00:00:00+08:00');
 assert.equal(new Set(p.sessions.map(s=>s.sessionId)).size,16);
 for(const date of ['2026-10-29','2026-10-30'])for(const campus of ['鼓楼','仙林']){
  const slots=p.sessions.filter(s=>s.date===date&&s.campus===campus);
  assert.equal(slots.length,4);
  assert.equal(slots.reduce((sum,s)=>sum+s.capacity,0),120);
  for(const s of slots){assert.equal(Date.parse(s.endAt)-Date.parse(s.startAt),7200000);assert.equal(s.capacity,30);assert.equal(s.hoursRuleStatus,'待确定');assert.equal(s.serviceHours,undefined);assert.equal(s.registrationEnd,p.registrationEnd);assert.ok(Date.parse(s.startAt)>Date.parse(p.registrationEnd));}
 }
 assert.match(p.rules.cancellation,/管理员审核/);
 assert.match(p.work,/协助医护人员/);
});
