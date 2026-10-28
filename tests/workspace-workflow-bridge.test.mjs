import {createWorkspaceDraftAuthorization} from '../lib/events/workspace-draft-access.js';
import {workspaceNotice} from '../public/app/shared/activity-workspace.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {ORDINARY_GROUP_TABLE} from '../lib/events/ordinary-groups.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,workflowApprovalHash,workflowEventApproved} from '../lib/events/workflow.js';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';
import {createWorkspaceSubmissions} from '../lib/events/workspace-submissions.js';
import {openWorkspaceDraftStore} from '../lib/events/workspace-draft-store.js';
import {createMutationQueue} from '../lib/events/safety.js';
import {createWorkspaceWorkflowBridge} from '../lib/events/workspace-workflow-bridge.js';
import {registrationOpen} from '../public/app/shared/activity-management.js';
import {assertWorkspaceResponsible} from '../lib/events/workspace-responsible.js';
import {placePlan} from '../lib/events/ordinary-places.js';
import {createActivityLifecycleStore} from '../lib/events/activity-lifecycle-store.js';
import {activityProjects} from '../public/app/shared/activity-projects.js';
import {withRequestBudget} from '../lib/http/request-budget.js';
import {planLegacyWorkspaceRecovery,extractLegacyWorkspaceEdit} from '../lib/events/workspace-legacy-recovery.js';
import {workspaceEditDigest} from '../lib/events/workspace-live-edit.js';

test('legacy recovery reconstructs only the signed completed edit, preserving all job and booking identities',async t=>{
 const f=await fixture(t),event=await publishFixture(f),previous=structuredClone(event),source=await f.bridge.content(event._id);
 const body={expectedVersion:source.version,token:source.token,content:{...source.content,name:'恢复的合成活动'}};
 await f.bridge.save(event._id,body,'sz-chair');
 const pending={status:'applying',actor:'sz-chair',token:body.token,expectedVersion:body.expectedVersion,digest:workspaceEditDigest(body.content),content:body.content,plan:{truncated:'x'.repeat(20_000)}};
 const parent={...previous,报名页配置:JSON.stringify({...JSON.parse(previous['报名页配置']),workspaceEdit:pending}).slice(0,10_000)};
 const children=f.tables[WF.events].filter(row=>row._id!==event._id);
 const registration={_id:'original-row',报名ID:'original-booking',活动ID:children[0]['活动ID'],账号ID:'person',学号:'student',活动名称:'旧显示名称',报名日期:children[0]['报名日期'],报名时段:children[0]['报名时段'],岗位:children[0]['岗位'],报名状态:'已确认'};
 const data={parent,events:[parent,...children],registrations:[registration],checkins:[],ledger:[],groups:f.tables[ORDINARY_GROUP_TABLE]},snapshot=structuredClone(data);
 assert.equal(extractLegacyWorkspaceEdit(parent).pending.digest,pending.digest);
 const result=await planLegacyWorkspaceRecovery(data);
 assert.deepEqual(data,snapshot);assert.equal(result.parentPatch['活动ID'],parent['活动ID']);assert.equal(Number(result.parentPatch['申请版本']),source.version+1);assert.equal(workflowEventApproved({...parent,...result.parentPatch}),true);
 assert.deepEqual(result.receipt.plan.jobs.map(job=>job.id),children.map(row=>row._id));assert.deepEqual(result.registrationPatches,[{id:registration._id,patch:{活动名称:body.content.name,报名日期:children[0]['报名日期'],报名时段:children[0]['报名时段'],岗位:children[0]['岗位']}}]);assert.deepEqual(result.groupPatch,{});
 const corrupted=structuredClone(data);corrupted.events[1]['容量']='99';corrupted.events[1]['批准摘要']=workflowApprovalHash(corrupted.events[1]);
 await assert.rejects(planLegacyWorkspaceRecovery(corrupted),/已批准岗位与原请求不一致/);
 await assert.rejects(planLegacyWorkspaceRecovery({...data,checkins:[{活动ID:children[0]['活动ID']}]}),/已有签到或时长证据/);
 await assert.rejects(planLegacyWorkspaceRecovery({...data,groups:[]}),/项目控制行/);
 const wrong=structuredClone(data);wrong.parent['报名页配置']=wrong.parent['报名页配置'].replace(pending.digest,'0'.repeat(64));
 await assert.rejects(planLegacyWorkspaceRecovery(wrong),/内容摘要不一致/);
});

test('resuming an interrupted edit retains newer roster-review decisions and never rewrites booked rows unnecessarily',async t=>{
 const f=await fixture(t),event=await publishFixture(f),source=await f.bridge.content(event._id),body={expectedVersion:source.version,token:source.token,content:{...source.content,description:'原请求说明'}};
 const update=f.base.updateRow;let failed=false;
 f.base.updateRow=async(table,id,patch)=>{await update(table,id,patch);if(!failed&&table===ORDINARY_GROUP_TABLE&&patch['报名开关']==='开放'){failed=true;throw Error('lost group ACK');}};
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),/lost group ACK/);
 const child=f.tables[WF.events].find(row=>JSON.parse(row['报名页配置']).parentActivityId===event['活动ID']),config=JSON.parse(child['报名页配置']);
 config.rosterReview={status:'updated-after-edit',entries:[{id:'booking',decision:'confirm'}],delivery:{key:'sent-once'}};child['报名页配置']=JSON.stringify(config);assert.equal(workflowEventApproved(child),true);
 const snapshot=structuredClone(child);
 await f.bridge.save(event._id,body,'sz-chair');assert.deepEqual(child,snapshot);assert.equal(JSON.parse(event['报名页配置']).workspaceEdit.status,'complete');
});

test('recovery retains newer project contact information without discarding the original edits own contact change',async t=>{
 const f=await fixture(t),event=await publishFixture(f),source=await f.bridge.content(event._id);
 const body={expectedVersion:source.version,token:source.token,content:{...source.content,qqGroup:'123456789',notes:'planned notes'}};
 const update=f.base.updateRow;let failed=false;
 f.base.updateRow=async(table,id,patch)=>{await update(table,id,patch);if(!failed&&table===ORDINARY_GROUP_TABLE&&patch['报名开关']==='开放'){failed=true;throw Error('lost group ACK');}};
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),/lost group ACK/);
 const planned=JSON.parse(event['报名页配置']).registrationContact;
 assert.equal(planned.qqGroup,'123456789');assert.equal(planned.notes,'planned notes');
 const newer={qqGroup:'987654321',invitation:'new invitation',notes:'updated after interruption'};
 for(const row of f.tables[WF.events]){const c=JSON.parse(row['报名页配置']);c.registrationContact=newer;row['报名页配置']=JSON.stringify(c);}
 await f.bridge.save(event._id,body,'sz-chair');
 for(const row of f.tables[WF.events]){assert.deepEqual(JSON.parse(row['报名页配置']).registrationContact,newer);assert.equal(workflowEventApproved(row),true);}
});

