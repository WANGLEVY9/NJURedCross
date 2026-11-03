import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createWorkflow,WF,workflowApprovalHash} from '../lib/events/workflow.js';
import {BLOOD_SOURCE_TABLE} from '../lib/events/blood-source.js';
import {runningSourceDigest} from '../lib/events/running-review.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';
import {createActivityLifecycleStore} from '../lib/events/activity-lifecycle-store.js';
import {manualHoursEvidence} from '../lib/events/manual-hours.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planBloodWeek} from '../lib/events/blood-week-automation.js';

const details={serviceHours:2,trainingHours:1,travelHours:0,location:'合成场地',dates:'2026-10-12 上午',work:'合成服务',remark:''};
const input=eventId=>({requestId:randomUUID(),eventId,name:'补录合成同学',studentId:'00123456',department:'合成学院',email:'',details,reason:'现场签到名单及负责人确认',evidenceChecked:true});
function fixture({blood=false,workspace=false,store}={}){
 let seq=0,failAt='';const rows=Object.fromEntries(Object.values(WF).map(table=>[table,[]]));
 rows[BLOOD_SOURCE_TABLE]=[{_id:'source',日期:'2026-10-12',点位:'新街口中央',活动时间:'上午 11~15点',周次:46,姓名:'已有同学',学号:'999990001',报名结果:'成功'}];
 const event={_id:'event',活动ID:'event-code',活动名称:'合成补录活动',活动类别:'志愿服务',负责人账号ID:'director',状态:'进行中',申请版本:'1',批准版本:'1',报名日期:'2026-10-12',报名时段:'上午',岗位:'合成服务岗',容量:2,服务时长:2,培训时长:1,交通时长:0,地点:'合成场地',工作内容:'合成服务',报名页配置:JSON.stringify(workspace?{workspaceSubmission:{origin:true}}:{})};event['批准摘要']=workflowApprovalHash(event);
 if(!blood)rows[WF.events].push(event);
 if(workspace){const c=JSON.parse(event['报名页配置']);c.runningReview={status:'submitted',sourceDigest:runningSourceDigest([event],[],[],[]),previewToken:'first-review',entries:[]};event['报名页配置']=JSON.stringify(c);}
 const base={
  async getMetadata(){return {tables:[{name:BLOOD_SOURCE_TABLE,columns:['网站报名ID','网站账号ID'].map(name=>({name,type:'text'}))}]};},
  async listRows(table,_v,_o,_c,start=0,limit=1000){return structuredClone((rows[table]||[]).slice(start,start+limit));},
  async getRow(table,id){return structuredClone(rows[table]?.find(row=>row._id===id));},
  async appendRow(table,patch){const row={...patch,_id:`row-${++seq}`};(rows[table]||=[]).push(row);if(failAt===`append:${table}`){failAt='';throw Error('lost acknowledgement');}return {_id:row._id};},
  async updateRow(table,id,patch){Object.assign(rows[table].find(row=>row._id===id),patch);if(failAt===`update:${table}`){failAt='';throw Error('lost acknowledgement');}},
 };
 const authorize=async(_event,actor)=>{if(!['reviewer','super'].includes(actor))throw Object.assign(Error('forbidden'),{statusCode:403});};
 const routing={assertHoursReviewer:authorize,assertRegistrar:authorize,hoursRecipient:async()=>({email:'synthetic@example.test',accountId:'director'})};
 const w=createWorkflow(base,{...(store?{activityLifecycleStore:store}: {}),mode:blood?'production':'test',bloodSourceTable:blood?BLOOD_SOURCE_TABLE:null,approvalRouting:routing,now:()=>Date.parse('2026-10-13T12:00:00Z')});
 return {w,rows,event,base,fail:stage=>{failAt=stage;}};
}

