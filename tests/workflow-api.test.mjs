import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workflowApprovalHash} from '../lib/events/workflow.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';
function ctx(){const events=[{_id:'draft',活动ID:'D',活动名称:'草稿',状态:'待审核',申请版本:'1',批准版本:''},{_id:'public',活动ID:'P',活动名称:'公开',状态:'报名中',申请版本:'1',批准版本:'1',负责人账号ID:'private-owner'}];events[1]['批准摘要']=workflowApprovalHash(events[1]);let writes=0;return {json:(_r,status,body)=>({status,body}),getWorkflow:async()=>({async read(){return this.publicRead();},async memberRead(){return this.publicRead();},publicRead:async()=>({events,registrations:[{_id:'private-source',账号ID:'own',活动ID:'P',姓名:'自己',学号:'999990001',报名ID:'mine'},{账号ID:'other',姓名:'其他学生'}],ledger:[{账号ID:'own',来源摘要:'internal',服务时长:'2'},{账号ID:'other',姓名:'其他学生'}],profiles:[{账号ID:'own',志愿时长:'2'}]}),register:async()=>{writes++;return{};}}),requireConsoleAccess:()=>null,requirePortalSession:()=>({username:'own'}),requireCsrf:()=>true,readJson:async req=>req.body||{},getAccount:async()=>({accountId:'own',realName:'合成同学',email:'999990001@smail.nju.edu.cn',emailVerified:true,campus:'鼓楼',studentId:'999990001',department:'合成院系',grade:'2023级'}),actor:()=>'',audit:async()=>{},writes:()=>writes};}
const req=(method='GET',body)=>({method,body,headers:{host:'localhost'}});

test('formal removal routes use the session actor and enforce CSRF and origin before writes',async()=>{
 const c=ctx(),calls=[];c.requireConsoleAccess=()=>({role:'platform_admin'});c.actor=()=> 'trusted-director';c.getWorkflow=async()=>({workspaceRemoval:async(...args)=>{calls.push(['read',...args]);return {canRemove:true};},removeWorkspace:async(...args)=>{calls.push(['remove',...args]);return {removed:true};}});
 const url=new URL('http://localhost/api/volunteer/workflow/events/e/workspace-removal'),body={token:'t',requestId:'synthetic-request',reason:''};
 assert.equal((await workflowRoutes(req(),null,url,c)).status,200);assert.equal((await workflowRoutes(req('POST',body),null,url,c)).status,200);assert.equal(calls[1][3],'trusted-director');
 c.requireCsrf=()=>false;await workflowRoutes(req('POST',body),null,url,c);assert.equal(calls.length,2);c.requireCsrf=()=>true;
 const cross=req('POST',body);cross.headers.origin='https://other.test';assert.equal((await workflowRoutes(cross,null,url,c)).status,403);assert.equal(calls.length,2);
});
test('final-hours routes enforce CSRF, session actor and attachment download without accepting identity overrides',async()=>{
 const c=ctx(),calls=[];c.requireConsoleAccess=()=>({role:'platform_admin'});c.actor=()=> 'trusted-chair';
 c.getWorkflow=async()=>({finalHours:async(...args)=>{calls.push(['read',...args]);return {};},saveFinalHours:async(...args)=>calls.push(['save',...args]),exportFinalHours:async(...args)=>{calls.push(['export',...args]);return {exported:true};},downloadFinalHours:async(...args)=>{calls.push(['download',...args]);return {buffer:Buffer.from('synthetic XLSX'),filename:'合成分工时长表.xlsx'};}});
 const url=action=>new URL(`http://localhost/api/volunteer/workflow/events/e/final-hours${action?'-'+action:''}`);
 assert.equal((await workflowRoutes(req('PATCH',{token:'t',items:[],recipient:'foreign@example.test'}),null,url(''),c)).status,400);
 assert.equal((await workflowRoutes(req('PATCH',{token:'t',items:[]}),null,url(''),c)).status,200);assert.equal((await workflowRoutes(req('POST',{token:'t'}),null,url('export'),c)).status,200);
 const response={writeHead(status,headers){this.status=status;this.headers=headers;},end(buffer){this.buffer=buffer;}};c.requireCsrf=()=>false;
 await workflowRoutes(req('GET'),response,url('download'),c);assert.equal(response.status,200);assert.equal(response.headers['Cache-Control'],'private, no-store');assert.deepEqual(response.buffer,Buffer.from('synthetic XLSX'));
 const count=calls.length;await workflowRoutes(req('POST',{token:'t'}),null,url('export'),c);assert.equal(calls.length,count);
 assert.deepEqual(calls.filter(call=>['save','export'].includes(call[0])).map(call=>[call[0],call[1],call[3]]),[['save','e','trusted-chair'],['export','e','trusted-chair']]);
});