test('single-position edit recovery also retains a newer parent roster review',async t=>{
 const input={...content,bookingMode:'unified',start:'09:15',end:'11:45',location:'合成地点',capacity:'20',serviceHours:'2.5',trainingHours:'0',travelHours:'0',work:'合成服务',positions:[]};
 const f=await fixture(t,{input}),event=await publishFixture(f),source=await f.bridge.content(event._id),body={expectedVersion:source.version,token:source.token,content:{...source.content,description:'修改说明'}};
 const update=f.base.updateRow;let failed=false;
 f.base.updateRow=async(table,id,patch)=>{await update(table,id,patch);if(!failed&&table===WF.events&&JSON.parse(patch['报名页配置']||'{}').workspaceEdit?.status==='finishing'){failed=true;throw Error('lost parent ACK');}};
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),/lost parent ACK/);
 const c=JSON.parse(event['报名页配置']);c.rosterReview={entries:[{id:'original-booking',decision:'confirm'}],delivery:{key:'already-sent'}};event['报名页配置']=JSON.stringify(c);
 await f.bridge.save(event._id,body,'sz-chair');assert.deepEqual(JSON.parse(event['报名页配置']).rosterReview,c.rosterReview);assert.equal(workflowEventApproved(event),true);
});

test('a resumed batch cannot overwrite rows now maintained by the blood source',async t=>{
 const f=await fixture(t),event=await publishFixture(f),source=await f.bridge.content(event._id);
 const body={expectedVersion:source.version,token:source.token,content:{...source.content,description:'修改说明'}};
 const update=f.base.updateRow;let failed=false;
 f.base.updateRow=async(table,id,patch)=>{await update(table,id,patch);if(!failed&&table===ORDINARY_GROUP_TABLE&&patch['报名开关']==='开放'){failed=true;throw Error('lost group ACK');}};
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),/lost group ACK/);
 const children=f.tables[WF.events].filter(row=>JSON.parse(row['报名页配置']).parentActivityId===event['活动ID']);
 for(const row of children){const c=JSON.parse(row['报名页配置']);c.source={kind:'generated_blood'};row['报名页配置']=JSON.stringify(c);}
 const snapshot=structuredClone(children);let batches=0;
 f.base.batchUpdateRows=async()=>{batches++;};
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),/献血车班次由排班表维护/);
 assert.equal(batches,0);assert.deepEqual(children,snapshot);
});

test('16 jobs and 120 bookings use scoped reads and batches, survive partial writes and keep every identity',async t=>{
 const input={...content,positions:Array.from({length:16},(_,i)=>({...content.positions[i%2],id:'job-'+i,name:'岗位'+i,capacity:'20'}))};
 const f=await fixture(t,{input}),event=await publishFixture(f),before=await f.bridge.content(event._id);
 const children=f.tables[WF.events].filter(row=>JSON.parse(row['报名页配置']).parentActivityId===event['活动ID']);
 for(let i=0;i<120;i++)f.tables[WF.registrations].push({_id:'booking-'+i,报名ID:'code-'+i,活动ID:children[i%16]['活动ID'],账号ID:'person-'+i,学号:'student-'+i,报名状态:'已确认',姓名:'合成同学',活动名称:event['活动名称'],报名日期:children[i%16]['报名日期'],报名时段:children[i%16]['报名时段'],岗位:children[i%16]['岗位']});
 const identities=f.tables[WF.registrations].map(row=>[row._id,row['报名ID'],row['活动ID'],row['账号ID']]);
 const queries=[],reads=[],batches=[];let partial=true;
 const wait=()=>new Promise(resolve=>setTimeout(resolve,15)),update=f.base.updateRow,list=f.base.listRows;
 f.base.query=async sql=>{
  queries.push(sql);await wait();
  const match=/FROM `([^`]+)` WHERE `([^`]+)` IN \((.*?)\) LIMIT 1000 OFFSET (\d+)/.exec(sql);assert.ok(match,sql);
  const values=[...match[3].matchAll(/'([^']*)'/g)].map(value=>value[1]),offset=Number(match[4]);
  return structuredClone(f.tables[match[1]].filter(row=>values.includes(row[match[2]])).slice(offset,offset+1000));
 };
 f.base.listRows=async(table,...args)=>{reads.push(table);assert.equal(table,WF.events,'no full evidence scans');await wait();return list(table,...args);};
 f.base.updateRow=async(...args)=>{await wait();return update(...args);};
 f.base.batchUpdateRows=async(table,items)=>{
  batches.push({table,count:items.length});await wait();
  if(partial&&table===WF.events){partial=false;for(const item of items.slice(0,8))await update(table,item.row_id,item.row);throw Error('synthetic partial batch');}
  for(const item of items)await update(table,item.row_id,item.row);return {};
 };
 await f.bridge.content(event._id,'sz-chair',structuredClone(f.tables[WF.events]));
 assert.equal(reads.length,0);assert.ok(!queries.some(sql=>sql.includes(WF.registrations)));
 queries.length=0;
 const body={expectedVersion:before.version,token:before.token,content:{...before.content,name:'修改后的合成活动'}};
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),/synthetic partial batch/);
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
 const restarted=createWorkflow(f.base,{activityLifecycleStore:f.activityLifecycleStore,approvalRouting:createWorkspaceApprovalRouting({getRoster:async()=>f.roster})});
 const bridge=createWorkspaceWorkflowBridge({workflow:restarted,getRoster:async()=>f.roster});
 await withRequestBudget(()=>bridge.save(event._id,body,'sz-chair'),{timeoutMs:1500});
 assert.deepEqual(f.tables[WF.registrations].map(row=>[row._id,row['报名ID'],row['活动ID'],row['账号ID']]),identities);
 assert.ok(f.tables[WF.registrations].every(row=>row['活动名称']===body.content.name));
 assert.deepEqual(batches.filter(batch=>batch.table===WF.registrations).map(batch=>batch.count),[100,20]);
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'开放');assert.ok(f.tables[WF.events].every(workflowEventApproved));
 assert.deepEqual(reads,[WF.events]);
 queries.length=0;reads.length=0;const count=batches.length;
 await bridge.save(event._id,body,'sz-chair');
 assert.equal(batches.length,count);assert.equal(reads.length,0);assert.equal(queries.length,1);assert.ok(queries[0].includes(WF.events));
 const current=await bridge.content(event._id,'sz-chair',structuredClone(f.tables[WF.events]));
 const countBefore=batches.length;
 await bridge.save(event._id,{expectedVersion:current.version,token:current.token,content:{...current.content,description:'只修改说明'}},'sz-chair');
 assert.equal(batches.slice(countBefore).filter(batch=>batch.table===WF.registrations).length,0);
});

test('a silently incomplete batch keeps registration closed until verified replay succeeds',async t=>{
 const f=await fixture(t),event=await publishFixture(f),before=await f.bridge.content(event._id);
 const update=f.base.updateRow;let silent=true;
 f.base.batchUpdateRows=async(table,items)=>{for(const item of silent?items.slice(0,1):items)await update(table,item.row_id,item.row);return {};};
 const body={expectedVersion:before.version,token:before.token,content:{...before.content,name:'合成新名称'}};
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),/岗位保存结果待核对/);
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
 silent=false;await f.bridge.save(event._id,body,'sz-chair');
 assert.ok(f.tables[WF.events].every(row=>row['活动名称']==='合成新名称'&&workflowEventApproved(row)));
});

async function publishFixture(f){
 await f.submissions.submit(f.row.id,f.body,'creator');
 const event=f.tables[WF.events][0];
 await f.workflow.approve(event._id,'sz-chair','platform_admin',workflowApprovalHash(event));
 await f.workflow.publish(event._id,{actor:'sz-chair'});
 return event;
}