test('manual legacy hours create durable evidence and remain pending until reviewed; retry is idempotent',async()=>{
 const f=fixture(),body=input('event');
 const result=await f.w.addHoursParticipant('event',body,'reviewer',{accountId:'existing-member'});
 assert.equal(f.rows[WF.registrations].length,1);assert.equal(f.rows[WF.checkins].length,1);assert.equal(f.rows[WF.ledger].length,1);
 assert.equal(f.rows[WF.registrations][0]['账号ID'],'existing-member');assert.equal(f.rows[WF.ledger][0]['状态'],'待批准');
 await assert.rejects(f.w.exportDraft('event'),/没有已批准/);
 assert.deepEqual(await f.w.addHoursParticipant('event',body,'reviewer',{accountId:'existing-member'}),result);
 const sheet=await f.w.reviewDraft('event');await f.w.approveBatch('event',[{id:result.ledgerId,expectedDigest:sheet.entries[0]['核对摘要']}],'super','super_admin');
 const workbook=await f.w.exportDraft('event');assert.equal(workbook.rows[0]['学号'],'00123456');assert.equal(workbook.rows[0]['服务时长'],2);
 await f.w.post(result.ledgerId);assert.equal(f.rows[WF.profiles][0]['志愿时长'],'2');assert.equal(f.rows[WF.registrations][0]['录入状态'],'网站已入账');
 await assert.rejects(f.w.addHoursParticipant('event',{...body,requestId:randomUUID()},'reviewer'),/已有报名/);
});

test('manual blood hours append a supplemental source row without overwriting the occupied seat',async()=>{
 const f=fixture({blood:true}),event=(await f.w.read()).events[0],body=input(event._id);
 f.fail(`append:${BLOOD_SOURCE_TABLE}`);
 const result=await f.w.addHoursParticipant(event._id,body,'reviewer');
 assert.equal(f.rows[BLOOD_SOURCE_TABLE].length,2);assert.equal(f.rows[BLOOD_SOURCE_TABLE][0]['姓名'],'已有同学');
 assert.ok(f.rows[BLOOD_SOURCE_TABLE][1]['网站报名ID'].startsWith(`WMH-${body.requestId}-`));assert.equal(f.rows[BLOOD_SOURCE_TABLE][1]['报名结果'],'成功');
 assert.ok(f.rows[BLOOD_SOURCE_TABLE][1]['网站报名ID'].endsWith('-extra'));
 assert.equal(planBloodWeek({rows:f.rows[BLOOD_SOURCE_TABLE],monday:'2026-10-19',templateMonday:'2026-10-12'}).positions.length,1);
 assert.equal(f.rows[WF.registrations][0]['岗位源行ID'],f.rows[BLOOD_SOURCE_TABLE][1]._id);assert.equal(f.rows[WF.registrations][0]['签到照片ID'],undefined);
 await f.w.addHoursParticipant(event._id,body,'reviewer');assert.equal(f.rows[BLOOD_SOURCE_TABLE].length,2);
 const sheet=await f.w.reviewDraft(event._id);assert.equal(sheet.entries.length,1);
 f.rows[WF.checkins][0]['核验说明']='tampered';await assert.rejects(f.w.reviewDraft(event._id),/补录核验/);
 assert.ok(result.ledgerId);
});

test('a manual participant using an existing empty source seat keeps that seat in future templates',async()=>{
 const f=fixture({blood:true});Object.assign(f.rows[BLOOD_SOURCE_TABLE][0],{姓名:'',学号:'',报名结果:'可报名'});
 const event=(await f.w.read()).events[0];await f.w.addHoursParticipant(event._id,input(event._id),'reviewer');
 assert.equal(f.rows[BLOOD_SOURCE_TABLE].length,1);assert.equal(f.rows[BLOOD_SOURCE_TABLE][0]['网站报名ID'].endsWith('-extra'),false);
 assert.equal(planBloodWeek({rows:f.rows[BLOOD_SOURCE_TABLE],monday:'2026-10-19',templateMonday:'2026-10-12'}).positions.length,1);
});

