import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistrationNotifications,leaveDecisionMessage,NOTIFICATION_TABLE} from '../lib/events/registration-notifications.js';

function fixture(send=async()=>({ok:true,transport:'smtp'})){
 const tasks=[{_id:'baseline',幂等键:'INIT:REGISTRATION-NOTIFICATIONS',状态:'历史未补发'}];
 const event={_id:'e',活动ID:'event',活动名称:'合成活动',报名页配置:'{}'};
 const row={_id:'r',报名ID:'WR-fixture',活动ID:'event',学号:'999999',邮箱:'999999@smail.nju.edu.cn',姓名:'合成同学',报名状态:'待筛选',是否报名成功:'false',请假状态:'待审批',请假申请时间:'2030-01-01T00:00:00Z'};
 let time=Date.parse('2030-01-02T00:00:00Z');const sent=[];
 const base={listRows:async(t,_v,_o,_c,s=0,n=500)=>{assert.equal(t,NOTIFICATION_TABLE);return structuredClone(tasks.slice(s,s+n));},appendRow:async(t,r)=>{assert.equal(t,NOTIFICATION_TABLE);const saved={...r,_id:`task-${tasks.length}`};tasks.push(saved);return {_id:saved._id};},updateRow:async(t,id,p)=>{assert.equal(t,NOTIFICATION_TABLE);Object.assign(tasks.find(r=>r._id===id),p);}};
 const worker=()=>createRegistrationNotifications(base,{origin:'https://fixture.invalid',now:()=>time,enabled:()=>true,send:async m=>{sent.push(m);return send(m);}});
 const commit=(approved=true,reason='合成决定')=>Object.assign(row,{请假状态:approved?'已批准':'已驳回',处理说明:reason,...(approved?{报名状态:'已请假',是否报名成功:'false'}:{})});
 return {tasks,event,row,base,sent,worker,commit,data:{events:[event],registrations:[row]},advance:()=>{time+=3600000;}};
}

test('leave intent survives restart, waits for commit and sends approved cancellation exactly once',async()=>{
 const f=fixture(),w=f.worker(),decision={approved:true,reason:'合成决定'};
 await Promise.all([w.prepareLeaveDecision(f.event,f.row,decision),w.prepareLeaveDecision(f.event,f.row,decision)]);
 assert.equal(f.tasks.length,2);await w.reconcile(f.data);assert.equal(f.sent.length,0);
 f.commit();await f.worker().reconcile(f.data);await f.worker().reconcile(f.data);
 assert.equal(f.sent.length,1);assert.match(f.sent[0].text,/已批准/);assert.equal(f.tasks[1].状态,'已发送');
 assert.equal(f.row.报名状态,'已请假');
});

test('rejected leave retries only known failures with stable key and a bounded budget',async()=>{
 const f=fixture(async()=>({ok:false,retryable:true})),w=f.worker();
 await w.prepareLeaveDecision(f.event,f.row,{approved:false,reason:'合成决定'});f.commit(false);
 await w.reconcile(f.data);await w.reconcile(f.data);assert.equal(f.sent.length,1);
 for(let i=0;i<8;i++){f.advance();await f.worker().reconcile(f.data);}
 assert.equal(f.sent.length,5);assert.equal(new Set(f.sent.map(m=>m.idempotencyKey)).size,1);
 assert.match(f.sent[0].text,/已驳回/);assert.equal(f.row.报名状态,'待筛选');
});

test('a rejected leave can be requested again without deduplicating the new decision',async()=>{
 const f=fixture(),w=f.worker();
 await w.prepareLeaveDecision(f.event,f.row,{approved:false,reason:'合成决定'});f.commit(false);await w.reconcile(f.data);
 Object.assign(f.row,{请假状态:'待审批',请假申请时间:'2030-01-03T00:00:00Z'});
 await w.prepareLeaveDecision(f.event,f.row,{approved:false,reason:'合成决定'});f.commit(false);await w.reconcile(f.data);
 assert.equal(f.sent.length,2);assert.notEqual(f.sent[0].idempotencyKey,f.sent[1].idempotencyKey);
});