test('failure before the first remote write reuses private evidence and refuses a changed registration set',async t=>{
 const f=await fixture(t),event=await publishFixture(f),before=await f.bridge.content(event._id);
 const body={expectedVersion:before.version,token:before.token,content:{...before.content,deadline:'2029-12-31T23:59'}};
 const update=f.base.updateRow;let failed=false;
 f.base.updateRow=async(table,id,patch)=>{if(!failed&&table===WF.events&&id===event._id){failed=true;throw Error('synthetic before write');}return update(table,id,patch);};
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),/synthetic before write/);
 const stored=f.activityLifecycleStore.workspaceEdit(event._id,body.token);assert.ok(stored);
 const restarted=createWorkflow(f.base,{activityLifecycleStore:f.activityLifecycleStore,approvalRouting:createWorkspaceApprovalRouting({getRoster:async()=>f.roster})});
 const bridge=createWorkspaceWorkflowBridge({workflow:restarted,getRoster:async()=>f.roster});
 await bridge.save(event._id,body,'sz-chair');
 assert.deepEqual(f.activityLifecycleStore.workspaceEdit(event._id,body.token),stored);
 const next=await bridge.content(event._id),again={expectedVersion:next.version,token:next.token,content:{...next.content,description:'第二次合成修改'}};
 failed=false;
 await assert.rejects(bridge.save(event._id,again,'sz-chair'),/synthetic before write/);
 const child=f.tables[WF.events].find(row=>JSON.parse(row['报名页配置']).parentActivityId===event['活动ID']);
 await restarted.register(child._id,{accountId:'student',studentId:'999990099',realName:'合成报名人',email:'999990099@smail.nju.edu.cn',emailVerified:true,campus:'苏州'});
 const snapshot=structuredClone(f.tables);
 await assert.rejects(bridge.save(event._id,again,'sz-chair'),/参与记录不一致/);
 assert.deepEqual(f.tables,snapshot);
});

test('16-position edit keeps every text cell bounded and resumes the same receipt across workflow restart',async t=>{
 const input={...content,positions:Array.from({length:16},(_,i)=>({...content.positions[i%2],id:'job-'+i,name:'岗位'+i,location:'合成地点'+i}))};
 const f=await fixture(t,{input}),event=await publishFixture(f),before=await f.bridge.content(event._id);
 const child=f.tables[WF.events].find(row=>JSON.parse(row['报名页配置']).parentActivityId===event['活动ID']);
 const booking=await f.workflow.register(child._id,{accountId:'student',studentId:'999990099',realName:'合成报名人',email:'999990099@smail.nju.edu.cn',emailVerified:true,campus:'苏州'});
 const original=structuredClone(f.tables[WF.registrations]),body={expectedVersion:before.version,token:before.token,content:{...before.content,deadline:'2029-12-31T23:59'}};
 const update=f.base.updateRow,configSizes=[];let lost=false;
 f.base.updateRow=async(table,id,patch)=>{
  if(table===WF.events&&patch['报名页配置']){configSizes.push(patch['报名页配置'].length);patch={...patch,报名页配置:patch['报名页配置'].slice(0,10_000)};}
  await update(table,id,patch);
  if(!lost&&table===ORDINARY_GROUP_TABLE&&patch['报名开关']==='开放'){lost=true;throw Error('synthetic lost response');}
 };
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),/synthetic lost response/);
 const reference=JSON.parse(event['报名页配置']).workspaceEdit,stored=f.activityLifecycleStore.workspaceEdit(event._id,reference.token);
 assert.equal(reference.storage,'activity-lifecycle-v1');assert.equal(reference.plan,undefined);
 assert.ok(JSON.stringify(stored).length>10_000);assert.ok(configSizes.every(size=>size<=10_000));
 const restarted=createWorkflow(f.base,{activityLifecycleStore:f.activityLifecycleStore,approvalRouting:createWorkspaceApprovalRouting({getRoster:async()=>f.roster})});
 const bridge=createWorkspaceWorkflowBridge({workflow:restarted,getRoster:async()=>f.roster});
 const pending=await bridge.content(event._id,'sz-chair');assert.deepEqual(pending.pendingEdit,body);
 await bridge.save(event._id,body,'sz-chair');
 assert.equal((await bridge.content(event._id,'sz-chair')).lastEdit.status,'complete');
 assert.equal(f.tables[WF.events].length,17);assert.equal(activityProjects((await restarted.catalog()).events).length,1);
 assert.equal(workflowEventApproved(event),true);assert.deepEqual(f.tables[WF.registrations],original);assert.equal(f.tables[WF.registrations][0]._id,booking._id);
 assert.ok(f.tables[WF.events].every(row=>row['报名页配置'].length<=10_000&&workflowEventApproved(row)));
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名截止'],'2029-12-31T23:59:00+08:00');
});

test('oversized final config is rejected before business writes and a readback mismatch stops the edit',async t=>{
 const input={...content,positions:Array.from({length:16},(_,i)=>({...content.positions[i%2],id:'job-'+i,name:'岗位'+i,location:'合成地点'+i}))};
 const f=await fixture(t,{input}),event=await publishFixture(f),before=await f.bridge.content(event._id),snapshot=structuredClone(f.tables);
 const body={expectedVersion:before.version,token:before.token,content:{...before.content,positions:before.content.positions.map(p=>({...p,work:'合成'.repeat(250)}))}};
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),{code:'workflow_configuration_too_large'});
 assert.deepEqual(f.tables,snapshot);
 // The database accepted the write but a different value was returned. Do not
 // proceed to closing the project or modifying its jobs based on an ACK alone.
 f.base.getRow=async(table,id)=>({...f.tables[table].find(row=>row._id===id),报名页配置:'{}'});
 const normal={...body,content:{...before.content,deadline:'2029-12-31T23:59'}};
 await assert.rejects(f.bridge.save(event._id,normal,'sz-chair'),{code:'workflow_configuration_write_unconfirmed'});
 assert.deepEqual(f.tables[ORDINARY_GROUP_TABLE],snapshot[ORDINARY_GROUP_TABLE]);
 assert.deepEqual(f.tables[WF.events].slice(1),snapshot[WF.events].slice(1));
 delete f.base.getRow;
 await f.bridge.save(event._id,normal,'sz-chair');assert.equal(workflowEventApproved(event),true);
});

test('missing private edit evidence and malformed source configuration never become an empty editable activity',async t=>{
 const f=await fixture(t),event=await publishFixture(f),before=await f.bridge.content(event._id);
 const body={expectedVersion:before.version,token:before.token,content:{...before.content,deadline:'2029-12-31T23:59'}};
 const update=f.base.updateRow;let lost=false;
 f.base.updateRow=async(table,id,patch)=>{await update(table,id,patch);if(!lost&&table===ORDINARY_GROUP_TABLE&&patch['报名开关']==='开放'){lost=true;throw Error('synthetic lost response');}};
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),/synthetic lost response/);
 const isolated=createActivityLifecycleStore();t.after(()=>isolated.close());
 const restarted=createWorkflow(f.base,{activityLifecycleStore:isolated,approvalRouting:createWorkspaceApprovalRouting({getRoster:async()=>f.roster})});
 const bridge=createWorkspaceWorkflowBridge({workflow:restarted,getRoster:async()=>f.roster}),snapshot=structuredClone(f.tables);
 await assert.rejects(bridge.content(event._id,'sz-chair'),{code:'workspace_edit_receipt_unavailable'});
 await assert.rejects(bridge.save(event._id,body,'sz-chair'),{code:'workspace_edit_receipt_unavailable'});
 assert.deepEqual(f.tables,snapshot);
 event['报名页配置']='{"bookingMode":"grouped"';
 const damaged=structuredClone(f.tables);
 const catalog=await f.workflow.catalog();assert.equal(catalog.events.find(row=>row._id===event._id).configurationError,true);
 await assert.rejects(f.bridge.content(event._id,'sz-chair'),{code:'workflow_configuration_invalid'});
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),{code:'workflow_configuration_invalid'});
 await assert.rejects(f.workflow.register(event._id,{}),{code:'workflow_configuration_invalid'});
 assert.deepEqual(f.tables,damaged);
});

