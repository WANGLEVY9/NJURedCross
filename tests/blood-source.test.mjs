import {withDisplayReads,clearDisplayReads} from '../lib/http/display-reads.js';
import {BLOOD_SHIFTS} from '../lib/events/blood-roster.js';
import {publicWorkflowEvents} from '../lib/events/public-workflow-events.js';
import {createActivityLifecycleStore} from '../lib/events/activity-lifecycle-store.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generatedBloodEvents,BLOOD_SOURCE_TABLE} from '../lib/events/blood-source.js';
import {createWorkflow,WF,workflowEventApproved} from '../lib/events/workflow.js';
const source=id=>({_id:id,日期:'2026-10-12T00:00:00+08:00',点位:'新街口中央',活动时间:'上午 11~15点',周次:46});
const account={accountId:'test-account',studentId:'999990001',realName:'合成同学',email:'999990001@smail.nju.edu.cn',emailVerified:true};
test('stopped source shifts become ended after their actual end time without modifying source rows',()=>{
 const rows=[{...source('stopped'),报名结果:'停点'}],before=structuredClone(rows);
 assert.equal(generatedBloodEvents(rows,Date.parse('2026-10-12T14:59:59+08:00'))[0].状态,'停点');
 assert.equal(generatedBloodEvents(rows,Date.parse('2026-10-12T15:00:00+08:00'))[0].状态,'已结束');
 assert.equal(generatedBloodEvents(rows,Date.parse('2027-01-01'))[0].状态,'已结束');
 assert.deepEqual(rows,before);
});
function fixture(options={}){let n=0;const tables=Object.fromEntries(Object.values(WF).map(t=>[t,[]]));tables[BLOOD_SOURCE_TABLE]=[source('a'),source('b')];const writes=[];
 const base={async listRows(t,_v,_o,_c,s=0,l=500){return structuredClone((tables[t]||[]).slice(s,s+l));},async appendRow(t,row){writes.push(t);const r={...row,_id:`test-${++n}`};tables[t].push(r);return {_id:r._id};},async updateRow(t,id,patch){writes.push(t);Object.assign(tables[t].find(r=>r._id===id),patch);}};
 return {tables,base,w:createWorkflow(base,{now:()=>Date.parse('2026-10-06T00:00:00+08:00'),...options,bloodSourceTable:BLOOD_SOURCE_TABLE}),writes};
}
test('generated definitions group position rows, use stable IDs, and omit personal fields',()=>{const events=generatedBloodEvents([source('a'),{...source('b'),姓名:'secret',邮箱:'secret@example.org',报名结果:'成功'}],0);assert.equal(events.length,1);assert.equal(events[0].容量,2);assert.equal(JSON.parse(events[0].报名页配置).sourceOccupied,1);assert.equal(JSON.stringify(events).includes('secret'),false);assert.equal(generatedBloodEvents([source('c')],0)[0]._id,events[0]._id);assert.equal(events[0].培训时长,1);assert.equal(events[0].服务时长,4);});
test('manual creation cannot bypass source automation by selecting the blood category',async()=>{
 const f=fixture();
 for(const body of [{center:'献血车专项',templateId:'general'},{templateId:'blood_vehicle'}]){
  await assert.rejects(f.w.create(body,'synthetic-chair'),{statusCode:409});
 }
 assert.deepEqual(f.writes,[]);
 assert.equal((await f.w.publicRead()).events.length,1);
});
test('a new generated week appears without creating or publishing workflow rows',async()=>{const f=fixture();const data=await f.w.publicRead();assert.equal(data.events.length,1);assert.ok(workflowEventApproved(data.events[0]));f.tables[BLOOD_SOURCE_TABLE].push({...source('c'),日期:'2026-10-19',周次:47});assert.equal((await f.w.publicRead()).events.length,2);assert.deepEqual(f.writes,[]);assert.equal(f.tables[WF.events].length,0);await assert.rejects(f.w.close(data.events[0]._id),{statusCode:409});});
test('generated source occupancy and concurrent pending requests enforce available slots',async()=>{const f=fixture();f.tables[BLOOD_SOURCE_TABLE][0].报名结果='成功';const e=(await f.w.publicRead()).events[0];const out=await Promise.allSettled([f.w.register(e._id,account),f.w.register(e._id,{...account,accountId:'second',studentId:'999990002',email:'999990002@smail.nju.edu.cn'})]);assert.equal(out.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(f.writes,[WF.registrations]);});
test('generated registration remains linked after the next week is added and source stop closes signup',async()=>{const f=fixture(),e=(await f.w.publicRead()).events[0],r=await f.w.register(e._id,account);await f.w.confirm(r._id);assert.equal((await f.w.read()).registrations[0].活动ID,e.活动ID);f.tables[BLOOD_SOURCE_TABLE][0].报名结果='停点';await assert.rejects(f.w.register(e._id,{...account,accountId:'other'}),{statusCode:409});});

test('management ends source schedule durably across refresh, restart and new same-month shifts',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'activity-lifecycle-'));
 const file=join(dir,'lifecycle.sqlite');let store=createActivityLifecycleStore(file);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>({complete:true,rows:[{accountId:'admin',region:'nanjing',role:'global',active:true,categories:[]}]})});
 const f=fixture({activityLifecycleStore:store,approvalRouting:routing});const event=(await f.w.read()).events[0];
 const registered=await f.w.register(event._id,account),before=structuredClone(f.tables[BLOOD_SOURCE_TABLE]);
 const state=await f.w.workspaceRemoval(event._id,'admin');assert.equal(state.canRemove,true);assert.equal(state.action,'end');
 const body={token:state.token,requestId:'source-schedule-end-request',reason:'合成提前结束'};await f.w.removeWorkspace(event._id,body,'admin');
 await f.w.removeWorkspace(event._id,body,'admin');assert.equal((await f.w.read()).events[0].状态,'已归档');assert.equal(publicWorkflowEvents(await f.w.publicRead()).length,0);
 assert.deepEqual(f.tables[BLOOD_SOURCE_TABLE],before);assert.equal((await f.w.read()).registrations[0]._id,registered._id);
 store.close();store=createActivityLifecycleStore(file);
 const restarted=createWorkflow(f.base,{bloodSourceTable:BLOOD_SOURCE_TABLE,activityLifecycleStore:store,approvalRouting:routing,now:()=>Date.parse('2026-10-06')});
 f.tables[BLOOD_SOURCE_TABLE].push({...source('next'),日期:'2026-10-19',周次:47});assert.ok((await restarted.read()).events.every(row=>row.状态==='已归档'));
 await assert.rejects(restarted.register(event._id,{...account,accountId:'new'}),{statusCode:409});
 f.tables[BLOOD_SOURCE_TABLE].push({...source('november'),日期:'2026-11-02',周次:49});assert.equal(publicWorkflowEvents(await restarted.publicRead()).length,1);
});

