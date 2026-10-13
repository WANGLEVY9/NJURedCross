import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registrationPresentation as present} from '../public/app/portal/registration-presentation.js';
test('record progress distinguishes review, confirmation, attendance evidence and accounting',()=>{
 const pending=present({status:'待筛选'});
 assert.equal(pending.label,'待审核');
 assert.deepEqual(pending.steps.map(s=>s.done),[true,false,false,false]);
 assert.equal(pending.steps[1].current,true);
 assert.equal(present({status:'已确认'}).label,'报名成功');
 const submitted=present({status:'已确认',attendanceSubmitted:true});
 assert.equal(submitted.label,'签到待核验');
 assert.equal(submitted.steps[2].done,false);
 assert.equal(submitted.steps[2].current,true);
 const checked=present({status:'已签到'});
 assert.equal(checked.steps[3].current,true);
 assert.equal(checked.label,'签到已核验');
 const entered=present({status:'已签到',entryStatus:'网站已入账'});
 assert.equal(entered.label,'时长已入账');
 assert.ok(entered.steps.every(s=>s.done&&!s.current));
});
test('terminal and leave records do not imply an active next step',()=>{
 for(const data of [{result:'报名失败'},{eventStatus:'停点'},{eventStatus:'已结束'},{leaveStatus:'待审批'}])assert.ok(present(data).steps.every(s=>!s.current));
 assert.match(present({leaveStatus:'待审批'}).hint,/请假待审批/);
 assert.equal(present({status:'已签到',eventStatus:'已结束'}).label,'签到已核验');
});