test('per-position flexibility survives approval publication copy and concurrent booking limits',async t=>{
 const f=await fixture(t),next={...f.row.content,positions:f.row.content.positions.map((p,i)=>({...p,flexibleCapacity:i?'10':'5'}))};
 const saved=await f.drafts.save(f.row.id,{expectedVersion:1,content:next},'creator'),proof=await f.drafts.preview(saved.id,{expectedVersion:saved.version},'creator'),body={expectedVersion:saved.version,digest:proof.digest};
 await f.drafts.confirmPreview(saved.id,body,'creator');await f.submissions.submit(saved.id,body,'creator');
 const parent=f.tables[WF.events][0];assert.equal(Number(parent['容量']),7);
 await f.workflow.approve(parent._id,'sz-chair','platform_admin',workflowApprovalHash(parent));await f.workflow.publish(parent._id,{actor:'sz-chair'});
 const children=f.tables[WF.events].filter(row=>JSON.parse(row['报名页配置']).parentActivityId===parent['活动ID']);
 assert.deepEqual(children.map(row=>[Number(row['容量']),JSON.parse(row['报名页配置']).flexibleCapacity,JSON.parse(row['报名页配置']).registrationLimit]),[[3,5,8],[4,10,14]]);
 const restored=await f.bridge.content(parent._id,'sz-chair');assert.deepEqual(restored.content.positions.map(p=>p.flexibleCapacity),['5','10']);
 const attempts=await Promise.allSettled(Array.from({length:9},(_,i)=>{const sid=String(999980000+i);return f.workflow.register(children[0]._id,{accountId:'synthetic-flex-'+i,studentId:sid,realName:'合成报名人'+i,email:sid+'@smail.nju.edu.cn',emailVerified:true,campus:'苏州'});}));
 assert.equal(attempts.filter(result=>result.status==='fulfilled').length,8);assert.equal(attempts.filter(result=>result.status==='rejected'&&result.reason.statusCode===409).length,1);
 assert.equal(f.tables[WF.registrations].length,8);assert.equal(Number(children[0]['容量']),3);assert.equal(placePlan([children[0]],f.tables[WF.registrations]).length,8);
 const detail=await f.workflow.detail(children[0]._id),token=detail.events.find(row=>row._id===children[0]._id).rosterToken;
 await f.workflow.stageRoster(children[0]._id,f.tables[WF.registrations].map(row=>row._id),'confirm','',token,{immediate:true,actor:'director'});
 assert.equal(f.tables[WF.registrations].filter(row=>row['报名状态']==='已确认').length,8);
 const information=await f.bridge.content(parent._id,'sz-chair');
 await f.bridge.save(parent._id,{token:information.token,expectedVersion:information.version,content:{...information.content,description:'只修改说明'}},'sz-chair');
 const current=await f.bridge.content(parent._id,'sz-chair');assert.deepEqual(current.content.positions.map(p=>p.flexibleCapacity),['5','10']);
 await assert.rejects(f.bridge.save(parent._id,{token:current.token,expectedVersion:current.version,content:{...current.content,positions:current.content.positions.map((p,i)=>i?p:{...p,flexibleCapacity:'0'})}},'sz-chair'),/已占用/);
});

test('grouped early end archives every job projection while retaining source records and blocking old mutations',async t=>{
 const f=await fixture(t);await f.submissions.submit(f.row.id,f.body,'creator');const parent=f.tables[WF.events][0];await f.workflow.approve(parent._id,'sz-chair','platform_admin',workflowApprovalHash(parent));await f.workflow.publish(parent._id,{actor:'sz-chair'});
 const child=f.tables[WF.events].find(row=>JSON.parse(row['报名页配置']).parentActivityId===parent['活动ID']);assert.ok(child);
 const person={accountId:'student',studentId:'999990099',realName:'合成报名人',email:'999990099@smail.nju.edu.cn',emailVerified:true,campus:'苏州'},registration=await f.workflow.register(child._id,person),detail=await f.workflow.detail(child._id);
 await f.workflow.stageRoster(child._id,[registration._id],'confirm','',detail.events.find(row=>row._id===child._id).rosterToken,{actor:'director'});
 const saved=structuredClone(f.tables[WF.registrations]);await assert.rejects(f.workflow.archive(parent._id),/新版活动/);
 const state=await f.workflow.workspaceRemoval(parent._id,'director');await f.workflow.removeWorkspace(parent._id,{token:state.token,requestId:'synthetic-group-removal',reason:'合成项目取消'},'director');
 const all=await f.workflow.read();assert.ok(all.events.every(row=>row['状态']==='已归档'));assert.deepEqual(f.tables[WF.registrations],saved);assert.equal(child['状态'],'报名中');
 await assert.rejects(f.workflow.restore(parent._id),/新版活动/);await assert.rejects(f.workflow.restore(child._id),/新版活动/);
 await assert.rejects(f.workflow.register(child._id,{...person,accountId:'second',studentId:'999990098',email:'999990098@smail.nju.edu.cn'}),{statusCode:409});
 let sent=0;await assert.rejects(f.workflow.deliverRoster(child._id,{send:async()=>{sent++;return {ok:true};}}),/活动已移除/);assert.equal(sent,0);
});