test('running routes use session actor, reject extra fields and block unauthorized imports before parsing',async()=>{
 const c=ctx(),calls=[];c.requireConsoleAccess=()=>({role:'platform_admin'});c.actor=()=> 'trusted-director';
 c.getWorkflow=async()=>({runningReview:async(...args)=>{calls.push(['read',...args]);return {canRecord:false};},saveRunningReview:async(...args)=>calls.push(['save',...args]),previewRunningReview:async(...args)=>calls.push(['preview',...args]),submitRunningReview:async(...args)=>calls.push(['submit',...args])});
 const url=action=>new URL(`http://localhost/api/volunteer/workflow/events/e/running-${action}`);
 assert.equal((await workflowRoutes(req('GET'),null,url('review'),c)).status,200);
 assert.equal((await workflowRoutes(req('POST',{name:'malformed.xlsx',bytes:'malformed'}),null,url('import'),c)).status,403);
 assert.equal((await workflowRoutes(req('PATCH',{token:'t',items:[],actor:'foreign'}),null,url('review'),c)).status,400);
 await workflowRoutes(req('PATCH',{token:'t',items:[]}),null,url('review'),c);
 await workflowRoutes(req('POST',{token:'t',items:[]}),null,url('preview'),c);
 await workflowRoutes(req('POST',{token:'t',items:[],previewToken:'p'}),null,url('submit'),c);
 assert.deepEqual(calls.filter(call=>['save','preview','submit'].includes(call[0])).map(call=>[call[0],call[1],call[3]]),[['save','e','trusted-director'],['preview','e','trusted-director'],['submit','e','trusted-director']]);
 assert.equal((await workflowRoutes(req('DELETE'),null,url('review'),c)).status,405);
 const count=calls.length;c.requireCsrf=()=>false;await workflowRoutes(req('POST',{token:'t',items:[]}),null,url('submit'),c);assert.equal(calls.length,count);
});
test('student attendance remains available during a new project and closes after first-review submission',async()=>{
 const c=ctx(),parent={_id:'parent',活动ID:'parent-code',状态:'进行中',报名页配置:JSON.stringify({positionPlan:{groupId:'g'},workspaceSubmission:{origin:true}})},child={_id:'child',活动ID:'child-code',状态:'进行中',报名页配置:JSON.stringify({ordinary:{groupId:'g'}})};
 c.getWorkflow=async()=>({memberRead:async()=>({events:[parent,child],registrations:[{账号ID:'own',活动ID:'child-code',报名状态:'已确认'}],ledger:[],profiles:[]})});
 const url=new URL('http://localhost/api/portal/workflow/me');let result=await workflowRoutes(req(),null,url,c);assert.equal(result.body.registrations[0].attendanceOpen,true);
 const config=JSON.parse(parent['报名页配置']);config.runningReview={status:'submitted'};parent['报名页配置']=JSON.stringify(config);result=await workflowRoutes(req(),null,url,c);assert.equal(result.body.registrations[0].attendanceOpen,false);
});
test('publication routes validate schedule payload and explicitly request immediate release',async()=>{
 const c=ctx(),calls=[];c.requireConsoleAccess=()=>({role:'super_admin'});c.actor=()=> 'trusted-chair';
 c.getWorkflow=async()=>({schedulePublication:async(...args)=>calls.push(['schedule',...args]),publish:async(...args)=>calls.push(['publish',...args])});
 const url=new URL('http://localhost/api/volunteer/workflow/events/e/schedule');
 for(const body of [{},{publishAt:12},{publishAt:null,extra:true},[]])assert.equal((await workflowRoutes(req('POST',body),null,url,c)).status,400);
 assert.equal(calls.length,0);
 for(const publishAt of ['2026-10-18T07:00:09+08:00',null])assert.equal((await workflowRoutes(req('POST',{publishAt}),null,url,c)).status,200);
 await workflowRoutes(req('POST',{}),null,new URL('http://localhost/api/volunteer/workflow/events/e/publish'),c);
 assert.deepEqual(calls,[['schedule','e','2026-10-18T07:00:09+08:00','trusted-chair'],['schedule','e',null,'trusted-chair'],['publish','e',{publishAt:null,actor:'trusted-chair'}]]);
});
test('project batch permits explicit sibling sessions and rejects foreign records before writes',async()=>{
 const c=ctx(),events=['a','b','c'].map((id,i)=>({_id:id,活动ID:id,报名页配置:JSON.stringify({ordinary:{groupId:i<2?'one':'other'}})}));
 const registrations=events.map(e=>({_id:`r-${e._id}`,活动ID:e['活动ID']}));let writes=0;
 c.requireConsoleAccess=()=>({role:'super_admin'});
 c.getWorkflow=async()=>({overview:async()=>({events,registrations}),checkin:async()=>{writes++;}});
 const url=new URL('http://localhost/api/volunteer/workflow/registrations/batch');
 assert.equal((await workflowRoutes(req('POST',{ids:['r-a','r-c'],action:'checkin'}),null,url,c)).status,400);
 assert.equal(writes,0);
 const out=await workflowRoutes(req('POST',{ids:['r-a','r-b'],action:'checkin'}),null,url,c);
 assert.equal(out.status,200);assert.equal(writes,2);assert.ok(out.body.results.every(r=>r.ok));
});
test('public calendar shares the catalogue snapshot without using it for registration writes',async()=>{
 const c=ctx();let snapshotReads=0;
 const data=await (await c.getWorkflow()).publicRead();
 const authority=c.getWorkflow;let authorityReads=0;
 c.getWorkflow=async()=>{authorityReads++;return authority();};
 c.getPublicWorkflowData=async()=>{snapshotReads++;return data;};
 const result=await workflowRoutes(req(),null,new URL('http://localhost/api/public/workflow/events'),c);
 assert.equal(result.status,200);assert.equal(snapshotReads,1);
 assert.equal(authorityReads,0);
 assert.equal(JSON.stringify(result).includes('其他学生'),false);
 await workflowRoutes(req('POST',{consent:true}),null,new URL('http://localhost/api/portal/workflow/events/id/register'),c);
 assert.equal(snapshotReads,1);assert.equal(c.writes(),1);assert.equal(authorityReads,1);
});
test('public workflow lists only approved published views without owner or student data',async()=>{const c=ctx(),out=await workflowRoutes(req(),null,new URL('http://localhost/api/public/workflow/events'),c);assert.equal(out.body.events.length,1);assert.equal(out.body.events[0].name,'公开');assert.equal(JSON.stringify(out).includes('private-owner'),false);(await (await c.getWorkflow()).read()).events[1]['容量']='9';assert.equal((await workflowRoutes(req(),null,new URL('http://localhost/api/public/workflow/events'),c)).body.events.length,0);});
test('student view filters to own account and omits internal ids/evidence',async()=>{const out=await workflowRoutes(req(),null,new URL('http://localhost/api/portal/workflow/me'),ctx());assert.equal(out.body.participant.studentId,'999990001');assert.equal(out.body.participant.department,'合成院系');assert.equal(out.body.participant.grade,'2023级');assert.equal(out.body.registrations.length,1);assert.equal(out.body.registrations[0].eventId,'public');assert.equal(out.body.ledger.length,1);assert.equal(out.body.profile.serviceHours,2);assert.equal(JSON.stringify(out).includes('其他学生'),false);assert.equal(JSON.stringify(out).includes('private-source'),false);assert.equal(JSON.stringify(out).includes('internal'),false);});
test('console denied, CSRF denial and cross-origin never write',async()=>{const c=ctx();assert.equal(await workflowRoutes(req('POST'),null,new URL('http://localhost/api/volunteer/workflow/events'),c),undefined);c.requireCsrf=()=>false;await workflowRoutes(req('POST'),null,new URL('http://localhost/api/portal/workflow/events/id/register'),c);c.requireCsrf=()=>true;const cross=req('POST');cross.headers.origin='https://other.test';assert.equal((await workflowRoutes(cross,null,new URL('http://localhost/api/portal/workflow/events/id/register'),c)).status,403);assert.equal(c.writes(),0);});
test('identity overrides rejected; registration receives verified account only',async()=>{const c=ctx();let out=await workflowRoutes(req('POST',{studentId:'other'}),null,new URL('http://localhost/api/portal/workflow/events/id/register'),c);assert.equal(out.status,400);assert.equal(c.writes(),0);out=await workflowRoutes(req('POST',{consent:true}),null,new URL('http://localhost/api/portal/workflow/events/id/register'),c);assert.equal(out.status,201);assert.equal(c.writes(),1);});
test('position identities are protected by events permission before reading the roster',async()=>{
 const c=ctx();let reads=0;
 c.getWorkflow=async()=>{reads++;return{positions:async()=>[{position:1,status:'成功',profile:{姓名:'志愿者'}}]};};
 const url=new URL('http://localhost/api/volunteer/workflow/events/shift/positions');
 c.requireConsoleAccess=(_req,_res,scope)=>{assert.equal(scope,'events');return null;};
 assert.equal(await workflowRoutes(req(),null,url,c),undefined);assert.equal(reads,0);
 for(const role of ['platform_admin','super_admin']){
  c.requireConsoleAccess=(_req,_res,scope)=>{assert.equal(scope,'events');return{role};};
  const out=await workflowRoutes(req(),null,url,c);assert.equal(out.status,200);assert.equal(out.body.positions[0].profile.姓名,'志愿者');
 }
});

