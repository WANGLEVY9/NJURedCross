import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,workflowEventApproved} from '../lib/events/workflow.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';
import {rosterReview,rosterRow,publishedRosterRow,rosterMailKey} from '../public/app/shared/roster-review.js';

async function fixture(count=2){
 let seq=0;const tables=Object.fromEntries(Object.values(WF).map(t=>[t,[]]));
 const base={listRows:async(t,_v,_o,_c,s=0,n=500)=>structuredClone(tables[t].slice(s,s+n)),appendRow:async(t,r)=>{const row={...r,_id:'row-'+(++seq)};tables[t].push(row);return {_id:row._id};},updateRow:async(t,id,p)=>Object.assign(tables[t].find(r=>r._id===id),p)};
 const w=createWorkflow(base,{now:()=>Date.parse('2026-10-01T08:00+08:00')});
 const e=await w.create({name:'合成名单',date:'2026-10-12',slot:'09:00-12:00',capacity:20,registrationLimit:30,serviceHours:3,location:'合成场地',work:'合成服务'},'owner');await w.approve(e._id,'reviewer');await w.publish(e._id);
 const people=Array.from({length:count},(_,i)=>({accountId:'p'+i,realName:'合成同学'+i,studentId:String(999900+i),email:String(999900+i)+'@smail.nju.edu.cn',emailVerified:true}));
 for(const p of people)await w.register(e._id,p);
 const event=()=>tables[WF.events][0],rows=()=>tables[WF.registrations],token=async()=>(await w.overview()).events[0].rosterToken;
 const stage=async(ids,decision='confirm',reason='合成原因')=>w.stageRoster(e._id,ids,decision,reason,await token());
 const finalize=async()=>w.finalizeRoster(e._id,await token(),'reviewer');
 return {w,base,tables,event,rows,people,token,stage,finalize,id:e._id};
}

test('draft decisions persist across reload without exposing results or reasons; both results can be undone',async()=>{
 const f=await fixture(),[a,b]=f.rows();await f.stage([a._id]);await f.stage([b._id],'reject','内部暂定理由');
 assert.equal(a.报名状态,'待筛选');assert.equal(b.处理说明,undefined);assert.equal(rosterRow(f.event(),b).报名状态,'未入选');assert.ok(workflowEventApproved(f.event()));
 const restarted=createWorkflow(f.base);assert.equal(rosterReview((await restarted.overview()).events[0]).drafts[b._id].reason,'内部暂定理由');
 const ctx={requirePortalSession:()=>({}),getWorkflow:async()=>f.w,getAccount:async()=>({...f.people[1],status:'active'}),json:(_res,status,body)=>({status,body})};
 const response=await workflowRoutes({method:'GET',headers:{}},null,new URL('http://local/api/portal/workflow/me'),ctx);
 assert.equal(response.body.registrations[0].result,'名单确认中');assert.equal(response.body.registrations[0].reason,'');assert.ok(!JSON.stringify(response.body).includes('内部暂定理由'));
 await f.stage([a._id,b._id],'reset');assert.equal(rosterRow(f.event(),a).报名状态,'待筛选');assert.equal(rosterRow(f.event(),b).报名状态,'待筛选');
 await assert.rejects(f.finalize(),/先处理完/);
});

test('finalization rejects incomplete, stale, foreign, leave and protected rows without publishing',async()=>{
 const f=await fixture(),[a,b]=f.rows(),old=await f.token();
 await assert.rejects(f.finalize(),/先处理完/);await assert.rejects(f.stage(['foreign']),/不能调整/);
 await f.stage([a._id]);await assert.rejects(f.w.stageRoster(f.id,[b._id],'confirm','',old),/名单已变化/);
 b.请假状态='待审批';await assert.rejects(f.stage([b._id]),/不能调整/);await assert.rejects(f.finalize(),/先处理完/);
 b.请假状态='';b.签到照片ID='evidence';await assert.rejects(f.stage([b._id]),/不能调整/);
 assert.equal(f.rows().filter(r=>r.报名状态==='已确认').length,0);
});

test('final confirmation atomically publishes both outcomes, closes new registration, and blocks editing until reopened',async()=>{
 const f=await fixture(),[a,b]=f.rows();await f.stage([a._id]);await f.stage([b._id],'reject');await f.finalize();
 assert.equal(a.报名状态,'已确认');assert.equal(b.报名状态,'未入选');assert.equal(rosterReview(f.event()).phase,'final');assert.ok(workflowEventApproved(f.event()));
 await assert.rejects(f.stage([a._id],'reset'),/先进入修改名单/);
 await assert.rejects(f.w.register(f.id,{...f.people[0],accountId:'new',studentId:'888888',email:'888888@smail.nju.edu.cn'}),/未开放/);
 await f.w.reopenRoster(f.id,await f.token());await f.stage([a._id],'reset');assert.equal(a.报名状态,'已确认');assert.equal(rosterRow(f.event(),a).报名状态,'待筛选');
});