test('native grouped running review persists independently and moves the one project card only after preview',async t=>{
 const f=await fixture(t);await f.submissions.submit(f.row.id,f.body,'creator');const event=f.tables[WF.events][0];
 await f.workflow.approve(event._id,'sz-chair','platform_admin',workflowApprovalHash(event));await f.workflow.publish(event._id,{actor:'sz-chair'});
 const child=f.tables[WF.events].find(row=>JSON.parse(row['报名页配置']).parentActivityId===event['活动ID']);assert.ok(child);
 f.tables[WF.registrations].push({_id:'synthetic-attendee',报名ID:'synthetic-code',活动ID:child['活动ID'],账号ID:'synthetic-attendee',学号:'20300001',姓名:'合成同学',报名状态:'已确认'});
 await f.workflow.close(event._id,{scope:'project',actor:'director'});
 const window=JSON.parse(child['报名页配置']).ordinary;let clock=Date.parse(window.start)-1;
 const attendance=createWorkflow(f.base,{now:()=>clock,approvalRouting:createWorkspaceApprovalRouting({getRoster:async()=>f.roster})});
 await assert.rejects(attendance.submitAttendance('synthetic-code',{accountId:'synthetic-attendee'},'11111111-1111-4111-8111-111111111111'),{statusCode:409});clock+=60_000;
 await attendance.submitAttendance('synthetic-code',{accountId:'synthetic-attendee'},'11111111-1111-4111-8111-111111111111');
 await assert.rejects(attendance.checkinAndReview('synthetic-attendee','director'),/新版进行中/);
 const legacy=await attendance.attendanceBatch(event._id,[{id:'synthetic-attendee',hours:{serviceHours:2,trainingHours:0,travelHours:0}}],'director');assert.equal(legacy.failed,1);assert.equal(f.tables[WF.checkins].length,0);assert.equal(f.tables[WF.ledger].length,0);
 const state=await f.workflow.runningReview(event._id,'director'),item={id:'synthetic-attendee',serviceHours:2,trainingHours:0,travelHours:0,decision:'pass',reason:'',evidenceChecked:true};
 await f.workflow.saveRunningReview(event._id,{token:state.token,items:[item]},'director');
 assert.equal(workflowEventApproved(event),true);assert.equal(f.tables[WF.checkins].length,0);assert.equal(f.tables[WF.ledger].length,0);
 await assert.rejects(f.workflow.reopenRegistration(event._id,{actor:'director',reason:'不应回退'}),/已有时长初审/);
 const fresh=await f.workflow.runningReview(event._id,'director'),proof=await f.workflow.previewRunningReview(event._id,{token:fresh.token,items:[item]},'director');
 await f.workflow.submitRunningReview(event._id,proof,'director');
 const catalog=await f.workflow.catalog(),project=catalog.events.find(row=>row._id===event._id);assert.equal(JSON.parse(project['报名页配置']).runningReview.status,'submitted');
 assert.equal(JSON.parse(project['报名页配置']).runningReview.entries,undefined);
 await assert.rejects(f.workflow.checkin('synthetic-attendee','director','不应改动'),/时长已提交/);
 await assert.rejects(attendance.submitAttendance('synthetic-code',{accountId:'synthetic-attendee'},'22222222-2222-4222-8222-222222222222'),{statusCode:409});
 f.roster.rows.find(row=>row.accountId==='director').email='director@example.test';f.roster.rows.find(row=>row.accountId==='director').emailVerified=true;
 const final=await f.workflow.finalHours(event._id,'sz-chair');await f.workflow.saveFinalHours(event._id,{token:final.token,items:[{id:'synthetic-attendee',serviceHours:3}]},'sz-chair');
 assert.equal((await f.workflow.runningReview(event._id,'director')).entries[0].serviceHours,3);
 const ready=await f.workflow.finalHours(event._id,'sz-chair');await f.workflow.exportFinalHours(event._id,{token:ready.token},'sz-chair');
 assert.ok((await f.workflow.detail(event._id)).events.every(row=>row['状态']==='已结束'));assert.ok((await f.workflow.downloadFinalHours(event._id,'director')).buffer.length);assert.equal(workflowEventApproved(event),true);
 await assert.rejects(f.workflow.finish(event._id),/新版活动/);
});

const content={qqGroup:'123456789',name:'合成草稿提交',region:'suzhou',category:'生命中心',responsibleId:'director',bookingMode:'grouped',date:'2030-01-01',endDate:'2030-01-03',deadline:'2029-12-31T18:00',description:'完整活动说明',notice:'合成岗位通知',positions:[{id:'job-one',name:'宣传岗',date:'2030-01-01',start:'09:15',end:'11:45',campus:'苏州',location:'合成甲地',capacity:'3',serviceHours:'2.5',trainingHours:'0.5',travelHours:'1',work:'宣传服务'},{id:'job-two',name:'签到岗',date:'2030-01-03',start:'14:10',end:'16:40',campus:'苏州',location:'合成乙地',capacity:'4',serviceHours:'2',trainingHours:'1',travelHours:'0',work:'签到服务'}]};

test('project owner collaborators and selected reviewers survive submission and one approval',async t=>{
 const f=await fixture(t);
 const names={creator:'合成立项人',director:'合成协作人','sz-chair':'合成中心主席'};
 for(const row of f.roster.rows)row.name=names[row.accountId]||row.accountId;
 f.roster.rows.push({accountId:'unselected-global',region:'suzhou',role:'global',active:true,categories:[],name:'合成其他总权限'});
 const saved=await f.drafts.save(f.row.id,{expectedVersion:1,content:{...f.row.content,projectOwnerId:'creator',responsibleId:'creator',responsibleIds:['creator','director'],reviewerIds:['sz-chair']}},'creator');
 const preview=await f.drafts.preview(saved.id,{expectedVersion:saved.version},'creator'),body={expectedVersion:saved.version,digest:preview.digest};
 await f.drafts.confirmPreview(saved.id,body,'creator');await f.submissions.submit(saved.id,body,'creator');
 const parent=f.tables[WF.events][0],config=JSON.parse(parent['报名页配置']);
 assert.equal(parent['负责人账号ID'],'creator');assert.deepEqual(config.coOwners,['director']);assert.equal(config.workspaceProjectOwnerId,'creator');
 assert.deepEqual(config.approval.reviewerIds,['sz-chair']);assert.equal(config.approval.policy,'any');
 const catalog=await f.workflow.catalog(),routing=createWorkspaceApprovalRouting({getRoster:async()=>f.roster});
 assert.equal((await routing.describe(catalog.events,'unselected-global'))[0].approvalAccess.canReview,false);
 assert.equal((await routing.describe(catalog.events,'director'))[0].approvalAccess.canManageRegistration,true);
 const information=await f.bridge.content(parent._id,'creator');
 assert.equal(information.ownerId,'creator');assert.equal(information.projectOwnerName,'合成立项人');assert.deepEqual(information.collaboratorNames,['合成协作人']);assert.deepEqual(information.reviewerNames,['合成中心主席']);
 assert.deepEqual(information.content.reviewerIds,['sz-chair']);
 await assert.rejects(f.bridge.save(parent._id,{expectedVersion:information.version,token:information.token,content:{...information.content,projectOwnerId:undefined}},'creator'),{statusCode:403});
 await f.workflow.approve(parent._id,'sz-chair','platform_admin',workflowApprovalHash(parent));assert.equal(parent['状态'],'可发布');
 await f.workflow.publish(parent._id,{actor:'sz-chair'});
 const restored=await f.bridge.content(parent._id,'creator');assert.equal(restored.content.projectOwnerId,'creator');assert.deepEqual(restored.content.responsibleIds,['creator','director']);
});