test('registration requires explicit notice acknowledgment and profile campus; campus cannot be overridden',async()=>{
 const c=ctx(),url=new URL('http://localhost/api/portal/workflow/events/id/register');
 for(const body of [{},{consent:false},{consent:'true'},{consent:true,campus:'仙林'}])assert.equal((await workflowRoutes(req('POST',body),null,url,c)).status,400);
 c.getAccount=async()=>({accountId:'own',campus:''});
 assert.equal((await workflowRoutes(req('POST',{consent:true}),null,url,c)).status,400);
 assert.equal(c.writes(),0);
});

test('source registration route accepts explicit session scope and audits the authenticated actor',async()=>{
 const c=ctx(),calls=[];c.readJson=async request=>request.body;c.requireConsoleAccess=()=>({role:'super_admin'});c.actor=()=> 'trusted-source-manager';
 c.getWorkflow=async()=>({setSourceRegistration:async(id,body)=>{calls.push([id,body]);return {scope:body.scope||'project',enabled:body.enabled,revision:1};}});
 const url=new URL('http://localhost/api/volunteer/workflow/events/source-id/source-registration');
 for(const body of [null,[],{enabled:false,revision:0,actor:'forged'}])assert.equal((await workflowRoutes(req('POST',body),null,url,c)).status,400);
 assert.equal(calls.length,0);
 const out=await workflowRoutes(req('POST',{enabled:false,revision:0,scope:'event'}),null,url,c);assert.equal(out.status,200);
 assert.deepEqual(calls,[['source-id',{enabled:false,revision:0,scope:'event',actor:'trusted-source-manager'}]]);
 c.requireCsrf=()=>false;await workflowRoutes(req('POST',{enabled:true,revision:1,scope:'event'}),null,url,c);assert.equal(calls.length,1);
});
test('source registration route forwards an explicit selection and still rejects unknown fields',async()=>{
 const c=ctx(),calls=[];c.readJson=async request=>request.body;c.requireConsoleAccess=()=>({role:'super_admin'});c.actor=()=>'trusted-source-manager';
 c.getWorkflow=async()=>({setSourceRegistration:async(id,body)=>{calls.push([id,body]);return {scope:body.scope,enabled:body.enabled,revision:2};}});
 const url=new URL('http://localhost/api/volunteer/workflow/events/source-id/source-registration');
 for(const body of [{enabled:false,revision:0,scope:'selection',ids:'shift-a'},{enabled:false,revision:0,scope:'selection',ids:[]},{enabled:false,revision:0,scope:'selection',ids:['shift-a',7]},{enabled:false,revision:0,scope:'event',ids:['shift-a']}])assert.equal((await workflowRoutes(req('POST',body),null,url,c)).status,400);
 assert.equal(calls.length,0);
 const out=await workflowRoutes(req('POST',{enabled:false,revision:0,scope:'selection',ids:['shift-a','shift-b']}),null,url,c);
 assert.equal(out.status,200);
 assert.deepEqual(calls,[['source-id',{enabled:false,revision:0,scope:'selection',actor:'trusted-source-manager',ids:['shift-a','shift-b']}]]);
});