test('interrupted row writes expose no partial results and resume the frozen target after restart',async()=>{
 const f=await fixture(),[a,b]=f.rows();await f.stage([a._id]);await f.stage([b._id],'reject');
 const update=f.base.updateRow;let fail=true;
 f.base.updateRow=async(t,id,p)=>{if(t===WF.registrations&&id===b._id&&fail){fail=false;throw Error('storage interruption');}return update(t,id,p);};
 await assert.rejects(f.finalize(),/storage interruption/);assert.equal(a.报名状态,'已确认');assert.equal(rosterReview(f.event()).phase,'publishing');
 assert.equal(publishedRosterRow(f.event(),a).报名状态,'待筛选');assert.equal(publishedRosterRow(f.event(),b).处理说明,'');
 await assert.rejects(f.w.checkin(a._id,'reviewer','evidence'),/名单正在/);await assert.rejects(f.w.close(f.id),/完成名单提交/);
 const restarted=createWorkflow(f.base);await restarted.finalizeRoster(f.id,(await restarted.overview()).events[0].rosterToken,'reviewer');
 assert.equal(rosterReview(f.event()).phase,'final');assert.equal(b.报名状态,'未入选');assert.ok(workflowEventApproved(f.event()));
});

test('notifications require finalization, recover in batches, and retry failures without resending successes',async()=>{
 const f=await fixture(12),ids=f.rows().map(r=>r._id),calls=[];let fail=true;
 const send=async m=>{calls.push(m);return {ok:!(fail&&m.to===f.people[0].email),transport:'synthetic'};};
 await f.stage(ids);await assert.rejects(f.w.deliverRoster(f.id,{send}),/最终确认/);assert.equal(calls.length,0);await f.finalize();
 const first=await f.w.deliverRoster(f.id,{send});assert.equal(first.delivered,9);assert.equal(first.failedCount,1);assert.equal(first.remaining,2);
 const second=await f.w.deliverRoster(f.id,{send});assert.equal(second.delivered,11);assert.equal(second.remaining,0);assert.equal(calls.length,12);
 fail=false;const retry=await f.w.deliverRoster(f.id,{send,retry:true});assert.equal(retry.delivered,12);assert.equal(calls.length,13);
 await f.w.deliverRoster(f.id,{send,retry:true});assert.equal(calls.length,13);
});

test('large failure retry runs do not repeatedly retry the same failed recipient',async()=>{
 const f=await fixture(12);await f.stage(f.rows().map(r=>r._id));await f.finalize();let calls=0;
 const send=async()=>{calls++;return {ok:false};};
 await f.w.deliverRoster(f.id,{send});await f.w.deliverRoster(f.id,{send});assert.equal(calls,12);
 let r=await f.w.deliverRoster(f.id,{send,retry:true});assert.equal(r.remaining,2);
 r=await f.w.deliverRoster(f.id,{send});assert.equal(r.remaining,0);assert.equal(calls,24);
});

test('changed published outcomes get new mail keys, unchanged people are not notified again',async()=>{
 const f=await fixture(),[a,b]=f.rows(),calls=[];const send=async m=>{calls.push(m);return {ok:true};};
 await f.stage([a._id,b._id]);await f.finalize();await f.w.deliverRoster(f.id,{send});const first=calls[0].idempotencyKey;
 await f.w.reopenRoster(f.id,await f.token());await f.stage([a._id],'reset');await f.stage([a._id],'reject');await f.finalize();await f.w.deliverRoster(f.id,{send});assert.equal(calls.length,3);
 await f.w.reopenRoster(f.id,await f.token());await f.stage([a._id],'reset');await f.stage([a._id]);await f.finalize();await f.w.deliverRoster(f.id,{send});assert.equal(calls.length,4);assert.notEqual(calls[3].idempotencyKey,first);
});

test('an uncertain SMTP attempt is not blindly resent; durable mail evidence resolves it',async()=>{
 const f=await fixture(1),[a]=f.rows();await f.stage([a._id]);await f.finalize();
 const update=f.base.updateRow;let sent=false,calls=0;
 f.base.updateRow=async(t,id,p)=>{if(sent&&t===WF.events){sent=false;throw Error('receipt write interrupted');}return update(t,id,p);};
 const send=async()=>{calls++;sent=true;return {ok:true};};
 await assert.rejects(f.w.deliverRoster(f.id,{send}),/receipt write interrupted/);assert.equal(calls,1);
 const retry=await f.w.deliverRoster(f.id,{send,retry:true});assert.equal(retry.unknown.length,1);assert.equal(calls,1);
 const key=rosterMailKey(a,rosterReview(f.event()).published[a._id]);
 const resolved=await f.w.deliverRoster(f.id,{send,statuses:async()=>({[key]:{status:'sent',sentAt:'2026-10-07'}})});assert.equal(resolved.delivered,1);assert.equal(calls,1);
});

test('a leave approved after a draft is not accidentally restored by finalization',async()=>{
 const f=await fixture(),[a,b]=f.rows();await f.stage([a._id,b._id]);await f.w.requestLeave(a.报名ID,f.people[0],'无法参加');await f.w.decideLeave(a._id,true,'批准');
 assert.equal(rosterRow(f.event(),a).报名状态,'已请假');await f.finalize();assert.equal(a.报名状态,'已请假');assert.equal(Object.keys(rosterReview(f.event()).published).length,1);
});