test('manual source identity conflict leaves no exportable hours and retry recovers the same registration',async()=>{
 const f=fixture({blood:true}),event=(await f.w.read()).events[0],body=input(event._id);
 Object.assign(f.rows[BLOOD_SOURCE_TABLE][0],{学号:body.studentId,姓名:'另一人'});
 await assert.rejects(f.w.addHoursParticipant(event._id,body,'reviewer'),/身份或报名/);assert.equal(f.rows[WF.ledger].length,0);
 Object.assign(f.rows[BLOOD_SOURCE_TABLE][0],{姓名:body.name,邮箱:'legacy@example.test'});
 await f.w.addHoursParticipant(event._id,body,'reviewer');assert.equal(f.rows[WF.registrations].length,1);assert.equal(f.rows[BLOOD_SOURCE_TABLE].length,1);
 assert.equal(f.rows[BLOOD_SOURCE_TABLE][0]['邮箱'],'legacy@example.test');
});

test('final supplements preserve first-review evidence, synchronize the registration and lock after export',async()=>{
 const f=fixture({workspace:true}),sheet=await f.w.finalHours('event','reviewer'),body={...input('event'),token:sheet.token};
 const first=JSON.parse(f.event['报名页配置']).runningReview;
 const added=await f.w.addFinalHoursParticipant('event',body,'reviewer');
 assert.deepEqual(JSON.parse(f.event['报名页配置']).runningReview,first);
 const next=await f.w.finalHours('event','reviewer');assert.equal(next.rows.length,1);assert.equal(next.rows[0].manual,true);assert.equal(next.pendingManual,0);
 assert.deepEqual(await f.w.addFinalHoursParticipant('event',body,'reviewer'),added);
 await f.w.exportFinalHours('event',{token:next.token},'reviewer');assert.equal(f.rows[WF.registrations][0]['志愿时长'],'2');assert.equal(f.rows[WF.registrations][0]['录入状态'],'待录入');
 assert.ok((await f.w.downloadFinalHours('event','reviewer')).buffer.length);
 await assert.rejects(f.w.addFinalHoursParticipant('event',body,'reviewer'),/最终表已导出/);
});

test('invalid, unauthorized and foreign-position additions never create records',async()=>{
 const f=fixture(),body=input('event');
 await assert.rejects(f.w.addHoursParticipant('event',body,'other'),{statusCode:403});
 await assert.rejects(f.w.addHoursParticipant('event',{...body,eventId:'foreign'},'reviewer'));
 await assert.rejects(f.w.addHoursParticipant('event',{...body,evidenceChecked:false},'reviewer'),/核对/);
 await assert.rejects(f.w.addHoursParticipant('event',{...body,details:{...details,serviceHours:-1}},'reviewer'),/非负/);
 assert.equal(f.rows[WF.registrations].length,0);
});

test('lost registration, attendance, ledger and final-save acknowledgements never duplicate a person',async()=>{
 for(const table of [WF.registrations,WF.checkins,WF.ledger]){
  const f=fixture(),body=input('event');f.fail(`append:${table}`);
  await assert.rejects(f.w.addHoursParticipant('event',body,'reviewer'));
  await f.w.addHoursParticipant('event',body,'reviewer');
  for(const name of [WF.registrations,WF.checkins,WF.ledger])assert.equal(f.rows[name].length,1);
 }
 const f=fixture({workspace:true}),sheet=await f.w.finalHours('event','reviewer'),body={...input('event'),token:sheet.token};
 f.fail(`update:${WF.events}`);await assert.rejects(f.w.addFinalHoursParticipant('event',body,'reviewer'));
 await f.w.addFinalHoursParticipant('event',body,'reviewer');assert.equal((await f.w.finalHours('event','reviewer')).rows.length,1);assert.equal(f.rows[WF.registrations].length,1);
});

test('an incomplete final supplement blocks export and can resume without changing first-review evidence',async()=>{
 const f=fixture({workspace:true}),sheet=await f.w.finalHours('event','reviewer'),body={...input('event'),token:sheet.token};
 f.fail(`append:${WF.checkins}`);await assert.rejects(f.w.addFinalHoursParticipant('event',body,'reviewer'));
 const pending=await f.w.finalHours('event','reviewer');assert.equal(pending.pendingManual,1);
 assert.equal(pending.pendingRequests[0].requestId,body.requestId);assert.deepEqual(pending.pendingRequests[0].details,body.details);
 await assert.rejects(f.w.exportFinalHours('event',{token:pending.token},'reviewer'),/未完成的人员补录/);
 await f.w.addFinalHoursParticipant('event',body,'reviewer');assert.equal((await f.w.finalHours('event','reviewer')).pendingManual,0);
});

