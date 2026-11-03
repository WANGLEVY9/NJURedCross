import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistrationNotifications,NOTIFICATION_TABLE} from '../lib/events/registration-notifications.js';
import {createWorkflow,WF,workflowEventApproved} from '../lib/events/workflow.js';
import {eventMailVariables} from '../lib/mail/templates.js';
import {activityWindow} from '../public/app/shared/activity-window.js';
import {createActivityLifecycleStore} from '../lib/events/activity-lifecycle-store.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const person={accountId:'student',studentId:'999990001',realName:'合成同学',email:'999990001@smail.nju.edu.cn',emailVerified:true,campus:'鼓楼'};
async function fixture({notifications=false}={}){let seq=0,clock=Date.parse('2030-10-23T09:00:00+08:00');const rows=Object.fromEntries(Object.values(WF).map(t=>[t,[]]));rows['网站普通活动项目表']=[];rows[NOTIFICATION_TABLE]=[{_id:'notification-init',幂等键:'INIT:REGISTRATION-NOTIFICATIONS'}];const delivered=[];const base={async listRows(t,_v,_o,_c,s=0,n=500){return structuredClone((rows[t]||[]).slice(s,s+n));},async appendRow(t,row){const r={...row,_id:'row-'+(++seq)};rows[t].push(r);return {_id:r._id};},async updateRow(t,id,patch){const r=rows[t].find(r=>r._id===id);assert.ok(r);Object.assign(r,patch);}};const worker=createRegistrationNotifications(base,{enabled:()=>true,now:()=>clock,send:async message=>{delivered.push(message);return {ok:true,transport:'smtp'};}});const w=createWorkflow(base,{now:()=>clock,...(notifications?{prepareLeaveDecision:worker.prepareLeaveDecision}:{})});const event=await w.create({name:'合成活动',date:'2030-10-23',slot:'11:00-15:00',position:'服务岗',capacity:5,serviceHours:2,trainingHours:0,travelHours:0,location:'合成场地',work:'合成服务',window:activityWindow('2030-10-23T11:00','2030-10-23T15:00'),submit:true},'owner');await w.approve(event._id,'reviewer');await w.publish(event._id);return {w,rows,worker,delivered,event:rows[WF.events][0],setTime:value=>clock=Date.parse(value)};}
const contact={qqGroup:'123456789',invitation:'https://example.invalid/join',notes:'请提前到场'};
test('event contact updates are owner/super-only, stale guarded, preserve approval and feed mail variables',async()=>{const f=await fixture(),before=structuredClone(f.event),state=await f.w.registrationContact(f.event._id,'owner');assert.equal(state.canEdit,true);await assert.rejects(f.w.saveRegistrationContact(f.event._id,{...contact,token:state.token},'foreign'),{statusCode:403});await f.w.saveRegistrationContact(f.event._id,{...contact,token:state.token},'owner');assert.equal(workflowEventApproved(f.event),true);assert.equal(f.event['申请版本'],before['申请版本']);assert.equal(f.event['状态'],'报名中');const vars=eventMailVariables(f.event,person);assert.equal(vars['QQ群号'],contact.qqGroup);assert.equal(vars['邀请链接'],contact.invitation);assert.equal(vars['注意事项'],contact.notes);await assert.rejects(f.w.saveRegistrationContact(f.event._id,{...contact,notes:'new',token:state.token},'owner'),{statusCode:409});const current=await f.w.registrationContact(f.event._id,'root',true);await f.w.saveRegistrationContact(f.event._id,{...contact,notes:'超管修改',token:current.token},'root',true);assert.equal(workflowEventApproved(f.event),true);});
test('contact validation rejects unsafe links and closed stages without touching configuration',async()=>{const f=await fixture(),state=await f.w.registrationContact(f.event._id,'owner');const before=f.event['报名页配置'];for(const patch of [{qqGroup:'invalid'},{invitation:'javascript:alert(1)'},{invitation:'https://user:pass@example.invalid'},{actor:'owner'}])await assert.rejects(f.w.saveRegistrationContact(f.event._id,{...contact,token:state.token,...patch},'owner'),{statusCode:400});assert.equal(f.event['报名页配置'],before);f.event['状态']='进行中';await assert.rejects(f.w.saveRegistrationContact(f.event._id,{...contact,token:state.token},'owner'),{statusCode:409});});
test('pending registration in a running activity can take automatic leave while preserving identity and hours',async()=>{const f=await fixture(),r=await f.w.register(f.event._id,person);f.event['状态']='进行中';f.setTime('2030-10-23T12:00:00+08:00');const out=await f.w.requestLeave(r['报名ID'],person,'课程冲突');assert.equal(out.autoApproved,true);const saved=f.rows[WF.registrations][0];assert.equal(saved['报名状态'],'已请假');assert.equal(saved['请假状态'],'已批准');assert.equal(saved['是否报名成功'],'false');assert.equal(saved['报名ID'],r['报名ID']);assert.equal(f.rows[WF.ledger].length,0);assert.equal(out.notificationDecision.requestAt,saved['请假申请时间']);await assert.rejects(f.w.requestLeave(r['报名ID'],person,'重复申请'),{statusCode:409});});
test('confirmed leave keeps manual owner/super review and supports rejection then reapplication',async()=>{const f=await fixture(),r=await f.w.register(f.event._id,person);await f.w.confirm(r._id);f.event['状态']='进行中';assert.equal((await f.w.requestLeave(r['报名ID'],person,'有事')).autoApproved,false);await assert.rejects(f.w.decideLeave(r._id,true,'同意','foreign'),{statusCode:403});await f.w.decideLeave(r._id,false,'请核对','owner');assert.equal(f.rows[WF.registrations][0]['报名状态'],'已确认');await f.w.requestLeave(r['报名ID'],person,'重新说明');await f.w.decideLeave(r._id,true,'批准','root',true);assert.equal(f.rows[WF.registrations][0]['报名状态'],'已请假');});
test('automatic leave cannot clear another person, submitted evidence, reviewed hours or ended sessions',async()=>{for(const kind of ['foreign','photo','checkin','ledger','review','ended']){const f=await fixture(),r=await f.w.register(f.event._id,person);f.event['状态']='进行中';f.setTime('2030-10-23T12:00:00+08:00');const row=f.rows[WF.registrations][0];if(kind==='photo')row['签到照片ID']='synthetic';if(kind==='checkin')f.rows[WF.checkins].push({报名行ID:r._id});if(kind==='ledger')f.rows[WF.ledger].push({报名行ID:r._id});if(kind==='review')f.rows[WF.ledger].push({报名行ID:r._id,'幂等键':`RUNNING:${r._id}`,状态:'草稿'});if(kind==='ended')f.setTime('2030-10-23T16:00:00+08:00');await assert.rejects(f.w.requestLeave(r['报名ID'],kind==='foreign'?{accountId:'foreign'}:person,'不能自动撤销'),{statusCode:kind==='foreign'?404:409});assert.equal(row['报名状态'],'待筛选');}});
test('source activity contact survives lifecycle store reopen without writing a remote schema',async t=>{const dir=await mkdtemp(join(tmpdir(),'activity-contact-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'lifecycle.sqlite');let store=createActivityLifecycleStore(file);store.setContact('source-week',contact);store.close();store=createActivityLifecycleStore(file);assert.deepEqual(store.contact('source-week'),contact);assert.equal(store.contact('other'),null);store.close();});

test('all workflow activity types allow pending and confirmed leave before the session starts',async()=>{
 const {registrationLeavePolicy}=await import('../public/app/shared/registration-leave.js');
 const start='2030-10-23T11:00:00+08:00',end='2030-10-23T15:00:00+08:00';
 for(const config of [{blood:{start,end}},{ordinary:{start,end}},{window:{start,end}}])for(const stage of ['报名中','进行中','停点'])for(const status of ['待筛选','已确认']){
  const event={状态:stage,报名日期:'2030-10-23',报名页配置:JSON.stringify(config)},row={报名状态:status};
  assert.equal(registrationLeavePolicy(event,row,{now:Date.parse('2030-10-23T10:59:00+08:00')}).allowed,true);
  if(stage!=='进行中'||status!=='待筛选')assert.equal(registrationLeavePolicy(event,row,{now:Date.parse(start)}).allowed,false);
 }
});


test('unconfirmed registration can cancel before starting without manual review and keeps reason',async()=>{
 const f=await fixture(),r=await f.w.register(f.event._id,person);
 await assert.rejects(f.w.requestLeave(r['报名ID'],person,''),{statusCode:400});
 const out=await f.w.requestLeave(r['报名ID'],person,'课程安排冲突');assert.equal(out.autoApproved,true);
 const saved=f.rows[WF.registrations][0];assert.equal(saved['报名状态'],'已请假');assert.equal(saved['请假状态'],'已批准');assert.equal(saved['请假原因'],'课程安排冲突');assert.equal(saved['报名ID'],r['报名ID']);assert.match(saved['处理说明'],/自行取消/);
});

test('historical Hongyang compatibility requires blood configuration and keeps leave timing bounds',async()=>{
 const {registrationLeavePolicy,isLegacyHongyangAutoConfirmedRegistration}=await import('../public/app/shared/registration-leave.js');
 const start='2030-10-23T11:00:00+08:00',end='2030-10-23T15:00:00+08:00',row={报名状态:'已确认',处理说明:'弘阳广场自动确认'};
 const blood={状态:'报名中',地点:'浦口弘阳广场',报名日期:'2030-10-23',报名页配置:JSON.stringify({blood:{start,end}})};
 assert.equal(registrationLeavePolicy(blood,row,{now:Date.parse('2030-10-23T10:59:00+08:00')}).autoApproved,true);
 assert.equal(registrationLeavePolicy(blood,row,{now:Date.parse(start)}).allowed,false);
 assert.equal(registrationLeavePolicy({...blood,状态:'进行中'},row,{now:Date.parse('2030-10-23T12:00:00+08:00')}).autoApproved,true);
 const normal=registrationLeavePolicy({...blood,报名页配置:'{}'},row,{now:Date.parse('2030-10-23T10:00:00+08:00')});
 assert.equal(normal.allowed,true);assert.equal(normal.autoApproved,false);
 const projected=legacy=>({blood:true,location:'浦口弘阳广场',status:'已确认',reason:'弘阳广场自动确认',...legacy});
 assert.equal(isLegacyHongyangAutoConfirmedRegistration(projected()),true);
 assert.equal(isLegacyHongyangAutoConfirmedRegistration(projected({blood:false})),false);
 assert.equal(isLegacyHongyangAutoConfirmedRegistration(projected({location:'新街口中央'})),false);
 assert.equal(isLegacyHongyangAutoConfirmedRegistration(projected({reason:'人工确认'})),false);
});


test('pending self-cancellation works with the actual notification queue enabled and sends only after commit',async()=>{
 const f=await fixture({notifications:true}),r=await f.w.register(f.event._id,person);
 const result=await f.w.requestLeave(r['报名ID'],person,'课程安排冲突');
 assert.equal(result.autoApproved,true);
 const row=f.rows[WF.registrations][0];assert.equal(row['报名状态'],'已请假');assert.equal(row['请假状态'],'已批准');assert.equal(row['请假原因'],'课程安排冲突');assert.equal(row['是否报名成功'],'false');
 const tasks=f.rows[NOTIFICATION_TABLE].filter(row=>row['幂等键'].startsWith('WF-LEAVE:'));assert.equal(tasks.length,1);assert.equal(tasks[0]['状态'],'待发送');assert.equal(f.delivered.length,0);assert.equal(f.rows[WF.checkins].length,0);assert.equal(f.rows[WF.ledger].length,0);
 await f.worker.reconcile(await f.w.read());assert.equal(f.delivered.length,1);assert.equal(tasks[0]['状态'],'已发送');assert.match(f.delivered[0].text,/报名已取消/);
 await f.worker.reconcile(await f.w.read());assert.equal(f.delivered.length,1);
});

test('confirmed registrations keep manual leave review when the actual notification queue is enabled',async()=>{
 const f=await fixture({notifications:true}),r=await f.w.register(f.event._id,person);await f.w.confirm(r._id);
 const result=await f.w.requestLeave(r['报名ID'],person,'课程安排冲突');assert.equal(result.autoApproved,false);assert.equal(f.rows[WF.registrations][0]['报名状态'],'已确认');assert.equal(f.rows[NOTIFICATION_TABLE].filter(row=>row['幂等键'].startsWith('WF-LEAVE:')).length,0);
 await f.w.decideLeave(r._id,true,'核对后同意','owner');assert.equal(f.rows[WF.registrations][0]['报名状态'],'已请假');assert.equal(f.delivered.length,0);
 await f.worker.reconcile(await f.w.read());assert.equal(f.delivered.filter(message=>message.idempotencyKey.startsWith('WF-LEAVE:')).length,1);
});


test('notification preparation failure leaves pending registration and capacity unchanged',async()=>{
 const f=await fixture({notifications:true}),r=await f.w.register(f.event._id,person),before=structuredClone(f.rows[WF.registrations][0]);
 f.rows[NOTIFICATION_TABLE].length=0;
 await assert.rejects(f.w.requestLeave(r['报名ID'],person,'课程安排冲突'),/Notification baseline missing/);
 assert.deepEqual(f.rows[WF.registrations][0],before);assert.equal(f.delivered.length,0);assert.equal(f.rows[WF.checkins].length,0);assert.equal(f.rows[WF.ledger].length,0);
});
