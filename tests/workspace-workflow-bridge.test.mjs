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

const content={name:'合成草稿提交',region:'suzhou',category:'生命中心',responsibleId:'director',bookingMode:'grouped',date:'2030-01-01',endDate:'2030-01-03',deadline:'2029-12-31T18:00',description:'完整活动说明',notice:'合成岗位通知',positions:[{id:'job-one',name:'宣传岗',date:'2030-01-01',start:'09:15',end:'11:45',campus:'苏州',location:'合成甲地',capacity:'3',serviceHours:'2.5',trainingHours:'0.5',travelHours:'1',work:'宣传服务'},{id:'job-two',name:'签到岗',date:'2030-01-03',start:'14:10',end:'16:40',campus:'苏州',location:'合成乙地',capacity:'4',serviceHours:'2',trainingHours:'1',travelHours:'0',work:'签到服务'}]};
async function fixture(t){
 const store=openWorkspaceDraftStore(':memory:');t.after(()=>store.close());const queue=createMutationQueue();let seq=0;
 const tables=Object.fromEntries([...Object.values(WF),ORDINARY_GROUP_TABLE].map(name=>[name,[]]));
 const base={getMetadata:async()=>({tables:Object.keys(tables).map(name=>({name}))}),listRows:async(name,_v,_o,_c,start=0,count=500)=>structuredClone(tables[name].slice(start,start+count)),appendRow:async(name,row)=>{const saved={...row,_id:`synthetic-${++seq}`};tables[name].push(saved);return {_id:saved._id};},updateRow:async(name,id,patch)=>Object.assign(tables[name].find(row=>row._id===id),patch)};
 const roster={complete:true,rows:[{accountId:'creator',region:'suzhou',role:'director',active:true,categories:['生命中心']},{accountId:'director',region:'suzhou',role:'director',active:true,categories:['生命中心']},{accountId:'sz-chair',region:'suzhou',role:'presidium',active:true,categories:[]},{accountId:'nj-chair',region:'nanjing',role:'presidium',active:true,categories:[]}]};
 const authorize=async(row,actor)=>{if(row.ownerId!==actor)throw Object.assign(new Error('denied'),{statusCode:403});};
 const drafts=createWorkspaceDrafts({...store,queue,authorize,validateResponsible:(c,a,o)=>assertWorkspaceResponsible(c,a,roster,o)});
 const workflow=createWorkflow(base,{approvalRouting:createWorkspaceApprovalRouting({getRoster:async()=>roster})}),bridge=createWorkspaceWorkflowBridge({workflow,getRoster:async()=>structuredClone(roster)});
 const submissions=createWorkspaceSubmissions({...store,queue,drafts,authorize,...bridge});
 const row=await drafts.create({requestId:'synthetic-full-handoff',content},'creator');
 const preview=await drafts.preview(row.id,{expectedVersion:1},'creator');await drafts.confirmPreview(row.id,{expectedVersion:1,digest:preview.digest},'creator');
 return {store,drafts,submissions,bridge,workflow,base,tables,roster,row,body:{expectedVersion:1,digest:preview.digest}};
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
 await assert.rejects(f.bridge.save(event._id,{...body,content:{...body.content,capacity:'999'}},'sz-chair'),/保留现有岗位/);
 await f.bridge.save(event._id,body,'sz-chair');assert.equal(event['状态'],'报名中');assert.equal(event['通知草稿'],'主席团更新通知');assert.equal(workflowEventApproved(event),true);assert.deepEqual(JSON.parse(event['报名页配置']).positionPlan,positions);assert.deepEqual(child,storedChild);assert.deepEqual(f.tables[WF.registrations],storedRegistration);
 await f.workflow.deliverRoster(child._id,{send:async message=>{messages.push(message);return {ok:true,transport:'smtp'};}});assert.equal(messages.length,1);
 const next=await f.bridge.content(event._id);f.tables[WF.ledger].push({_id:'synthetic-hours',活动ID:child['活动ID']});await assert.rejects(f.bridge.save(event._id,{expectedVersion:next.version,token:next.token,content:{...next.content,description:'不应生效'}},'sz-chair'),/签到时长/);
});


test('published generated notice follows information changes and editor deadline remains a local minute value',async t=>{
 const f=await fixture(t),generated={...content,notice:workspaceNotice(content)};await f.drafts.save(f.row.id,{expectedVersion:1,content:generated},'creator');const preview=await f.drafts.preview(f.row.id,{expectedVersion:2},'creator');await f.drafts.confirmPreview(f.row.id,{expectedVersion:2,digest:preview.digest},'creator');await f.submissions.submit(f.row.id,{expectedVersion:2,digest:preview.digest},'creator');
 const event=f.tables[WF.events][0];await f.workflow.approve(event._id,'sz-chair','platform_admin',workflowApprovalHash(event));await f.workflow.publish(event._id,{actor:'sz-chair'});
 const before=await f.bridge.content(event._id);assert.equal(before.content.deadline,'2029-12-31T18:00');assert.equal(before.content.notice,workspaceNotice(before.content));
 await f.bridge.save(event._id,{expectedVersion:before.version,token:before.token,content:{...before.content,description:'最新活动说明'}},'sz-chair');assert.match(event['通知草稿'],/最新活动说明/);assert.equal(event['状态'],'报名中');assert.equal(workflowEventApproved(event),true);
});