test('durable supplemental requests and independent proof key survive reopening the private state',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'manual-hours-')),file=join(directory,'state.sqlite');let store=createActivityLifecycleStore(file);
 try{
  const f=fixture({store}),body=input('event');f.fail(`append:${WF.checkins}`);await assert.rejects(f.w.addHoursParticipant('event',body,'reviewer'));
  const draft=(await f.w.reviewDraft('event')).pendingManual[0];assert.equal(draft.requestId,body.requestId);
  await f.w.addHoursParticipant('event',body,'reviewer');
  assert.equal(manualHoursEvidence(f.rows[WF.registrations][0],f.rows[WF.checkins][0],()=>store.manualHoursSecret()),true);
  store.close();store=createActivityLifecycleStore(file);
  assert.equal(store.manualHoursRequest(body.requestId).actor,'reviewer');
  assert.equal(manualHoursEvidence(f.rows[WF.registrations][0],f.rows[WF.checkins][0],()=>store.manualHoursSecret()),true);
 }finally{store.close();await rm(directory,{recursive:true,force:true});}
});

test('API uses the session actor, verifies authority before identity resolution and requires CSRF',async()=>{
 for(const workspace of [false,true]){
  const f=fixture({workspace}),sheet=workspace?await f.w.finalHours('event','reviewer'):null,body={...input('event'),...(sheet?{token:sheet.token}: {})};
  const endpoint=new URL(`http://localhost/api/volunteer/workflow/events/event/${workspace?'final-hours-participants':'hours-participants'}`);
  let csrf=true,resolved=0;
  const session={username:'trusted-login',role:'super_admin'};
  const ctx={getWorkflow:async()=>f.w,requireConsoleAccess:()=>session,requireCsrf:()=>csrf,readJson:async()=>body,actor:()=> 'reviewer',json:(_res,status,payload)=>({status,...payload}),audit:async()=>{},resolveHoursParticipant:async()=>{resolved++;return {accountId:'trusted-member'};}};
  const req={method:'POST',headers:{}};
  csrf=false;await workflowRoutes(req,null,endpoint,ctx);assert.equal(resolved,0);assert.equal(f.rows[WF.registrations].length,0);
  csrf=true;const result=await workflowRoutes(req,null,endpoint,ctx);assert.equal(result.status,200);assert.equal(f.rows[WF.registrations][0]['账号ID'],'trusted-member');assert.equal(f.rows[WF.checkins][0]['核验人'],'reviewer');
 }
 const f=fixture({blood:true}),event=(await f.w.read()).events[0];let resolved=0;
 const denied={getWorkflow:async()=>f.w,requireConsoleAccess:()=>({role:'member'}),requireCsrf:()=>true,readJson:async()=>input(event._id),actor:()=> 'other',json:(_res,status,payload)=>({status,...payload}),audit:async()=>{},resolveHoursParticipant:async()=>{resolved++;}};
 const result=await workflowRoutes({method:'POST',headers:{}},null,new URL(`http://localhost/api/volunteer/workflow/events/${event._id}/hours-participants`),denied);assert.equal(result.status,403);assert.equal(resolved,0);
});


