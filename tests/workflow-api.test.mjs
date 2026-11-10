import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workflowApprovalHash} from '../lib/events/workflow.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';
function ctx(){const events=[{_id:'draft',活动ID:'D',活动名称:'草稿',状态:'待审核',申请版本:'1',批准版本:''},{_id:'public',活动ID:'P',活动名称:'公开',状态:'报名中',申请版本:'1',批准版本:'1',负责人账号ID:'private-owner'}];events[1]['批准摘要']=workflowApprovalHash(events[1]);let writes=0;return {json:(_r,status,body)=>({status,body}),getWorkflow:async()=>({async read(){return this.publicRead();},async memberRead(){return this.publicRead();},publicRead:async()=>({events,registrations:[{_id:'private-source',账号ID:'own',活动ID:'P',姓名:'自己',学号:'999990001',报名ID:'mine'},{账号ID:'other',姓名:'其他学生'}],ledger:[{账号ID:'own',来源摘要:'internal',服务时长:'2'},{账号ID:'other',姓名:'其他学生'}],profiles:[{账号ID:'own',志愿时长:'2'}]}),register:async()=>{writes++;return{};}}),requireConsoleAccess:()=>null,requirePortalSession:()=>({username:'own'}),requireCsrf:()=>true,readJson:async req=>req.body||{},getAccount:async()=>({accountId:'own',realName:'合成同学',email:'999990001@smail.nju.edu.cn',emailVerified:true,campus:'鼓楼',studentId:'999990001',department:'合成院系',qq:'123456789',wechat:'synthetic_wechat',gender:'女',certificate:'否',phone:'13800000000',grade:'2023级'}),actor:()=>'',audit:async()=>{},writes:()=>writes};}
const req=(method='GET',body)=>({method,body,headers:{host:'localhost'}});

test('hours synchronization rechecks the active verified super account and rejects identity overrides',async()=>{
 const c=ctx(),calls=[];let role='platform_admin',verified=true,enabled=true;
 c.requireConsoleAccess=()=>({role:'super_admin'});
 c.getAccount=async()=>({role,emailVerified:verified,status:enabled?'启用':'禁用'});
 c.getWorkflow=async()=>({hoursSyncStatus:()=>({receipts:[]}),synchronizeHours:async options=>{calls.push(options);return {};}});
 const url=new URL('http://localhost/api/volunteer/workflow/hours-sync');
 assert.equal((await workflowRoutes(req(),null,url,c)).status,403);assert.equal((await workflowRoutes(req('POST',{profiles:true}),null,url,c)).status,403);
 role='super_admin';assert.equal((await workflowRoutes(req(),null,url,c)).status,200);
 assert.equal((await workflowRoutes(req('POST',{profiles:true,accountId:'foreign'}),null,url,c)).status,400);assert.equal(calls.length,0);
 assert.equal((await workflowRoutes(req('POST',{profiles:true}),null,url,c)).status,200);assert.deepEqual(calls,[{manual:true}]);
 verified=false;assert.equal((await workflowRoutes(req('POST',{}),null,url,c)).status,403);verified=true;enabled=false;assert.equal((await workflowRoutes(req(),null,url,c)).status,403);
 enabled=true;c.requireCsrf=()=>false;await workflowRoutes(req('POST',{}),null,url,c);assert.equal(calls.length,1);
});

test('production hours synchronization can be queued without waiting for all remote rows',async()=>{
 const c=ctx(),queued=[];c.requireConsoleAccess=()=>({role:'super_admin'});c.getAccount=async()=>({role:'super_admin',status:'启用',emailVerified:true});c.queueHoursSync=options=>queued.push(options);
 c.getWorkflow=async()=>({synchronizeHours:()=>{throw Error('must not run in foreground');}});
 const result=await workflowRoutes(req('POST',{profiles:true}),null,new URL('http://localhost/api/volunteer/workflow/hours-sync'),c);assert.deepEqual(result.body.result,{queued:true});assert.deepEqual(queued,[{manual:true}]);
});

