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