test('large source schedule permission and end each load one roster regardless of session count',async()=>{
 let rosterReads=0;const routing=createWorkspaceApprovalRouting({getRoster:async()=>{rosterReads++;return {complete:true,rows:[{accountId:'admin',region:'nanjing',role:'global',active:true,categories:[]}]};}});
 const f=fixture({approvalRouting:routing});f.tables[BLOOD_SOURCE_TABLE]=Array.from({length:150},(_,i)=>({...source('source-'+i),日期:`2026-10-${String(Math.floor(i/5)+1).padStart(2,'0')}`,活动时间:BLOOD_SHIFTS[i%5]}));
 const rows=(await f.w.catalog()).events;assert.equal(rows.length,150);const event=rows.find(row=>row.状态==='报名中');assert.ok(event);
 const state=await f.w.workspaceRemoval(event._id,'admin');assert.equal(state.canRemove,true);assert.equal(rosterReads,1);
 const before=structuredClone(f.tables[BLOOD_SOURCE_TABLE]);await f.w.removeWorkspace(event._id,{token:state.token,requestId:'large-source-end-request',reason:'合成验证'},'admin');assert.equal(rosterReads,2);assert.deepEqual(f.tables[BLOOD_SOURCE_TABLE],before);assert.deepEqual(f.writes,[]);assert.ok((await f.w.catalog()).events.every(row=>row.状态==='已归档'));
});