for(const kind of ['revision','year-base'])test(`${kind} confirmation requires current super identity, CSRF and explicit reason without actor overrides`,async()=>{
 const c=ctx(),calls=[];let role='platform_admin';c.requireConsoleAccess=()=>({role:'super_admin'});c.actor=()=> 'trusted-super';c.getAccount=async()=>({role,status:'启用',emailVerified:true});
 const method=kind==='revision'?'hoursRevision':'hoursYearBase';c.getWorkflow=async()=>({[method]:async(...args)=>{calls.push(args);return {accepted:true};}});c.queueHoursSync=()=>{};
 const url=new URL(`http://localhost/api/volunteer/workflow/hours-sync/${kind}?key=FINAL:r`);
 assert.equal((await workflowRoutes(req(),null,url,c)).status,403);role='super_admin';assert.equal((await workflowRoutes(req(),null,url,c)).status,200);
 assert.equal((await workflowRoutes(req('POST',{key:'FINAL:r',token:'v',confirmed:true,reason:'核对纸质记录',actor:'forged'}),null,url,c)).status,400);
 const body={key:'FINAL:r',token:'v',confirmed:true,reason:'核对纸质记录',...(kind==='year-base'?{includedHours:0}:{})};
 assert.equal((await workflowRoutes(req('POST',body),null,url,c)).status,200);assert.equal(calls.at(-1)[2],'trusted-super');
 const count=calls.length;c.requireCsrf=()=>false;await workflowRoutes(req('POST',body),null,url,c);assert.equal(calls.length,count);
});

test('relationship integrity API receives only authority-scoped activity rows',async()=>{
 const c=ctx(),visible=[{_id:'visible',活动ID:'V'}];c.requireConsoleAccess=()=>({role:'platform_admin'});
 c.getEventAuthority=async()=>({canEnter:true,events:visible,access:()=>({manage:true})});
 c.getWorkflow=async()=>({relationshipIntegrity:async events=>{assert.deepEqual(events,visible);return {ok:true,checked:{events:1,groups:0},issues:[]};}});
 const result=await workflowRoutes(req(),null,new URL('http://localhost/api/volunteer/workflow/relationship-integrity'),c);
 assert.equal(result.status,200);assert.equal(result.body.result.ok,true);
});

test('automatically confirmed registrations use the existing confirmation notification queue',async()=>{
 const c=ctx(),decisions=[];let status='已确认';
 c.getWorkflow=async()=>({register:async()=>({_id:'synthetic-auto',报名ID:'synthetic-code',报名状态:status})});
 c.notifyRegistrationDecisions=items=>{decisions.push(...items);return true;};
 const call=()=>workflowRoutes(req('POST',{consent:true}),null,new URL('http://localhost/api/portal/workflow/events/event/register'),c);
 assert.equal((await call()).body.result.status,'报名成功');assert.deepEqual(decisions,[{kind:'confirm',id:'synthetic-auto'}]);
 status='待筛选';assert.equal((await call()).body.result.status,'待确认');assert.equal(decisions.length,1);
});

test('admin information rechecks current verified super-admin identity instead of trusting the session role',async()=>{
 const c=ctx();let role='platform_admin',writes=0,verified=true;
 c.requireConsoleAccess=()=>({role:'super_admin'});
 c.getAccount=async()=>({role,emailVerified:verified,status:'启用'});
 c.getWorkflow=async()=>({adminInformation:async()=>{writes++;return {id:'e'};}});
 const call=()=>workflowRoutes(req('PATCH',{token:'t',values:{name:'合成更正'}}),null,new URL('http://localhost/api/volunteer/workflow/events/e/admin-information'),c);
 await assert.rejects(call(),{statusCode:403});assert.equal(writes,0);
 role='super_admin';assert.equal((await call()).status,200);assert.equal(writes,1);
 verified=false;await assert.rejects(call(),{statusCode:403});assert.equal(writes,1);
});