test('multiple responsible directors survive submit, publication and copy, with equal fresh access',async t=>{
 const f=await fixture(t),saved=await f.drafts.save(f.row.id,{expectedVersion:1,content:{...f.row.content,responsibleIds:['director','creator']}},'creator');
 const preview=await f.drafts.preview(saved.id,{expectedVersion:saved.version},'creator');await f.drafts.confirmPreview(saved.id,{expectedVersion:saved.version,digest:preview.digest},'creator');
 await f.submissions.submit(saved.id,{expectedVersion:saved.version,digest:preview.digest},'creator');const parent=f.tables[WF.events][0];
 assert.deepEqual(JSON.parse(parent['报名页配置']).coOwners,['creator']);
 await f.workflow.approve(parent._id,'sz-chair','platform_admin',workflowApprovalHash(parent));await f.workflow.publish(parent._id,{actor:'sz-chair'});
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>f.roster});
 for(const event of f.tables[WF.events])for(const actor of ['creator','director']){await routing.assertRegistrar(event,actor);await routing.assertHoursRecorder(event,actor);}
 const copied=await f.bridge.content(parent._id,'sz-chair');assert.deepEqual(copied.content.responsibleIds,['director','creator']);
 f.roster.rows.find(row=>row.accountId==='creator').active=false;
 await assert.rejects(routing.assertRegistrar(parent,'creator'),{statusCode:403});await routing.assertRegistrar(parent,'director');
});
async function fixture(t,{input=content}={}){
 const store=openWorkspaceDraftStore(':memory:');t.after(()=>store.close());const queue=createMutationQueue();let seq=0;
 const tables=Object.fromEntries([...Object.values(WF),ORDINARY_GROUP_TABLE].map(name=>[name,[]]));
 const base={getMetadata:async()=>({tables:Object.keys(tables).map(name=>({name}))}),listRows:async(name,_v,_o,_c,start=0,count=500)=>structuredClone(tables[name].slice(start,start+count)),appendRow:async(name,row)=>{const saved={...row,_id:`synthetic-${++seq}`};tables[name].push(saved);return {_id:saved._id};},updateRow:async(name,id,patch)=>Object.assign(tables[name].find(row=>row._id===id),patch)};
 const roster={complete:true,rows:[{accountId:'creator',region:'suzhou',role:'director',active:true,categories:['生命中心']},{accountId:'director',region:'suzhou',role:'director',active:true,categories:['生命中心']},{accountId:'sz-chair',region:'suzhou',role:'presidium',active:true,categories:[]},{accountId:'nj-chair',region:'nanjing',role:'presidium',active:true,categories:[]}]};
 const authorize=async(row,actor)=>{if(row.ownerId!==actor)throw Object.assign(new Error('denied'),{statusCode:403});};
 const keyedStore={...store,read:()=>{throw Error('point operations must not scan draft storage');}};
 const drafts=createWorkspaceDrafts({...keyedStore,queue,authorize,validateResponsible:(c,a,o)=>assertWorkspaceResponsible(c,a,roster,o)});
 const activityLifecycleStore=createActivityLifecycleStore();t.after(()=>activityLifecycleStore.close());
 const workflow=createWorkflow(base,{activityLifecycleStore,approvalRouting:createWorkspaceApprovalRouting({getRoster:async()=>roster})}),bridge=createWorkspaceWorkflowBridge({workflow,getRoster:async()=>structuredClone(roster)});
 const submissions=createWorkspaceSubmissions({...keyedStore,queue,drafts,authorize,...bridge});
 const row=await drafts.create({requestId:'synthetic-full-handoff',content:input},'creator');
 const preview=await drafts.preview(row.id,{expectedVersion:1},'creator');await drafts.confirmPreview(row.id,{expectedVersion:1,digest:preview.digest},'creator');
 return {store,activityLifecycleStore,drafts,submissions,bridge,workflow,base,tables,roster,row,body:{expectedVersion:1,digest:preview.digest}};
}

test('real handoff preserves every job and minute, selected director and Suzhou-only approval',async t=>{
 const f=await fixture(t),result=await f.submissions.submit(f.row.id,f.body,'creator');
 assert.equal(result.stage,'待审批');assert.equal(f.tables[WF.events].length,1);
 const event=f.tables[WF.events][0],c=JSON.parse(event['报名页配置']);
 assert.equal(event['负责人账号ID'],'director');assert.equal(event['通知草稿'],content.notice);assert.equal(event['状态'],'待审核');assert.equal(Number(event['容量']),7);
 assert.deepEqual(c.approval.reviewerIds,['sz-chair']);assert.equal(c.workspaceDescription,content.description);
 assert.equal(c.positionDraft.positions.length,2);assert.equal(c.positionDraft.positions[0].start,'2030-01-01T09:15:00+08:00');assert.equal(c.positionDraft.positions[1].end,'2030-01-03T16:40:00+08:00');assert.equal(c.positionDraft.positions[0].serviceHours,2.5);assert.equal(c.positionDraft.positions[1].trainingHours,1);
 assert.deepEqual(await f.submissions.submit(f.row.id,f.body,'creator'),result);assert.equal(f.tables[WF.events].length,1);
 await assert.rejects(createWorkflow(f.base).approve(event._id,'nj-chair','super_admin'),{statusCode:503});assert.equal(event['状态'],'待审核');
 await assert.rejects(f.drafts.save(f.row.id,{expectedVersion:3,content},'creator'),{statusCode:409});
});

test('revoked responsible or missing regional chairs fail before claiming or writing',async t=>{
 const f=await fixture(t);f.roster.rows.find(row=>row.accountId==='director').active=false;
 await assert.rejects(f.submissions.submit(f.row.id,f.body,'creator'),{statusCode:403});assert.equal(f.store.read()[0].submission,undefined);assert.equal(f.tables[WF.events].length,0);
 f.roster.rows.find(row=>row.accountId==='director').active=true;f.roster.rows=f.roster.rows.filter(row=>row.accountId!=='sz-chair');
 await assert.rejects(f.submissions.submit(f.row.id,f.body,'creator'),{statusCode:409});assert.equal(f.store.read()[0].submission,undefined);
});

test('lost business response reconciles the persisted native event without another append',async t=>{
 const f=await fixture(t),original=f.base.appendRow;let writes=0;
 f.base.appendRow=async(...args)=>{writes++;await original(...args);throw Error('synthetic response lost');};
 await assert.rejects(f.submissions.submit(f.row.id,f.body,'creator'),{code:'workspace_submission_uncertain'});
 const saved=await f.drafts.get(f.row.id,'creator');assert.equal(saved.submissionStatus,'pending');assert.deepEqual(saved.submissionRequest,f.body);
 const result=await f.submissions.submit(f.row.id,saved.submissionRequest,'creator');assert.equal(result.stage,'待审批');assert.equal(writes,1);assert.equal(f.tables[WF.events].length,1);
});


test('single-position submission retains multi-day window and enforces the saved registration deadline',async t=>{
 const f=await fixture(t),single={...content,bookingMode:'unified',positions:[],start:'09:15',end:'11:45',location:'合成单岗位场地',capacity:'5',serviceHours:'3',trainingHours:'0.5',travelHours:'1',work:'合成单岗位工作'};
 await f.drafts.save(f.row.id,{expectedVersion:1,content:single},'creator');const preview=await f.drafts.preview(f.row.id,{expectedVersion:2},'creator');await f.drafts.confirmPreview(f.row.id,{expectedVersion:2,digest:preview.digest},'creator');
 await f.submissions.submit(f.row.id,{expectedVersion:2,digest:preview.digest},'creator');
 const event=f.tables[WF.events][0],c=JSON.parse(event['报名页配置']);assert.equal(c.window.start,'2030-01-01T09:15:00+08:00');assert.equal(c.window.end,'2030-01-03T11:45:00+08:00');assert.equal(Number(event['服务时长']),3);assert.equal(c.registrationDeadline,'2029-12-31T18:00:00+08:00');
 const published={...event,状态:'报名中'};assert.equal(registrationOpen(published,Date.parse('2029-12-31T17:59:59+08:00')),true);assert.equal(registrationOpen(published,Date.parse('2029-12-31T18:00:00+08:00')),false);
});