test('later registration notes do not suppress a committed leave notification',async()=>{
 const f=fixture(),w=f.worker();
 await w.prepareLeaveDecision(f.event,f.row,{approved:false,reason:'合成决定'});f.commit(false);
 f.row.处理说明='后续报名处理';
 await w.reconcile(f.data);assert.equal(f.sent.length,1);assert.match(f.sent[0].text,/处理说明：合成决定/);
});

test('retrying an uncommitted decision updates its frozen notes without creating duplicate mail',async()=>{
 const f=fixture(),w=f.worker();
 await w.prepareLeaveDecision(f.event,f.row,{approved:false,reason:'原说明'});
 await w.prepareLeaveDecision(f.event,f.row,{approved:false,reason:'修订说明'});
 assert.equal(f.tasks.length,2);f.commit(false,'修订说明');
 await w.reconcile(f.data);assert.equal(f.sent.length,1);assert.match(f.sent[0].text,/处理说明：修订说明/);
});

test('unknown SMTP or lost receipt never blindly retries',async()=>{
 for(const mode of ['throw','receipt']){
  const f=fixture(async()=>{if(mode==='throw')throw Error('unknown SMTP');return {ok:true,transport:'smtp'};}),w=f.worker();
  await w.prepareLeaveDecision(f.event,f.row,{approved:true,reason:'合成决定'});f.commit();
  const update=f.base.updateRow;
  if(mode==='receipt')f.base.updateRow=async(t,id,p)=>{if(p.状态==='已发送')throw Error('lost receipt');return update(t,id,p);};
  if(mode==='receipt')await assert.rejects(w.reconcile(f.data),/lost receipt/);else await w.reconcile(f.data);
  f.base.updateRow=update;f.advance();await f.worker().reconcile(f.data);
  assert.equal(f.sent.length,1);assert.equal(f.tasks[1].状态,'结果待核对');
 }
});

test('mismatched or superseded decisions cancel intents and address changes require review',async()=>{
 for(const mode of ['decision','request','address']){
  const f=fixture(),w=f.worker();await w.prepareLeaveDecision(f.event,f.row,{approved:true,reason:'合成决定'});
  f.commit(mode!=='decision');
  if(mode==='request')Object.assign(f.row,{请假状态:'待审批',请假申请时间:'2030-01-04T00:00:00Z'});
  if(mode==='address')f.row.邮箱='999999@nju.edu.cn';
  await w.reconcile(f.data);assert.equal(f.sent.length,0);
  assert.equal(f.tasks[1].状态,mode==='address'?'结果待核对':'已取消');
 }
});

test('historical leave decisions are not backfilled, incomplete snapshots cannot cancel intents',async()=>{
 const f=fixture(),w=f.worker();f.commit();await w.reconcile(f.data);assert.equal(f.tasks.length,1);
 f.row.请假状态='待审批';f.row.报名状态='待筛选';await w.prepareLeaveDecision(f.event,f.row,{approved:true,reason:'合成决定'});
 const registrations=[];registrations.readMeta={truncated:true};
 await assert.rejects(w.reconcile({events:[f.event],registrations}),/数据读取不完整/);
 assert.equal(f.tasks[1].状态,'待发送');assert.equal(f.sent.length,0);
});

test('leave queue fails closed on missing baseline or invalid identity',async()=>{
 const f=fixture(),w=f.worker();f.tasks.length=0;
 await assert.rejects(w.prepareLeaveDecision(f.event,f.row,{approved:true,reason:'合成决定'}),/baseline/);
 assert.throws(()=>leaveDecisionMessage(f.event,{...f.row,请假申请时间:''},{approved:true,reason:'合成决定'}),/identity/);
 assert.throws(()=>leaveDecisionMessage(f.event,{...f.row,邮箱:'other@example.invalid'},{approved:true,reason:'合成决定'}),/address/);
 assert.equal(f.sent.length,0);
});
