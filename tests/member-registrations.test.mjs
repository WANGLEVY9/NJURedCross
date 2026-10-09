import test from 'node:test';
import assert from 'node:assert/strict';
import {memberRegistrations} from '../public/app/portal/member-registrations.js';
test('member list combines ordinary and workflow activities, hiding inactive history',()=>{
 const ordinary=[{eventId:'first-aid',code:'old',status:'已取消',submittedAt:'2026-10-10'},{eventId:'first-aid',code:'new',status:'候补',waitlist:2,submittedAt:'2026-10-09'}];
 const workflow=[{eventId:'duty',code:'duty-1',status:'已确认',eventName:'工位值班',submittedAt:'2026-10-08'}, {eventId:'blood',code:'blood-1',status:'待筛选',blood:true,submittedAt:'2026-10-07'}];
 const result=memberRegistrations(ordinary,workflow);
 assert.deepEqual(result.map(r=>r.code),['new','duty-1','blood-1']);
 assert.equal(result[0].status,'待确认');assert.equal(result[0].waitlist,2);
 assert.equal(result[1].status,'已报名');assert.equal(result[2].status,'待确认');
 assert.equal(ordinary[0].status,'已取消');assert.equal(workflow[1].status,'待筛选');
});
test('attendance evidence is pending review until confirmed and inactive entries do not show check-in prompts',()=>{
 const statuses=memberRegistrations([], [
  {code:'pending',status:'已确认',attendanceSubmitted:true},
  {code:'checked',status:'已签到',attendanceSubmitted:true},
  {code:'leave',status:'已请假',attendanceSubmitted:true},
  {code:'cancel',status:'已取消',attendanceSubmitted:true},
  {code:'rejected',status:'未入选'},
  {code:'leavePending',status:'已确认',leaveStatus:'待审批'},
 ]);
 const byCode=Object.fromEntries(statuses.map(r=>[r.code,r]));
 assert.equal(byCode.pending.status,'已报名');
 assert.equal(byCode.checked.status,'已签到');assert.ok(statuses.every(r=>['待确认','已报名','已签到'].includes(r.status)));
 for(const code of ['leave','cancel','rejected'])assert.equal(byCode[code],undefined);
 assert.equal(byCode.leavePending.status,'已报名');
 const [ordinary]=memberRegistrations([{status:'已确认',checkedInAt:'2026-10-09'}]);assert.equal(ordinary.status,'已签到');
});
test('detail links preserve registration source and all attempts, even with matching codes',()=>{
 const rows=memberRegistrations([{code:'same',status:'已确认'}],[{code:'same',eventId:'shift/a',status:'已确认',date:'2026-10-12',slot:'上午'}]);
 assert.equal(rows.length,2);
 assert.equal(rows.find(r=>r.source==='ordinary').href,'/status?code=same');
 const workflow=rows.find(r=>r.source==='workflow');
 assert.equal(workflow.href,'/workflow-events?event=shift%2Fa');assert.equal(workflow.schedule,'2026-10-12 上午');
 assert.deepEqual(memberRegistrations(),[]);
});
test('cancelled timestamps, pending cancellations and unknown states are excluded',()=>{
 assert.deepEqual(memberRegistrations([{status:'已确认',cancelledAt:'2026-10-09'},{status:'待取消'},{status:'未知'}]),[]);
});
