import {test} from 'node:test';
import assert from 'node:assert/strict';
import {approvalMessages} from '../lib/events/approval-mail.js';
import {createRegistrationNotifications,NOTIFICATION_TABLE} from '../lib/events/registration-notifications.js';

const reviewer={accountId:'reviewer',studentId:'999990001',realName:'合成审核人',email:'999990001@smail.nju.edu.cn',emailVerified:true,status:'启用',role:'member',organization:{reviewer:true}};
const event={_id:'event-row',活动ID:'event-id',活动名称:'合成审批活动',状态:'待审核',申请版本:1,报名日期:'2030-10-29',报名时段:'08:00–10:00',地点:'合成地点',报名页配置:JSON.stringify({approval:{policy:'any',reviewerIds:['reviewer','reviewer'],submittedAt:'2030-10-01T00:00:00Z'}})};
const origin='https://fixture.invalid';
function fixture(){
 const rows=[{_id:'baseline',幂等键:'INIT:REGISTRATION-NOTIFICATIONS'}];let seq=0,time=Date.parse('2030-10-01');
 const base={async listRows(table,_v,_o,_c,s=0,n=500){assert.equal(table,NOTIFICATION_TABLE);return structuredClone(rows.slice(s,s+n));},async appendRow(_t,row){const item={...row,_id:`task-${++seq}`};rows.push(item);return {_id:item._id};},async updateRow(_t,id,patch){Object.assign(rows.find(r=>r._id===id),patch);}};
 return {base,rows,now:()=>time,advance:()=>{time+=3600000;}};
}
test('approval reminders use verified selected reviewers and stable per-application keys',()=>{
 const messages=approvalMessages([event],[reviewer],origin);assert.equal(messages.length,1);
 assert.match(messages[0].text,/fixture.invalid\/console\/events\?event=event-row/);
 assert.equal(approvalMessages([event],[reviewer],origin)[0].idempotencyKey,messages[0].idempotencyKey);
 assert.notEqual(approvalMessages([{...event,申请版本:2}],[reviewer],origin)[0].idempotencyKey,messages[0].idempotencyKey);
 for(const account of [{...reviewer,emailVerified:false},{...reviewer,organization:{}},{...reviewer,email:'other@example.invalid'}])assert.equal(approvalMessages([event],[account],origin).length,0);
 assert.equal(approvalMessages([event],[reviewer,reviewer],origin).length,0);
 assert.equal(approvalMessages([{...event,状态:'可发布'}],[reviewer],origin).length,0);
 assert.throws(()=>approvalMessages([event],[reviewer],'http://fixture.invalid'));
});

test('two-stage reminders require fresh regional evidence and use a separate key for each review level',()=>{
 const approval={mode:'workspace-regional',policy:'two-stage',reviewerIds:['reviewer'],submittedAt:'2030-10-01T00:00:00Z'};
 const initial={...event,报名页配置:JSON.stringify({approval})},account={...reviewer,role:'platform_admin',organization:{}};
 assert.equal(approvalMessages([initial],[account],origin).length,0);
 const context={regionalReviewers:{'event-row':['reviewer']}},first=approvalMessages([initial],[account],origin,context);
 assert.equal(first.length,1);
 assert.match(first[0].text,/初审通过后还需终审/);
 const final={...event,报名页配置:JSON.stringify({approval:{...approval,initialReview:{actor:'another-reviewer'}}})};
 const second=approvalMessages([final],[account],origin,context);assert.equal(second.length,1);assert.notEqual(first[0].idempotencyKey,second[0].idempotencyKey);
 assert.match(second[0].text,/终审通过后进入待发布阶段/);
 assert.equal(approvalMessages([final],[account],origin,{regionalReviewers:{'event-row':[]}}).length,0);
});

test('multi-position approval mail lists each real slot and location instead of the parent all-day placeholder',()=>{
 const config=JSON.parse(event.报名页配置);
 const positions=[{name:'上午引导',start:'2030-10-29T08:30:00+08:00',end:'2030-10-29T11:30:00+08:00',location:'合成甲地点'},{name:'次日签到',start:'2030-10-30T15:00:00+08:00',end:'2030-10-30T17:00:00+08:00',location:'合成乙地点'}];
 for(const key of ['positionDraft','positionPlan']){
  const grouped={...event,报名时段:'00:00-23:59',报名页配置:JSON.stringify({...config,bookingMode:'grouped',[key]:{positions}})};
  const [mail]=approvalMessages([grouped],[reviewer],origin);
  assert.match(mail.text,/1\. 上午引导\n时间：2030-10-29 08:30 - 2030-10-29 11:30\n地点：合成甲地点/);
  assert.match(mail.text,/2\. 次日签到\n时间：2030-10-30 15:00 - 2030-10-30 17:00\n地点：合成乙地点/);
  assert.doesNotMatch(mail.text,/00:00|23:59/);
 }
 const [single]=approvalMessages([event],[reviewer],origin);assert.match(single.text,/日期：2030-10-29\n时段：08:00–10:00\n地点：合成地点/);
});
test('approval delivery is durable, duplicate-safe and cancels obsolete pending requests',async()=>{
 const f=fixture(),sent=[],worker=createRegistrationNotifications(f.base,{origin,now:f.now,enabled:()=>true,send:async m=>{sent.push(m);return {ok:true,transport:'smtp'};}});
 await worker.approvals([event],[reviewer]);assert.equal(sent.length,0);
 await Promise.all([worker.approvals([event],[reviewer],{deliver:true}),worker.approvals([event],[reviewer],{deliver:true})]);
 assert.equal(sent.length,1);assert.equal(f.rows[1].状态,'已发送');
 await worker.approvals([{...event,申请版本:2}],[reviewer]);assert.equal(f.rows[2].状态,'待发送');
 await worker.approvals([{...event,状态:'可发布'}],[reviewer],{deliver:true});
 assert.equal(f.rows[2].状态,'已取消');assert.equal(f.rows[1].状态,'已发送');assert.equal(sent.length,1);
});
test('approval retry honours backoff and quarantines interrupted sends',async()=>{
 const f=fixture();let sent=0;const worker=createRegistrationNotifications(f.base,{origin,now:f.now,enabled:()=>true,send:async()=>{sent++;return {ok:false,retryable:true};}});
 await worker.approvals([event],[reviewer],{deliver:true});assert.equal(f.rows[1].状态,'发送失败');
 await worker.approvals([event],[reviewer],{deliver:true});assert.equal(sent,1);
 f.advance();await worker.approvals([event],[reviewer],{deliver:true});assert.equal(sent,2);
 f.rows[1].状态='发送中';await worker.approvals([event],[reviewer],{deliver:true});assert.equal(f.rows[1].状态,'结果待核对');assert.equal(sent,2);
});
