import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {createRegistrationNotifications,NOTIFICATION_TABLE} from '../lib/events/registration-notifications.js';
import {rosterReview} from '../public/app/shared/roster-review.js';

async function fixture(send=async()=>({ok:true,transport:'smtp'})){
 let seq=0,time=Date.parse('2030-01-01T00:00:00Z');const sent=[];
 const tables=Object.fromEntries(Object.values(WF).map(t=>[t,[]]));
 tables[NOTIFICATION_TABLE]=[{_id:'baseline',幂等键:'INIT:REGISTRATION-NOTIFICATIONS',状态:'历史未补发'}];
 const base={listRows:async(t,_v,_o,_c,s=0,n=500)=>structuredClone((tables[t]||[]).slice(s,s+n)),appendRow:async(t,r)=>{const row={...r,_id:`row-${++seq}`};tables[t].push(row);return {_id:row._id};},updateRow:async(t,id,p)=>Object.assign(tables[t].find(r=>r._id===id),p)};
 const w=createWorkflow(base,{now:()=>time});
 const event=await w.create({name:'合成重试活动',date:'2030-01-10',slot:'09:00-12:00',capacity:20,serviceHours:3,location:'合成场地',work:'合成工作'},'owner');
 await w.approve(event._id,'reviewer');await w.publish(event._id);
 for(let i=0;i<2;i++)await w.register(event._id,{accountId:`p${i}`,realName:'合成同学',studentId:`99999${i}`,email:`99999${i}@smail.nju.edu.cn`,emailVerified:true});
 const rows=tables[WF.registrations],current=()=>tables[WF.events][0];
 const token=async()=>(await w.overview()).events[0].rosterToken;
 const approve=async()=>w.stageRoster(event._id,[rows[0]._id],'confirm','',await token(),{immediate:true});
 const worker=()=>createRegistrationNotifications(base,{now:()=>time,enabled:()=>true,send:async m=>{sent.push(m);return send(m);}});
 const retry=async n=>n.retryReviewed(await w.read(),{deliverRoster:w.deliverRoster});
 return {w,base,tables,rows,event:current,token,approve,worker,retry,sent,advance:()=>{time+=3600000;}};
}

test('an individually published registration checks in while the rest remain pending',async()=>{
 const f=await fixture();await f.approve();
 assert.equal(rosterReview(f.event()).phase,'draft');assert.equal(f.rows[1].报名状态,'待筛选');
 await f.w.checkin(f.rows[0]._id,'reviewer','合成到场依据');
 assert.equal(f.rows[0].报名状态,'已签到');assert.equal(f.rows[1].报名状态,'待筛选');
});

test('checkin continues to reject a row whose published approval has a pending reset',async()=>{
 const f=await fixture();await f.approve();
 await f.w.stageRoster(f.event()._id,[f.rows[0]._id],'reset','',await f.token());
 await assert.rejects(f.w.checkin(f.rows[0]._id,'reviewer','合成到场依据'),/名单正在/);
});

test('reviewed worker retries known failure after backoff, repairs receipts and never resends success',async()=>{
 let calls=0;const f=await fixture(async()=>++calls===1?{ok:false,retryable:true}:{ok:true,transport:'smtp'});
 await f.approve();const worker=f.worker();
 await f.w.deliverRoster(f.event()._id,{send:worker.dispatch});assert.equal(f.sent.length,1);
 await f.retry(worker);assert.equal(f.sent.length,1);
 f.advance();await f.retry(f.worker());assert.equal(f.sent.length,2);
 assert.equal(Object.values(rosterReview(f.event()).deliveries)[0].status,'sent');
 await f.retry(f.worker());assert.equal(f.sent.length,2);assert.equal(f.sent[0].idempotencyKey,f.sent[1].idempotencyKey);
});

test('reviewed worker resumes a commit that did not reach its first dispatch',async()=>{
 const f=await fixture();await f.approve();await f.retry(f.worker());
 assert.equal(f.sent.length,1);assert.equal(f.rows[1].报名状态,'待筛选');
});