test('hours API uses hours authorization rather than pending-activity approval and rechecks denials',async()=>{
 const c=ctx(),event={_id:'e',状态:'进行中',报名页配置:'{}'};let allowed=true,writes=0;
 c.requireConsoleAccess=()=>({role:'super_admin'});c.actor=()=> 'current-reviewer';
 c.approvalRouting={assertReviewer:async()=>{throw Error('pending activity authorization must not be used');},assertHoursReviewer:async(row,actor)=>{assert.equal(row,event);assert.equal(actor,'current-reviewer');if(!allowed)throw Object.assign(new Error('合成撤销权限'),{statusCode:403});}};
 c.getWorkflow=async()=>({hoursSubmissionStatus:async()=>({event,events:[event],current:{phase:'submitted'}}),returnHoursSheet:async()=>{writes++;return {};}});
 const call=()=>workflowRoutes(req('POST',{revision:1,reason:'合成重核'}),null,new URL('http://localhost/api/volunteer/workflow/events/e/return-hours'),c);
 assert.equal((await call()).status,200);assert.equal(writes,1);
 allowed=false;await assert.rejects(call(),{statusCode:403});assert.equal(writes,1);
});

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
 // 排班看板历史取值 'session' 也必须能通过字段校验并被转发（归一化在 workflow 层）。
 c.requireCsrf=()=>true;
 const sessionOut=await workflowRoutes(req('POST',{enabled:true,revision:'2',scope:'session'}),null,url,c);
 assert.equal(sessionOut.status,200);
 assert.equal(calls.at(-1)[1].scope,'session');
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

test('member hours are account-scoped and independent of activity workflow reads', async () => {
 const account={accountId:'own',realName:'合成同学',studentId:'999990001'};
 const ctx={requirePortalSession:()=>({username:'own'}),getAccount:async()=>account,
  getWorkflow:async()=>{throw new Error('activity workflow unavailable');},
  getVolunteerPlatformHours:async value=>{assert.equal(value.accountId,'own');return {totalHours:12,academicYearHours:3,rank:1};},
  json:(_res,status,body)=>({status,body})};
 const result=await workflowRoutes({method:'GET',headers:{}},null,new URL('http://localhost/api/portal/workflow/hours?accountId=other'),ctx);
 assert.equal(result.status,200);assert.equal(result.body.platformHours.totalHours,12);
 ctx.requirePortalSession=()=>null;
 assert.equal(await workflowRoutes({method:'GET',headers:{}},null,new URL('http://localhost/api/portal/workflow/hours'),ctx),undefined);
});

test('activity posting confirmation requires a current verified super admin',async()=>{
 const c=ctx(),calls=[];
 c.requireConsoleAccess=()=>({role:'super_admin'});
 let role='platform_admin',emailVerified=true;
 c.getAccount=async()=>({role,emailVerified,status:'启用'});
 c.getWorkflow=async()=>({admitHoursPosting:async(...args)=>{calls.push(args);return {posted:1,total:1};}});
 const url=new URL('http://localhost/api/volunteer/workflow/events/project/hours-posting');
 const body={action:'admit',keys:['FINAL:one','FINAL:one'],reason:'核对为新增班次'};
 assert.equal((await workflowRoutes(req('POST',body),null,url,c)).status,403);
 role='super_admin';emailVerified=false;
 assert.equal((await workflowRoutes(req('POST',body),null,url,c)).status,403);
 emailVerified=true;
 assert.equal((await workflowRoutes(req('POST',body),null,url,c)).status,200);
 assert.deepEqual(calls,[['project',['FINAL:one'],'核对为新增班次']]);
});


test('workspace restoration uses trusted actor and enforces CSRF and origin',async()=>{
 const c=ctx(),calls=[];c.requireConsoleAccess=()=>({role:'platform_admin'});c.actor=()=> 'trusted-director';
 c.getWorkflow=async()=>({workspaceRestoration:async(...args)=>{calls.push(['read',...args]);return {canRestore:true};},restoreWorkspace:async(...args)=>{calls.push(['restore',...args]);return {restored:true};}});
 const url=new URL('http://localhost/api/volunteer/workflow/events/e/workspace-restoration'),body={token:'t',requestId:'synthetic-restore-request'};
 assert.equal((await workflowRoutes(req(),null,url,c)).status,200);assert.equal((await workflowRoutes(req('POST',body),null,url,c)).status,200);assert.equal(calls[1][3],'trusted-director');
 c.requireCsrf=()=>false;await workflowRoutes(req('POST',body),null,url,c);assert.equal(calls.length,2);c.requireCsrf=()=>true;
 const cross=req('POST',body);cross.headers.origin='https://other.test';assert.equal((await workflowRoutes(cross,null,url,c)).status,403);assert.equal(calls.length,2);
});