for(const workspace of [false,true])test(`actual service after rejection supplements hours without rewriting the original (${workspace?'workspace':'legacy'})`,async()=>{
 const f=fixture({workspace}),body=input('event');
 const rejected={_id:'rejected',活动ID:'event-code',报名ID:'WR-rejected',账号ID:'existing-member',姓名:body.name,学号:body.studentId,院系:body.department,邮箱:'',报名状态:'未入选',是否报名成功:'false',处理说明:'原报名未录取',报名日期:f.event['报名日期'],报名时段:f.event['报名时段']};f.rows[WF.registrations].push(rejected);
 const before=structuredClone(rejected),initial=JSON.parse(f.event['报名页配置']).runningReview;
 const sheet=workspace?await f.w.finalHours('event','reviewer'):null;
 const request={...body,...(sheet?{token:sheet.token}:{})};
 const add=workspace?()=>f.w.addFinalHoursParticipant('event',request,'reviewer',{accountId:'existing-member'}):()=>f.w.addHoursParticipant('event',request,'reviewer',{accountId:'existing-member'});
 const result=await add();assert.deepEqual(rejected,before);assert.equal(f.rows[WF.registrations].length,2);assert.equal(f.rows[WF.checkins].length,1);assert.deepEqual(await add(),result);
 assert.equal(f.rows[WF.registrations][1]['签到照片ID'],undefined);
 if(workspace){const next=await f.w.finalHours('event','reviewer');assert.equal(next.rows.length,1);assert.deepEqual(JSON.parse(f.event['报名页配置']).runningReview,initial);await f.w.exportFinalHours('event',{token:next.token},'reviewer');assert.ok((await f.w.downloadFinalHours('event','reviewer')).buffer.length);}
 else {const review=await f.w.reviewDraft('event');assert.equal(review.entries.length,1);await f.w.approveBatch('event',[{id:result.ledgerId,expectedDigest:review.entries[0]['核对摘要']}],'super','super_admin');assert.equal((await f.w.exportDraft('event')).rows[0]['学号'],body.studentId);}
 assert.deepEqual(rejected,before);
});


test('a rejected blood source seat is reconciled only for the same verified person',async()=>{
 const f=fixture({blood:true}),event=(await f.w.read()).events[0],body=input(event._id);
 Object.assign(f.rows[BLOOD_SOURCE_TABLE][0],{姓名:body.name,学号:body.studentId,报名人:body.name,报名结果:'未入选',网站报名ID:'WR-rejected',网站账号ID:'member'});
 const original={_id:'rejected',活动ID:event['活动ID'],报名ID:'WR-rejected',账号ID:'member',姓名:body.name,学号:body.studentId,院系:body.department,报名状态:'未入选',是否报名成功:'false',处理说明:'原未录取',报名日期:event['报名日期'],报名时段:event['报名时段']};f.rows[WF.registrations].push(original);
 const before=structuredClone(original),result=await f.w.addHoursParticipant(event._id,body,'reviewer',{accountId:'member'});
 assert.deepEqual(original,before);assert.equal(f.rows[BLOOD_SOURCE_TABLE].length,1);assert.equal(f.rows[BLOOD_SOURCE_TABLE][0]['报名结果'],'成功');assert.equal(f.rows[BLOOD_SOURCE_TABLE][0]['网站报名ID'],f.rows[WF.registrations].find(row=>row._id===result.id)['报名ID']);
 await f.w.addHoursParticipant(event._id,body,'reviewer',{accountId:'member'});assert.equal(f.rows[WF.checkins].length,1);assert.equal(f.rows[BLOOD_SOURCE_TABLE].length,1);
});

test('rejected supplementation refuses identity and recorded-evidence conflicts',async()=>{
 for(const kind of ['identity','photo','ledger']){
  const f=fixture(),body=input('event'),registration={_id:'rejected',活动ID:'event-code',报名ID:'WR-rejected',账号ID:kind==='identity'?'different-member':'member',姓名:body.name,学号:body.studentId,报名状态:'未入选'};
  if(kind==='photo')registration['签到照片ID']='actual-photo';if(kind==='ledger')f.rows[WF.ledger].push({_id:'existing-hours',报名行ID:registration._id,状态:'已批准',服务时长:2});f.rows[WF.registrations].push(registration);
  await assert.rejects(f.w.addHoursParticipant('event',body,'reviewer',{accountId:'member'}),{statusCode:409});assert.equal(f.rows[WF.registrations].length,1);assert.equal(f.rows[WF.checkins].length,0);
 }
});