test('unknown transport outcome remains blocked across background wakeups',async()=>{
 const f=await fixture(async()=>{throw Error('uncertain SMTP');});await f.approve();
 const worker=f.worker();await f.w.deliverRoster(f.event()._id,{send:worker.dispatch});
 f.advance();await f.retry(worker);await f.retry(f.worker());
 assert.equal(f.sent.length,1);assert.equal(f.tables[NOTIFICATION_TABLE][1].状态,'结果待核对');
});

test('durable queue receipt recovers a lost roster receipt without resending',async()=>{
 const f=await fixture();await f.approve();const worker=f.worker(),update=f.base.updateRow;
 f.base.updateRow=async(t,id,p)=>{
  if(t===WF.events&&Object.values(JSON.parse(p.报名页配置||'{}').rosterReview?.deliveries||{}).some(r=>r.status==='sent'))throw Error('lost roster receipt');
  return update(t,id,p);
 };
 await assert.rejects(f.w.deliverRoster(f.event()._id,{send:worker.dispatch}),/lost roster receipt/);
 f.base.updateRow=update;await f.retry(f.worker());
 assert.equal(f.sent.length,1);assert.equal(Object.values(rosterReview(f.event()).deliveries)[0].status,'sent');
});

test('known durable failure safely recovers a roster left in sending state',async()=>{
 let calls=0;const f=await fixture(async()=>++calls===1?{ok:false,retryable:true}:{ok:true,transport:'smtp'});
 await f.approve();const worker=f.worker(),update=f.base.updateRow;
 f.base.updateRow=async(t,id,p)=>{
  if(t===WF.events&&Object.values(JSON.parse(p.报名页配置||'{}').rosterReview?.deliveries||{}).some(r=>r.status==='failed'))throw Error('lost failure receipt');
  return update(t,id,p);
 };
 await assert.rejects(f.w.deliverRoster(f.event()._id,{send:worker.dispatch}),/lost failure receipt/);
 f.base.updateRow=update;f.advance();await f.retry(f.worker());
 assert.equal(f.sent.length,2);assert.equal(Object.values(rosterReview(f.event()).deliveries)[0].status,'sent');
});

test('not-yet-due tasks do not consume reviewed batch budget ahead of new mail',async()=>{
 const f=await fixture(async()=>({ok:false,retryable:true}));
 for(let i=2;i<12;i++)await f.w.register(f.event()._id,{accountId:`p${i}`,realName:'合成同学',studentId:`9999${i}`,email:`9999${i}@smail.nju.edu.cn`,emailVerified:true});
 await f.w.stageRoster(f.event()._id,f.rows.map(r=>r._id),'confirm','',await f.token(),{immediate:true});
 const worker=f.worker();await f.retry(worker);assert.equal(f.sent.length,10);
 await f.retry(worker);assert.equal(f.sent.length,12);
 for(let i=0;i<8;i++){f.advance();await f.retry(worker);await f.retry(worker);}
 assert.equal(f.sent.length,60);
});

test('reviewed sends suppress pending leave, approved leave and a draft reversal',async()=>{
 for(const mode of ['pending','approved','draft']){
  const f=await fixture();await f.approve();
  if(mode==='draft')await f.w.stageRoster(f.event()._id,[f.rows[0]._id],'reset','',await f.token());
  else Object.assign(f.rows[0],{请假状态:mode==='pending'?'待审批':'已批准',...(mode==='approved'?{报名状态:'已请假',是否报名成功:'false'}:{})});
  await f.retry(f.worker());assert.equal(f.sent.length,0);
 }
});

test('bounded reviewed passes rotate across events instead of starving later events',async()=>{
 const n=createRegistrationNotifications({}),seen=[];
 const data={events:['a','b','c'].map(id=>({_id:id,活动ID:id,报名页配置:JSON.stringify({rosterReview:{phase:'draft',immediateCommit:true}})})),registrations:[]};
 const deliverRoster=async id=>{seen.push(id);return {};};
 await n.retryReviewed(data,{deliverRoster,maxEvents:1});await n.retryReviewed(data,{deliverRoster,maxEvents:1});await n.retryReviewed(data,{deliverRoster,maxEvents:1});
 assert.deepEqual(seen,['a','b','c']);
});
