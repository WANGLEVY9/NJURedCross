import {test} from 'node:test';
import assert from 'node:assert/strict';
import {placePlan,createOrdinaryPlaces,PLACE_TABLE} from '../lib/events/ordinary-places.js';
import {confirmationMessage,createRegistrationNotifications,NOTIFICATION_TABLE} from '../lib/events/registration-notifications.js';
const event={_id:'event-row',活动ID:'event',活动名称:'合成活动',容量:'30',报名日期:'2030-10-29',报名时段:'08:30–10:30',岗位:'服务岗',地点:'合成地点',报名页配置:JSON.stringify({ordinary:{groupId:'group'}})};
const registration={_id:'registration-row',报名ID:'WR-test',活动ID:'event',学号:'999990001',姓名:'合成同学',邮箱:'999990001@smail.nju.edu.cn',报名状态:'已确认',报名日期:event.报名日期,报名时段:event.报名时段,岗位:event.岗位};
function fixture(){
 const tables={[PLACE_TABLE]:[],[NOTIFICATION_TABLE]:[{_id:'baseline',幂等键:'INIT:REGISTRATION-NOTIFICATIONS',状态:'历史未补发'}]};let seq=0,time=Date.parse('2030-10-12T00:00:00Z');
 const base={async listRows(t,_v,_o,_c,s=0,n=500){return structuredClone(tables[t].slice(s,s+n));},async appendRow(t,row){const value={...row,_id:`row-${++seq}`};tables[t].push(value);return {_id:value._id};},async updateRow(t,id,patch){Object.assign(tables[t].find(r=>r._id===id),patch);}};
 return {base,tables,now:()=>time,advance:()=>{time+=3600000;}};
}
test('16 sessions reserve exactly 480 seats without creating fake registrations',()=>{
 const sessions=Array.from({length:16},(_,n)=>({...event,活动ID:`session-${n}`}));assert.equal(placePlan(sessions,[]).length,480);
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
 await worker.reconcile(data);await worker.reconcile(data);assert.equal(sent.length,1);assert.match(sent[0].text,/管理员批准/);assert.match(sent[0].text,/正式录入/);
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
