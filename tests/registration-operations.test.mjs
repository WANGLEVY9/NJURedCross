import {test} from 'node:test';
import assert from 'node:assert/strict';
import {placePlan,createOrdinaryPlaces,PLACE_TABLE} from '../lib/events/ordinary-places.js';
import {confirmationMessage,createRegistrationNotifications,NOTIFICATION_TABLE} from '../lib/events/registration-notifications.js';
const event={_id:'event-row',活动ID:'event',活动名称:'合成活动',容量:'30',报名日期:'2030-10-29',报名时段:'08:30–10:30',岗位:'服务岗',地点:'合成地点',报名页配置:JSON.stringify({ordinary:{groupId:'group'}})};
const registration={_id:'registration-row',报名ID:'WR-test',活动ID:'event',学号:'999990001',姓名:'合成同学',邮箱:'999990001@smail.nju.edu.cn',报名状态:'已确认',是否报名成功:'true',报名日期:event.报名日期,报名时段:event.报名时段,岗位:event.岗位};
function fixture(){
 const tables={[PLACE_TABLE]:[],[NOTIFICATION_TABLE]:[{_id:'baseline',幂等键:'INIT:REGISTRATION-NOTIFICATIONS',状态:'历史未补发'}]};let seq=0,time=Date.parse('2030-10-12T00:00:00Z');
 const base={async listRows(t,_v,_o,_c,s=0,n=500){return structuredClone(tables[t].slice(s,s+n));},async appendRow(t,row){const value={...row,_id:`row-${++seq}`};tables[t].push(value);return {_id:value._id};},async updateRow(t,id,patch){Object.assign(tables[t].find(r=>r._id===id),patch);}};
 return {base,tables,now:()=>time,advance:()=>{time+=3600000;}};
}
test('16 sessions reserve exactly 480 seats without creating fake registrations',()=>{
 const sessions=Array.from({length:16},(_,n)=>({...event,活动ID:`session-${n}`}));assert.equal(placePlan(sessions,[]).length,480);
});
test('bounded inventory batches resume without duplicate seats and reread changed bookings',async()=>{
 const f=fixture(),places=createOrdinaryPlaces(f.base);
 const first=await places.reconcile([event],[],{maxChanges:8});
 assert.equal(first.changed,8);assert.equal(first.remaining,22);
 let result;
 do{result=await places.reconcile([event],[registration],{maxChanges:8});assert.ok(result.changed<=8);}while(result.remaining);
 assert.equal(f.tables[PLACE_TABLE].length,30);
 assert.equal(new Set(f.tables[PLACE_TABLE].map(r=>r['名额ID'])).size,30);
 assert.equal(f.tables[PLACE_TABLE].filter(r=>r['报名ID']===registration['报名ID']).length,1);
});
test('blood week mail uses approved display copy without changing records or other activities',()=>{
 const bloodWeek={...event,报名页配置:JSON.stringify({ordinary:{groupId:'NJU-RC-BLOOD-WEEK-2026-10'}})};
 const original=structuredClone({bloodWeek,registration});
 const message=confirmationMessage(bloodWeek,registration,'https://fixture.invalid');
 assert.equal(message.subject,'南大红会｜2026南大红会无偿献血周报名成功');
 assert.match(message.text,/活动：2026南大红会无偿献血周\n/);
 assert.match(message.text,/岗位：献血周服务（岗位后续分配）\n/);
 assert.deepEqual({bloodWeek,registration},original);
 const other=confirmationMessage(event,registration,'https://fixture.invalid');
 assert.match(other.text,/活动：合成活动\n/);assert.match(other.text,/岗位：服务岗\n/);
 assert.equal(other.idempotencyKey,message.idempotencyKey);
});
test('inventory reconciliation is idempotent, stable, and cancellation preserves booking history',async()=>{
 const f=fixture(),places=createOrdinaryPlaces(f.base);await places.reconcile([event],[registration]);
 assert.equal(f.tables[PLACE_TABLE].length,30);assert.equal((await places.reconcile([event],[registration])).changed,0);
 const seat=f.tables[PLACE_TABLE].find(r=>r['报名ID']===registration['报名ID']);
 await places.reconcile([event],[{...registration,请假状态:'待审批'}]);assert.equal(seat['名额状态'],'取消待审批');
 await places.reconcile([event],[{...registration,报名状态:'已请假'}]);assert.equal(seat['名额状态'],'空闲');assert.equal(registration['报名状态'],'已确认');
 await places.reconcile([{...event,容量:'2'}],[]);assert.equal(f.tables[PLACE_TABLE].filter(r=>r['名额状态']==='已停用').length,28);
});
test('invalid capacity and duplicate seats or registrations fail closed',()=>{
 assert.throws(()=>placePlan([{...event,容量:'0'}],[]));assert.throws(()=>placePlan([event],[registration,registration]));
 const row={活动ID:'event',名额ID:'event:1',名额序号:'1'};assert.throws(()=>placePlan([event],[],[row,row]));
});
test('confirmed notifications are asynchronous, idempotent, and never console successes',async()=>{
 const f=fixture(),sent=[],worker=createRegistrationNotifications(f.base,{now:f.now,enabled:()=>true,send:async m=>{sent.push(m);return {ok:true,transport:'smtp'};}}),data={events:[event],registrations:[registration]};
 await worker.reconcile(data);await worker.reconcile(data);assert.equal(sent.length,1);assert.match(sent[0].text,/亲爱的志愿者 合成同学/);assert.match(sent[0].text,/恭喜您成功报名/);assert.match(sent[0].text,/您的报名信息为：合成活动/);assert.match(sent[0].text,/如需请假，请至少提前1天填写反馈表/);
 assert.equal(f.tables[NOTIFICATION_TABLE].at(-1)['状态'],'已发送');
});
test('historical baseline, pending decisions and unverified addresses do not send',async()=>{
 const f=fixture(),sent=[],worker=createRegistrationNotifications(f.base,{enabled:()=>true,send:async m=>{sent.push(m);return {ok:true,transport:'smtp'};}});
 f.tables[NOTIFICATION_TABLE].push({_id:'old',幂等键:'WF-RESULT:WR-test:yes',状态:'历史未补发',报名ID:'WR-test'});
 await worker.reconcile({events:[event],registrations:[registration]});assert.equal(sent.length,0);
 await worker.reconcile({events:[event],registrations:[{...registration,报名状态:'待筛选'}]});assert.equal(sent.length,0);
 assert.throws(()=>confirmationMessage(event,{...registration,邮箱:'other@example.invalid'},'https://fixture.invalid'));
});
test('known rejection retries but ambiguous failures and interrupted sends require review',async()=>{
 const f=fixture();let calls=0;const worker=createRegistrationNotifications(f.base,{now:f.now,enabled:()=>true,send:async()=>{calls++;return calls===1?{ok:false,retryable:true}:{ok:false};}}),data={events:[event],registrations:[registration]};
 await worker.reconcile(data);assert.equal(f.tables[NOTIFICATION_TABLE].at(-1)['状态'],'发送失败');
 await worker.reconcile(data);assert.equal(calls,1);f.advance();await worker.reconcile(data);assert.equal(calls,2);assert.equal(f.tables[NOTIFICATION_TABLE].at(-1)['状态'],'结果待核对');
 f.advance();await worker.reconcile(data);assert.equal(calls,2);
 f.tables[NOTIFICATION_TABLE].at(-1)['状态']='发送中';await worker.reconcile(data);assert.equal(calls,2);
});
test('mail outage never prevents queue persistence and approved cancellation suppresses unsent mail',async()=>{
 const f=fixture(),worker=createRegistrationNotifications(f.base,{enabled:()=>false,send:async()=>assert.fail('disabled transport must not send')});
 await worker.reconcile({events:[event],registrations:[registration]});assert.equal(f.tables[NOTIFICATION_TABLE].at(-1)['状态'],'待发送');
 await worker.reconcile({events:[event],registrations:[{...registration,报名状态:'已请假'}]});assert.equal(f.tables[NOTIFICATION_TABLE].at(-1)['状态'],'已取消');
});
test('missing baseline fails closed and concurrent reconciliations do not duplicate mail',async()=>{
 const f=fixture(),worker=createRegistrationNotifications(f.base,{enabled:()=>true,send:async()=>({ok:true,transport:'smtp'})}),data={events:[event],registrations:[registration]};
 f.tables[NOTIFICATION_TABLE]=[];await assert.rejects(worker.reconcile(data),/baseline/);
 f.tables[NOTIFICATION_TABLE].push({_id:'init',幂等键:'INIT:REGISTRATION-NOTIFICATIONS'});await Promise.all([worker.reconcile(data),worker.reconcile(data)]);
 assert.equal(f.tables[NOTIFICATION_TABLE].filter(r=>r['报名ID']==='WR-test').length,1);
});
test('manual inconsistent success status, pending cancellation and unsynced blood claims never send',async()=>{
 const f=fixture(),worker=createRegistrationNotifications(f.base,{enabled:()=>true,send:async()=>assert.fail('invalid confirmation must not send')});
 await worker.reconcile({events:[event],registrations:[{...registration,是否报名成功:'false'}]});
 await worker.reconcile({events:[event],registrations:[{...registration,请假状态:'待审批'}]});
 await worker.reconcile({events:[{...event,报名页配置:JSON.stringify({source:{kind:'generated_blood'}})}],registrations:[registration]});
 assert.equal(f.tables[NOTIFICATION_TABLE].length,1);
});
test('exhausted or not-yet-due retries cannot starve new confirmation tasks',async()=>{
 const f=fixture(),sent=[],worker=createRegistrationNotifications(f.base,{now:f.now,enabled:()=>true,send:async m=>{sent.push(m);return {ok:true,transport:'smtp'};}});
 const registrations=Array.from({length:12},(_,n)=>({...registration,_id:`r-${n}`,报名ID:`WR-${n}`}));
 for(let n=0;n<11;n++)f.tables[NOTIFICATION_TABLE].push({_id:`t-${n}`,幂等键:`WF-RESULT:WR-${n}:yes`,报名ID:`WR-${n}`,状态:'发送失败',尝试次数:n%2?'5':'1',下次尝试:new Date(f.now()+3600000).toISOString(),收件人:registration.邮箱});
 await worker.reconcile({events:[event],registrations});assert.equal(sent.length,1);assert.equal(sent[0].idempotencyKey,'WF-RESULT:WR-11:yes');
});
