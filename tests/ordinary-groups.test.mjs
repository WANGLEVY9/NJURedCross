import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,workflowApprovalHash} from '../lib/events/workflow.js';
import {ORDINARY_GROUP_TABLE,ORDINARY_GROUP_COLUMNS,ordinaryRegistrationOpen} from '../lib/events/ordinary-groups.js';
import {createWishlist,WISHLIST_SCHEMA} from '../lib/events/wishlist.js';
import {projectWorkflowEvents} from '../lib/events/public-workflow.js';
import {bloodWeekPlan} from '../scripts/preview-blood-week-plan.mjs';

const account=(n=1)=>({accountId:`synthetic-${n}`,studentId:`99999000${n}`,realName:'合成测试同学',email:`99999000${n}@smail.nju.edu.cn`,emailVerified:true,campus:'鼓楼'});
async function fixture(capacity=30){
 let seq=0,time=Date.parse('2026-10-12T10:00:00+08:00');
 const tables=Object.fromEntries([...Object.values(WF),ORDINARY_GROUP_TABLE,WISHLIST_SCHEMA.name].map(t=>[t,[]]));
 const base={async listRows(t,_v,_o,_c,s=0,n=500){return structuredClone(tables[t].slice(s,s+n));},async getMetadata(){return {tables:[{name:ORDINARY_GROUP_TABLE,columns:ORDINARY_GROUP_COLUMNS.map(name=>({name,type:'text'}))}]};},async appendRow(t,row){const r={...row,_id:`row-${++seq}`};tables[t].push(r);return {_id:r._id};},async updateRow(t,id,patch){Object.assign(tables[t].find(r=>r._id===id),patch);}};
 const w=createWorkflow(base,{now:()=>time});const p=bloodWeekPlan();
 const group=await w.createOrdinaryGroup({groupId:p.projectId,name:p.name,work:p.work,registrationEnd:p.registrationEnd,sessions:p.sessions.map(s=>({...s,capacity}))},'organizer');
 for(const e of group.events){await w.submit(e._id);await w.approve(e._id,'reviewer');await w.publish(e._id);}
 await w.ordinarySettings(group.events[0]._id,{deadline:p.registrationEnd,enabled:true},'reviewer');
 const messages=[],wishlist=createWishlist(base,w,{now:()=>time,origin:'https://fixture.invalid',sendMail:async m=>{messages.push(m);return {ok:true};}});
 return {tables,w,events:group.events,p,wishlist,messages,setTime:value=>{time=Date.parse(value);}};
}
test('one public ordinary project contains 16 sessions and 480 places, no private metadata',async()=>{
 const f=await fixture(),data=await f.w.publicRead(),catalogue=projectWorkflowEvents(data.events,[]);
 assert.equal(catalogue.length,1);assert.equal(catalogue[0].sessions.length,16);assert.equal(catalogue[0].capacity,480);
 assert.equal(catalogue[0].registrationMode,'direct');assert.equal(catalogue[0].registrationEnd,f.p.registrationEnd);
 assert.ok(!JSON.stringify(catalogue).includes('organizer'));assert.equal(catalogue[0].blood,null);
});
test('project member lookup covers registrations in all child sessions',async()=>{
 const f=await fixture();
 await f.w.register(f.events[0]._id,account());
 await f.w.register(f.events[1]._id,account(2));
 const members=await f.w.members(f.events[0]._id);
 assert.equal(members.people.length,2);
});
test('configured project reviews and exports approved hours from multiple sessions',async()=>{
 const f=await fixture();
 for(const e of f.tables[WF.events]){const c=JSON.parse(e['报名页配置']);c.ordinary.hoursPending=false;c.service=2;e['服务时长']=2;e['报名页配置']=JSON.stringify(c);e['批准摘要']=workflowApprovalHash(e);}
 const a=await f.w.register(f.events[0]._id,account()),b=await f.w.register(f.events[1]._id,account(2));
 f.setTime('2026-10-30T18:00:00+08:00');
 const batch=await f.w.attendanceBatch(f.events[0]._id,[a,b].map(r=>({id:r._id,hours:{serviceHours:2,trainingHours:0,travelHours:0,work:'合成服务'}})),'checker');
 assert.equal(batch.succeeded,2);
 const review=await f.w.reviewDraft(f.events[0]._id);assert.equal(review.entries.length,2);
 const approved=await f.w.approveBatch(f.events[0]._id,review.entries.map(r=>({id:r._id,expectedDigest:r['核对摘要']})),'reviewer');
 assert.equal(approved.succeeded,2);
 const exported=await f.w.exportDraft(f.events[0]._id);assert.equal(exported.rows.length,2);assert.equal(exported.rows.reduce((sum,row)=>sum+row['服务时长'],0),4);
});
test('direct confirmation permits adjacent sessions but rejects duplicates and cross-venue overlap',async()=>{
 const f=await fixture(),w=f.w,a=account();
 const r=await w.register(f.events[0]._id,a);assert.equal(r['报名状态'],'已确认');assert.equal(r['录入状态'],'时长规则待确定');
 await assert.rejects(w.register(f.events[0]._id,a),{statusCode:409});
 await w.register(f.events[1]._id,a);
 await assert.rejects(w.register(f.events[4]._id,a),/重叠/);
 await w.register(f.events[8]._id,a);
 assert.equal(f.tables[WF.registrations].length,3);
});
test('concurrent last-place requests do not overbook; cancellation review retains place until approved',async()=>{
 const f=await fixture(1),id=f.events[0]._id,a=account(),b=account(2);
 const results=await Promise.allSettled([f.w.register(id,a),f.w.register(id,b)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const r=f.tables[WF.registrations][0],winner=r['账号ID']===a.accountId?a:b,other=winner===a?b:a;
 await f.w.requestLeave(r['报名ID'],winner,'合成课程冲突');
 await assert.rejects(f.w.register(id,other),/名额已满/);
 await f.w.decideLeave(r._id,false,'合成驳回');
 await assert.rejects(f.w.register(id,other),/名额已满/);
 await f.w.requestLeave(r['报名ID'],winner,'合成重新申请');
 await f.w.decideLeave(r._id,true,'合成批准');
 await f.w.register(id,other);
});
test('approved cancellation can be followed by a new owned registration, never reuses cancelled evidence',async()=>{
 const f=await fixture(),a=account(),id=f.events[0]._id,r=await f.w.register(id,a);
 await f.w.requestLeave(r['报名ID'],a,'合成申请');await f.w.decideLeave(r._id,true,'批准');
 const again=await f.w.register(id,a);assert.notEqual(again['报名ID'],r['报名ID']);assert.equal(again['报名状态'],'已确认');
 await assert.rejects(f.w.requestLeave(r['报名ID'],account(2),'非本人'),{statusCode:404});
});
test('full ordinary session sends one vacancy notice after approved cancellation, not before',async()=>{
 const f=await fixture(1),id=f.events[0]._id,a=account(),b=account(2),r=await f.w.register(id,a);
 await f.wishlist.subscribe(id,b);await f.wishlist.deliver();assert.equal(f.messages.length,0);
 await f.w.requestLeave(r['报名ID'],a,'合成冲突');await f.wishlist.deliver();assert.equal(f.messages.length,0);
 await f.w.decideLeave(r._id,true,'批准');await f.wishlist.deliver();await f.wishlist.deliver();
 assert.equal(f.messages.length,1);assert.match(f.messages[0].subject,/活动班次/);assert.equal(f.messages[0].to,b.email);
});
test('deadline is inclusive and administrative closure affects whole group but retains evidence',async()=>{
 const f=await fixture(),id=f.events[0]._id,r=await f.w.register(id,account());
 await f.w.ordinarySettings(id,{deadline:f.p.registrationEnd,enabled:false},'reviewer');
 await assert.rejects(f.w.register(f.events[1]._id,account()),/关闭/);
 assert.equal(f.tables[WF.registrations].length,1);
 await f.w.requestLeave(r['报名ID'],account(),'关闭后申请');
 await f.w.ordinarySettings(id,{deadline:f.p.registrationEnd,enabled:true},'reviewer');
 f.setTime(f.p.registrationEnd);await assert.rejects(f.w.register(f.events[1]._id,account()),/截止/);
 assert.ok((await f.w.publicRead()).events.every(e=>!ordinaryRegistrationOpen(e,Date.parse(f.p.registrationEnd))));
});
test('unconfigured hours cannot produce an approved ledger or export, including explicit fake hours',async()=>{
 const f=await fixture(),r=await f.w.register(f.events[0]._id,account());
 await assert.rejects(f.w.checkin(r._id,'checker','提前核验'),/尚未开始/);
 f.setTime('2026-10-29T09:00:00+08:00');
 await f.w.checkin(r._id,'checker','合成现场核验');
 await assert.rejects(f.w.reviewHours(r._id,'checker',{serviceHours:2}),/时长规则/);
 assert.equal(f.tables[WF.ledger].length,0);
 await assert.rejects(f.w.exportDraft(f.events[0]._id),{statusCode:409});
});
test('incomplete or unapproved session sets cannot be opened',async()=>{
 const f=await fixture(),id=f.events[0]._id;
 f.tables[WF.events].pop();await assert.rejects(f.w.ordinarySettings(id,{deadline:f.p.registrationEnd,enabled:true},'reviewer'),/不完整/);
});