test('pending approval permits only the regional chair to save and rejects stale approvals',async t=>{
 const f=await fixture(t);await f.submissions.submit(f.row.id,f.body,'creator');const event=f.tables[WF.events][0],before=await f.bridge.content(event._id),changed={...before.content,name:'主席团修改后的活动',notice:'主席团保存通知'};
 for(const actor of ['director','creator','nj-chair'])await assert.rejects(f.bridge.save(event._id,{expectedVersion:before.version,token:before.token,content:changed},actor),{statusCode:403});
 await f.bridge.save(event._id,{expectedVersion:before.version,token:before.token,content:changed},'sz-chair');assert.equal(event['状态'],'待审核');assert.equal(event['活动名称'],changed.name);assert.equal(event['通知草稿'],changed.notice);assert.equal(JSON.parse(event['报名页配置']).approval.version,'2');
 await assert.rejects(f.workflow.approve(event._id,'sz-chair','platform_admin',before.token),{statusCode:409});
 await f.workflow.approve(event._id,'sz-chair','platform_admin',workflowApprovalHash(event));assert.equal(event['状态'],'可发布');
 await assert.rejects(f.workflow.publish(event._id,{actor:'director'}),{statusCode:403});
 const approved=await f.bridge.content(event._id);await f.bridge.save(event._id,{expectedVersion:approved.version,token:approved.token,content:{...approved.content,name:'发布前再次修改'}},'sz-chair');assert.equal(event['状态'],'待审核');await assert.rejects(f.workflow.publish(event._id,{actor:'sz-chair'}),{statusCode:409});await f.workflow.approve(event._id,'sz-chair','platform_admin',workflowApprovalHash(event));
 await f.workflow.publish(event._id,{actor:'sz-chair'});assert.equal(event['状态'],'报名中');
});

test('returned event retains identity and requires the responsible director to save and preview before resubmission',async t=>{
 const f=await fixture(t);await f.submissions.submit(f.row.id,f.body,'creator');const event=f.tables[WF.events][0],id=event['活动ID'];
 await f.workflow.returnApproval(event._id,'sz-chair','platform_admin','补全岗位说明',workflowApprovalHash(event));assert.equal(event['状态'],'草稿');
 await assert.rejects(f.workflow.submit(event._id),{statusCode:409});
 const original=await f.bridge.content(event._id);
 await assert.rejects(f.bridge.save(event._id,{expectedVersion:original.version,token:original.token,content:original.content},'creator'),{statusCode:403});
 await f.bridge.save(event._id,{expectedVersion:original.version,token:original.token,content:{...original.content,description:'已补全说明'}},'director');
 const saved=await f.bridge.content(event._id);await assert.rejects(f.workflow.resubmitWorkspace(event._id,{token:saved.token},'director'),/预览/);
 await f.workflow.confirmWorkspacePreview(event._id,{token:saved.token},'director');assert.equal(workflowApprovalHash(event),saved.token);
 await f.workflow.resubmitWorkspace(event._id,{token:saved.token},'director');assert.equal(event['状态'],'待审核');assert.equal(event['活动ID'],id);assert.equal(f.tables[WF.events].length,1);assert.equal(JSON.parse(event['报名页配置']).approval.region,'suzhou');
});


test('registration-stage information edit is chair-only and preserves bookings, positions and mail receipts',async t=>{
 const f=await fixture(t);await f.submissions.submit(f.row.id,f.body,'creator');const event=f.tables[WF.events][0];await f.workflow.approve(event._id,'sz-chair','platform_admin',workflowApprovalHash(event));await f.workflow.publish(event._id,{actor:'sz-chair'});
 const child=f.tables[WF.events].find(row=>JSON.parse(row['报名页配置']).parentActivityId===event['活动ID']);
 const person={accountId:'student',studentId:'999990099',realName:'合成报名人',email:'999990099@smail.nju.edu.cn',emailVerified:true,campus:'苏州'};
 const registration=await f.workflow.register(child._id,person),detail=await f.workflow.detail(child._id);
 await f.workflow.stageRoster(child._id,[registration._id],'confirm','',detail.events.find(e=>e._id===child._id).rosterToken,{actor:'director'});
 const messages=[];await f.workflow.deliverRoster(child._id,{send:async message=>{messages.push(message);return {ok:true,transport:'smtp'};}});
 const storedRegistration=structuredClone(f.tables[WF.registrations]),storedChild=structuredClone(child),positions=JSON.parse(event['报名页配置']).positionPlan;
 const before=await f.bridge.content(event._id),body={expectedVersion:before.version,token:before.token,content:{...before.content,description:'主席团更新说明',notice:'主席团更新通知'}};
 for(const actor of ['director','creator','nj-chair'])await assert.rejects(f.bridge.save(event._id,body,actor),{statusCode:403});

 await f.bridge.save(event._id,body,'sz-chair');assert.equal(event['状态'],'报名中');assert.equal(event['通知草稿'],'主席团更新通知');assert.equal(workflowEventApproved(event),true);assert.deepEqual(JSON.parse(event['报名页配置']).positionPlan.eventIds,positions.eventIds);assert.equal(child._id,storedChild._id);assert.equal(child['活动ID'],storedChild['活动ID']);assert.deepEqual(f.tables[WF.registrations],storedRegistration);
 await f.workflow.deliverRoster(child._id,{send:async message=>{messages.push(message);return {ok:true,transport:'smtp'};}});assert.equal(messages.length,1);
 const next=await f.bridge.content(event._id);f.tables[WF.ledger].push({_id:'synthetic-hours',活动ID:child['活动ID']});await assert.rejects(f.bridge.save(event._id,{expectedVersion:next.version,token:next.token,content:{...next.content,description:'不应生效'}},'sz-chair'),/签到、提交审核或最终时长/);
});


test('published generated notice follows information changes and editor deadline remains a local minute value',async t=>{
 const f=await fixture(t),generated={...content,notice:workspaceNotice(content)};await f.drafts.save(f.row.id,{expectedVersion:1,content:generated},'creator');const preview=await f.drafts.preview(f.row.id,{expectedVersion:2},'creator');await f.drafts.confirmPreview(f.row.id,{expectedVersion:2,digest:preview.digest},'creator');await f.submissions.submit(f.row.id,{expectedVersion:2,digest:preview.digest},'creator');
 const event=f.tables[WF.events][0];await f.workflow.approve(event._id,'sz-chair','platform_admin',workflowApprovalHash(event));await f.workflow.publish(event._id,{actor:'sz-chair'});
 const before=await f.bridge.content(event._id);assert.equal(before.content.deadline,'2029-12-31T18:00');assert.equal(before.content.notice,workspaceNotice(before.content));
 await f.bridge.save(event._id,{expectedVersion:before.version,token:before.token,content:{...before.content,description:'最新活动说明'}},'sz-chair');assert.match(event['通知草稿'],/最新活动说明/);assert.equal(event['状态'],'报名中');assert.equal(workflowEventApproved(event),true);
});