const controlRouting=createWorkspaceApprovalRouting({getRoster:async()=>({complete:true,rows:[{accountId:'control-admin',region:'nanjing',role:'global',active:true,categories:[]}]})});
const sourceToggle=(w,id,enabled,revision=0,actor='control-admin')=>w.setSourceRegistration(id,{enabled,revision,actor});
test('monthly source control blocks stale booking links, survives restart and new rows without source writes',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'source-registration-')),file=join(dir,'lifecycle.sqlite');
 let store=createActivityLifecycleStore(file),invalidations=0;
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const f=fixture({activityLifecycleStore:store,approvalRouting:controlRouting,onSourceLifecycleChanged:()=>invalidations++});
 const event=(await f.w.catalog()).events[0],sourceBefore=structuredClone(f.tables[BLOOD_SOURCE_TABLE]);
 const booking=await f.w.register(event._id,account);
 const closed=await sourceToggle(f.w,event._id,false);assert.equal(closed.revision,1);assert.equal(invalidations,1);
 assert.equal(publicWorkflowEvents(await f.w.publicRead()).length,0);
 await assert.rejects(f.w.register(event._id,{...account,accountId:'another'}),{statusCode:409});
 // Confirm an existing request after closure, without reopening recruitment.
 await f.w.confirm(booking._id);assert.equal((await f.w.read()).registrations[0]['报名状态'],'已确认');
 assert.deepEqual(f.tables[BLOOD_SOURCE_TABLE],sourceBefore);assert.ok(f.writes.every(table=>table===WF.registrations));
 assert.deepEqual(await sourceToggle(f.w,event._id,false),closed);
 store.close();store=createActivityLifecycleStore(file);
 const restarted=createWorkflow(f.base,{activityLifecycleStore:store,approvalRouting:controlRouting,bloodSourceTable:BLOOD_SOURCE_TABLE,now:()=>Date.parse('2026-10-06')});
 f.tables[BLOOD_SOURCE_TABLE].push({...source('later'),日期:'2026-10-19'},{...source('next-month'),日期:'2026-11-02'});
 let data=await restarted.publicRead();assert.equal(publicWorkflowEvents(data).length,1);assert.equal(publicWorkflowEvents(data)[0].date,'2026-11-02');
 const catalog=(await restarted.catalog()).events;assert.equal(JSON.parse(catalog.find(row=>row._id===event._id)['报名页配置']).sourceRegistration.enabled,false);
 await assert.rejects(sourceToggle(restarted,event._id,true,0),{statusCode:409});
 const reopened=await sourceToggle(restarted,event._id,true,1);assert.equal(reopened.revision,2);assert.equal(publicWorkflowEvents(await restarted.publicRead()).length,3);
 await assert.rejects(sourceToggle(restarted,event._id,false,1),{statusCode:409});
 const outcomes=await Promise.allSettled([sourceToggle(restarted,event._id,false,2),sourceToggle(restarted,event._id,true,2)]);
 assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[1].status,'rejected');
});
test('source controls fail closed without authority and reject ordinary users, bad input and ordinary activities',async()=>{
 const f=fixture({approvalRouting:controlRouting}),id=(await f.w.catalog()).events[0]._id;
 await assert.rejects(sourceToggle(f.w,id,false,0,'ordinary-user'),{statusCode:403});
 await assert.rejects(sourceToggle(f.w,id,'false'),{statusCode:400});
 await assert.rejects(sourceToggle(f.w,id,false,-1),{statusCode:400});
 const missing=fixture();await assert.rejects(sourceToggle(missing.w,id,false),{statusCode:503});
 f.tables[WF.events].push({_id:'ordinary',活动ID:'ordinary',状态:'草稿'});
 await assert.rejects(sourceToggle(f.w,'ordinary',false),{statusCode:409});assert.deepEqual(f.writes,[]);
 assert.equal(publicWorkflowEvents(await f.w.publicRead()).length,1);
});
test('reopening preserves past, stopped and permanently ended source sessions',async()=>{
 let clock=Date.parse('2026-10-06');const f=fixture({approvalRouting:controlRouting,now:()=>clock});
 const id=(await f.w.catalog()).events[0]._id;await sourceToggle(f.w,id,false);
 f.tables[BLOOD_SOURCE_TABLE].push({...source('past'),日期:'2026-10-01'},{...source('stopped'),日期:'2026-10-19',报名结果:'停点'});
 await sourceToggle(f.w,id,true,1);assert.equal(publicWorkflowEvents(await f.w.publicRead()).length,1);
 await sourceToggle(f.w,id,false,2);clock=Date.parse('2026-11-01');
 await assert.rejects(sourceToggle(f.w,id,true,3),{statusCode:409});
 clock=Date.parse('2026-10-06');const removal=await f.w.workspaceRemoval(id,'control-admin');
 await f.w.removeWorkspace(id,{token:removal.token,requestId:'source-control-end-test',reason:'合成结束测试'},'control-admin');
 await assert.rejects(sourceToggle(f.w,id,true,3),{statusCode:409});assert.deepEqual(f.writes,[]);
});
test('confirmed participants can submit attendance during source shift after recruitment closes',async()=>{
 let clock=Date.parse('2026-10-06');const f=fixture({approvalRouting:controlRouting,now:()=>clock});
 const id=(await f.w.catalog()).events[0]._id,booking=await f.w.register(id,account);await f.w.confirm(booking._id);
 await sourceToggle(f.w,id,false);clock=Date.parse('2026-10-12T11:15:00+08:00');
 assert.deepEqual(await f.w.submitAttendance(booking['报名ID'],account,'00000000-0000-0000-0000-000000000001'),{submitted:true});
 await f.w.checkin(booking._id,'control-admin','合成现场核验');
 assert.equal((await f.w.read()).registrations[0]['报名状态'],'已签到');
 const ledger=await f.w.reviewHours(booking._id,'control-admin');assert.equal(ledger['状态'],'待批准');
});

test('source registration decisions invalidate warm management display projections immediately',async()=>{
 clearDisplayReads();const f=fixture({approvalRouting:controlRouting});
 const first=await withDisplayReads(()=>f.w.catalog()),id=first.events[0]._id;
 await sourceToggle(f.w,id,false);
 const after=await withDisplayReads(()=>f.w.catalog());assert.equal(after.events[0]['状态'],'进行中');
 await sourceToggle(f.w,id,true,1);
 assert.equal((await withDisplayReads(()=>f.w.catalog())).events[0]['状态'],'报名中');clearDisplayReads();
});