test('large-config final archive and mail state survive reopening the private state database',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'final-hours-state-')),file=join(directory,'state.sqlite');let store=createActivityLifecycleStore(file);
 try{
  const f=fixture({workspace:true,store}),c=JSON.parse(f.event['报名页配置']);c.description='合成'.repeat(4500);c.finalHours={status:'review',entryCount:0,updatedBy:'reviewer',updatedAt:'2030-01-01T00:00:00.000Z'};
  const target=9840;c.description+='文'.repeat(Math.max(0,target-JSON.stringify(c).length));f.event['报名页配置']=JSON.stringify(c);f.event['批准摘要']=workflowApprovalHash(f.event);c.runningReview.sourceDigest=runningSourceDigest([f.event],[],[],[]);f.event['报名页配置']=JSON.stringify(c);
  const before=await f.w.finalHours('event','reviewer');await f.w.addFinalHoursParticipant('event',{...input('event'),token:before.token},'reviewer');const ready=await f.w.finalHours('event','reviewer');await f.w.exportFinalHours('event',{token:ready.token},'reviewer');
  const header=JSON.parse(f.event['报名页配置']).finalHours;assert.ok(header.stateRef);store.close();store=createActivityLifecycleStore(file);
  const w=createWorkflow(f.base,{activityLifecycleStore:store,approvalRouting:{assertRegistrar:async()=>{},assertHoursReviewer:async()=>{},hoursRecipient:async()=>({email:'synthetic@example.test',accountId:'director'})}});
  assert.equal((await w.finalHours('event','reviewer')).mailStatus,'pending');assert.ok((await w.downloadFinalHours('event','reviewer')).buffer.length);
  let sent=0;await w.deliverPendingFinalHours(async()=>{sent++;return {ok:true,transport:'smtp'};});assert.equal(sent,1);assert.equal((await w.finalHours('event','reviewer')).mailStatus,'sent');
  assert.equal(store.finalHoursState('foreign-event',header.stateRef),null);
 }finally{store.close();await rm(directory,{recursive:true,force:true});}
});


test('an incomplete supplement refuses a newly confirmed original record instead of duplicating hours on retry',async()=>{
 const f=fixture(),body=input('event'),old={_id:'old',活动ID:'event-code',报名ID:'WR-old',姓名:body.name,学号:body.studentId,账号ID:'member',报名状态:'未入选'};f.rows[WF.registrations].push(old);
 f.fail(`append:${WF.registrations}`);await assert.rejects(f.w.addHoursParticipant('event',body,'reviewer',{accountId:'member'}));old['报名状态']='已确认';
 await assert.rejects(f.w.addHoursParticipant('event',body,'reviewer',{accountId:'member'}),{statusCode:409});assert.equal(f.rows[WF.registrations].length,2);assert.equal(f.rows[WF.checkins].length,0);assert.equal(f.rows[WF.ledger].length,0);
});


test('final version tokens ignore read order but still reject a real concurrent edit before adding anyone',async()=>{
 const f=fixture({workspace:true}),one=input('event'),initial=await f.w.finalHours('event','reviewer');
 await f.w.addFinalHoursParticipant('event',{...one,token:initial.token},'reviewer');
 const beforeTwo=await f.w.finalHours('event','reviewer'),two={...input('event'),name:'另一位合成同学',studentId:'00000002'};
 await f.w.addFinalHoursParticipant('event',{...two,token:beforeTwo.token},'reviewer');
 const before=await f.w.finalHours('event','reviewer');f.rows[WF.registrations].reverse();f.rows[WF.ledger].reverse();f.rows[WF.checkins].reverse();
 const reordered=await f.w.finalHours('event','reviewer');assert.equal(reordered.token,before.token);
 const three={...input('event'),name:'待补录合成同学',studentId:'00000003',token:beforeTwo.token};
 await assert.rejects(f.w.addFinalHoursParticipant('event',three,'reviewer'),{statusCode:409,code:'manual_hours_version_conflict'});assert.equal(f.rows[WF.registrations].length,2);
 const fresh=await f.w.finalHours('event','reviewer'),result=await f.w.addFinalHoursParticipant('event',{...three,token:fresh.token},'reviewer');
 assert.deepEqual(await f.w.addFinalHoursParticipant('event',three,'reviewer'),result);assert.equal(f.rows[WF.registrations].length,3);assert.equal(f.rows[WF.checkins].length,3);
});