test('pre-start full edits retain booked identities, reject capacity loss and reconcile a lost group response',async t=>{
 const f=await fixture(t);await f.submissions.submit(f.row.id,f.body,'creator');const event=f.tables[WF.events][0];await f.workflow.approve(event._id,'sz-chair','platform_admin',workflowApprovalHash(event));await f.workflow.publish(event._id,{actor:'sz-chair'});
 const child=f.tables[WF.events].find(e=>JSON.parse(e['报名页配置']).parentActivityId===event['活动ID']);
 const booking=await f.workflow.register(child._id,{accountId:'student',studentId:'999990099',realName:'合成报名人',email:'999990099@smail.nju.edu.cn',emailVerified:true,campus:'苏州'});
 const before=await f.bridge.content(event._id),positions=before.content.positions.map((p,i)=>({...p,name:i?p.name:'修改后的宣传岗',location:'修改地点',capacity:i?p.capacity:'1'}));
 const body={expectedVersion:before.version,token:before.token,content:{...before.content,name:'修改活动名称',positions}};
 await assert.rejects(f.bridge.save(event._id,{...body,content:{...body.content,positions:positions.slice(1)}},'sz-chair'),/已有报名的岗位不能移除/);
 const update=f.base.updateRow;let lost=false;
 f.base.updateRow=async(name,id,patch)=>{await update(name,id,patch);if(!lost&&name===ORDINARY_GROUP_TABLE&&patch['报名开关']==='开放'){lost=true;throw Error('synthetic lost response');}};
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),/synthetic lost response/);
 const pending=await f.bridge.content(event._id,'sz-chair');assert.equal(pending.lastEdit.status,'finishing');assert.equal(pending.pendingEdit.token,body.token);
 await assert.rejects(f.bridge.save(event._id,{expectedVersion:pending.version,token:pending.token,content:body.content},'sz-chair'),/上次信息修改尚未完成/);
 await f.bridge.save(event._id,body,'sz-chair');assert.equal((await f.bridge.content(event._id,'sz-chair')).lastEdit.status,'complete');
 assert.equal(f.tables[WF.events].length,3);assert.equal(f.tables[WF.registrations].length,1);assert.equal(f.tables[WF.registrations][0]._id,booking._id);assert.equal(f.tables[WF.registrations][0]['活动ID'],child['活动ID']);assert.equal(f.tables[WF.registrations][0]['岗位'],'修改后的宣传岗');assert.equal(workflowEventApproved(event),true);
 const fresh=await f.bridge.content(event._id);const atStart=createWorkflow(f.base,{now:()=>Date.parse('2030-01-01T09:15:00+08:00'),approvalRouting:createWorkspaceApprovalRouting({getRoster:async()=>f.roster})});assert.equal(await atStart.canEditWorkspace(event._id,'sz-chair'),false);
 assert.equal(await f.workflow.canEditWorkspace(event._id,'nj-chair'),false);assert.ok(fresh.content.positions.every(p=>p.location==='修改地点'));
});


test('manual registration cutoff does not block chair edits before the actual start, but capacity and revocation do',async t=>{
 const f=await fixture(t);await f.submissions.submit(f.row.id,f.body,'creator');const event=f.tables[WF.events][0];await f.workflow.approve(event._id,'sz-chair','platform_admin',workflowApprovalHash(event));await f.workflow.publish(event._id,{actor:'sz-chair'});
 const child=f.tables[WF.events].find(e=>JSON.parse(e['报名页配置']).parentActivityId===event['活动ID']);
 f.tables[WF.registrations].push(...['a','b'].map(id=>({_id:id,报名ID:id,活动ID:child['活动ID'],账号ID:id,学号:id,报名状态:'已确认'})));
 await f.workflow.close(event._id,{scope:'project',actor:'director'});assert.equal(event['状态'],'进行中');assert.equal(await f.workflow.canEditWorkspace(event._id,'sz-chair'),true);
 const before=await f.bridge.content(event._id),body={expectedVersion:before.version,token:before.token,content:{...before.content,positions:before.content.positions.map((p,i)=>i?p:{...p,capacity:'1'})}};
 await assert.rejects(f.bridge.save(event._id,body,'sz-chair'),/已占用/);
 body.content.positions[0].capacity='2';body.content.positions[0].work='更新工作要求';await f.bridge.save(event._id,body,'sz-chair');assert.equal(event['状态'],'进行中');assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');assert.equal(f.tables[WF.registrations].length,2);
 f.roster.rows.find(r=>r.accountId==='sz-chair').active=false;assert.equal(await f.workflow.canEditWorkspace(event._id,'sz-chair'),false);
});

test('legacy project early end hides every child and prevents later registration without deleting records',async t=>{
 const f=await fixture(t);await f.submissions.submit(f.row.id,f.body,'creator');const parent=f.tables[WF.events][0];await f.workflow.approve(parent._id,'sz-chair','platform_admin',workflowApprovalHash(parent));await f.workflow.publish(parent._id,{actor:'sz-chair'});
 const children=f.tables[WF.events].filter(row=>JSON.parse(row['报名页配置']).parentActivityId===parent['活动ID']);assert.ok(children.length);
 const c=JSON.parse(parent['报名页配置']);delete c.workspaceSubmission;parent['报名页配置']=JSON.stringify(c);
 const before=structuredClone(f.tables[WF.registrations]);const state=await f.workflow.workspaceRemoval(parent._id,'director');assert.equal(state.canRemove,true);
 await f.workflow.removeWorkspace(parent._id,{token:state.token,requestId:'legacy-group-early-end',reason:''},'director');
 assert.ok((await f.workflow.read()).events.every(row=>row['状态']==='已归档'));assert.deepEqual(f.tables[WF.registrations],before);assert.equal(children[0]['状态'],'报名中');
 await assert.rejects(f.workflow.register(children[0]._id,{accountId:'new-person',studentId:'999990088',realName:'合成同学',email:'999990088@smail.nju.edu.cn',emailVerified:true,campus:'苏州'}),{statusCode:409});
});

test('people and per-position flexibility survive publication and copy to a new owner together',async t=>{
 const f=await fixture(t);
 const next={...f.row.content,projectOwnerId:'creator',responsibleId:'creator',responsibleIds:['creator','director'],reviewerIds:['sz-chair'],positions:f.row.content.positions.map((p,i)=>({...p,flexibleCapacity:i?'10':'5'}))};
 const saved=await f.drafts.save(f.row.id,{expectedVersion:1,content:next},'creator');
 const proof=await f.drafts.preview(saved.id,{expectedVersion:saved.version},'creator'),body={expectedVersion:saved.version,digest:proof.digest};
 await f.drafts.confirmPreview(saved.id,body,'creator');await f.submissions.submit(saved.id,body,'creator');
 const parent=f.tables[WF.events][0];await f.workflow.approve(parent._id,'sz-chair','platform_admin',workflowApprovalHash(parent));await f.workflow.publish(parent._id,{actor:'sz-chair'});
 const information=await f.bridge.content(parent._id,'creator');
 assert.equal(information.content.projectOwnerId,'creator');assert.deepEqual(information.content.responsibleIds,['creator','director']);assert.deepEqual(information.content.reviewerIds,['sz-chair']);
 assert.deepEqual(information.content.positions.map(p=>p.flexibleCapacity),['5','10']);
 const catalog=await f.workflow.catalog(),config=JSON.parse(catalog.events.find(row=>row._id===parent._id)['报名页配置']);
 assert.deepEqual(config.coOwners,['director']);assert.deepEqual(config.workspaceReviewerIds,['sz-chair']);assert.equal(config.registrationLimit,22);
 const original=await f.drafts.get(f.row.id,'creator');
 const copyService=createWorkspaceDrafts({...f.store,queue:createMutationQueue(),authorize:createWorkspaceDraftAuthorization({actor:'director',getRoster:async()=>f.roster}),validateResponsible:(content,actor,options)=>assertWorkspaceResponsible(content,actor,f.roster,options)});
 const copied=await copyService.copy(original.id,{expectedVersion:original.version,requestId:'synthetic-people-flex-copy'},'director');
 assert.equal(copied.content.projectOwnerId,'director');assert.deepEqual(copied.content.responsibleIds,['director','creator']);assert.deepEqual(copied.content.reviewerIds,['sz-chair']);
 assert.deepEqual(copied.content.positions.map(p=>p.flexibleCapacity),['5','10']);
});