test('contact routes use trusted session identity, require CSRF, and reject cross-origin writes before saving',async()=>{
 const c=ctx(),calls=[];c.requireConsoleAccess=()=>({role:'platform_admin'});c.actor=()=> 'trusted-owner';c.getWorkflow=async()=>({registrationContact:async(...args)=>{calls.push(['read',...args]);return {canEdit:true,contact:{},token:'current'};},saveRegistrationContact:async(...args)=>{calls.push(['save',...args]);return {saved:true};}});
 const url=new URL('http://localhost/api/volunteer/workflow/events/event-id/registration-contact');assert.equal((await workflowRoutes(req(),null,url,c)).status,200);assert.deepEqual(calls[0],['read','event-id','trusted-owner',false]);c.requireCsrf=()=>false;await workflowRoutes(req('PATCH',{token:'current'}),null,url,c);assert.equal(calls.length,1);c.requireCsrf=()=>true;const cross=req('PATCH',{});cross.headers.origin='https://other.test';assert.equal((await workflowRoutes(cross,null,url,c)).status,403);assert.equal(calls.length,1);await workflowRoutes(req('PATCH',{token:'current',qqGroup:'123456789',invitation:'',notes:''}),null,url,c);assert.equal(calls[1][3],'trusted-owner');assert.equal(calls[1][4],false);
});
test('automatic leave response wakes the existing idempotent decision mail queue after commit',async()=>{
 const c=ctx(),items=[];c.getWorkflow=async()=>({ownRegistration:async()=>({_id:'registration-row'}),requestLeave:async(code,account,reason)=>{assert.equal(code,'mine');assert.equal(account.accountId,'own');assert.equal(reason,'课程冲突');return {autoApproved:true,id:'registration-row',notificationDecision:{requestAt:'2030-10-23T00:00:00Z',approved:true,reason:'自动准假'}};}});c.notifyRegistrationDecisions=next=>{items.push(...next);return true;};const result=await workflowRoutes(req('POST',{reason:'课程冲突'}),null,new URL('http://localhost/api/portal/workflow/registrations/mine/leave'),c);assert.equal(result.status,200);assert.equal(result.body.result.autoApproved,true);assert.equal(items[0].id,'registration-row');assert.equal(items[0].kind,'leave');assert.equal(items[0].approved,true);
});


test('single-row reviewed rejection publishes immediately and wakes the mail queue only after commit',async()=>{
 const c=ctx(),calls=[];let committed=false,wakes=0;
 c.requireConsoleAccess=()=>({role:'super_admin'});c.actor=()=> 'trusted-chair';
 const event={_id:'e',活动ID:'E',状态:'报名中',报名页配置:JSON.stringify({rosterReview:{phase:'draft'}})},row={_id:'r',活动ID:'E',报名状态:'待筛选'};
 c.getWorkflow=async()=>({read:async()=>({events:[event],registrations:[row]}),stageRoster:async(...args)=>{calls.push(args);committed=true;return {completed:['r']};}});
 c.queueRegistrationNotifications=()=>{assert.equal(committed,true);wakes++;};
 const out=await workflowRoutes(req('POST',{token:'t',reason:'合成拒绝原因'}),null,new URL('http://localhost/api/volunteer/workflow/registrations/r/reject'),c);
 assert.equal(out.status,200);assert.equal(calls[0][2],'reject');assert.equal(calls[0][5].immediate,true);assert.equal(wakes,1);assert.equal(out.body.result.mailPending,true);
});
