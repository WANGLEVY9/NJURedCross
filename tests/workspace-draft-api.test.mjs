import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowRoutes} from '../lib/events/workflow-api.js';
import {openWorkspaceDraftStore} from '../lib/events/workspace-draft-store.js';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';
import {createWorkspaceSubmissions} from '../lib/events/workspace-submissions.js';
const root='/api/volunteer/workflow/workspace-drafts';
function fixture(){
 const store=openWorkspaceDraftStore(':memory:');let tail=Promise.resolve();const audit=[];let profileReads=0,rosterReads=0,draftScans=0;
 const queue=fn=>{const p=tail.then(fn);tail=p.catch(()=>{});return p;},authorize=async(row,actor)=>{if(row.ownerId!==actor)throw Object.assign(Error('forbidden'),{statusCode:403});};
 const service=createWorkspaceDrafts({...store,read:()=>{draftScans++;return store.read();},queue,authorize});let businessWrites=0;const business=new Map();
 const submissions=createWorkspaceSubmissions({...store,queue,drafts:service,authorize,prepare:async row=>({content:row.content,responsibleId:'verified-owner'}),apply:async claim=>{businessWrites++;const result={activityId:claim.activityId,token:claim.token,digest:claim.digest};business.set(claim.activityId,result);return result;},inspect:async claim=>business.get(claim.activityId)});
 async function call(method,path=root,body,options={}){
  let response;const session={username:options.actor||'owner',role:'platform_admin'};
  const ctx={requireConsoleAccess:()=>options.signedOut?null:session,requireCsrf:()=>{if(options.noCsrf){response={status:403};return false;}return true;},readJson:async()=>body,actor:s=>s.username,json:(_res,status,data)=>{response={status,...data};},audit:async(_r,_s,action)=>audit.push(action),getWorkspaceDrafts:async()=>service};
  if(options.disabled)delete ctx.getWorkspaceDrafts;
  if(options.submissions)ctx.getWorkspaceSubmissions=async()=>submissions;
  if(options.directory){ctx.getWorkspaceRoster=async()=>{rosterReads++;return options.directory.roster;};ctx.getWorkspaceProfileData=async()=>{profileReads++;return options.directory.profiles;};}
  try{await workflowRoutes({method,headers:{host:'local.test',...(options.origin?{origin:options.origin}:{})}},{},new URL(path,'http://local.test'),ctx);}catch(error){response={status:error.statusCode||500};}
  return response;
 }
 return {store,call,audit,businessWrites:()=>businessWrites,profileReads:()=>profileReads,rosterReads:()=>rosterReads,draftScans:()=>draftScans};
}

test('scoped project people endpoint reads one roster without scanning drafts or personal archives',async t=>{
 const f=fixture();t.after(()=>f.store.close());const url=root+'/project-people-options?region=nanjing&category='+encodeURIComponent('生命中心');
 const directory={roster:{complete:true,rows:[{accountId:'owner',region:'nanjing',role:'director',active:true,categories:['生命中心'],name:'合成立项人'},{accountId:'chair',region:'nanjing',role:'presidium',active:true,categories:['生命中心'],name:'合成主席'},{accountId:'unrelated',region:'suzhou',role:'presidium',active:true,categories:[],name:'其他地区'}]}};
 assert.equal(await f.call('GET',url,null,{signedOut:true,directory}),undefined);assert.equal(f.rosterReads(),0);
 assert.equal((await f.call('GET',url)).status,503);
 const result=await f.call('GET',url,null,{directory});assert.equal(result.status,200);assert.deepEqual(result.options.defaultReviewerIds,['chair']);
 assert.equal(result.options.self.id,'owner');assert(!JSON.stringify(result.options).includes('unrelated'));assert.deepEqual(result.options.unavailableDefaults,['金中宸','袁金雨']);
 assert.equal(f.rosterReads(),1);assert.equal(f.profileReads(),0);assert.equal(f.draftScans(),0);
 assert.equal((await f.call('GET',url,null,{directory,actor:'foreign'})).status,403);
});

test('soft removal enforces request guards and keeps the durable backup',async()=>{
 const f=fixture();try{
  const created=await f.call('POST',root,{requestId:'synthetic-remove-api',content:{name:'合成删除'}}),id=created.result.id,url=`${root}/${id}/remove`,body={requestId:'synthetic-remove-action',expectedVersion:1};
  assert.equal((await f.call('POST',url,body,{noCsrf:true})).status,403);
  assert.equal((await f.call('POST',url,body,{origin:'https://other.test'})).status,403);
  assert.equal((await f.call('POST',url,body,{actor:'other'})).status,403);
  assert.equal((await f.call('POST',url,{...body,actor:'owner'})).status,400);
  assert.equal((await f.call('POST',url,body)).status,200);assert.equal((await f.call('POST',url,body)).status,200);
  assert.deepEqual((await f.call('GET')).drafts,[]);assert.equal(f.store.read()[0].content.name,'合成删除');
  assert.equal((await f.call('GET',`${root}/${id}`)).status,410);assert.ok(f.audit.includes('workflow.workspace.remove'));
 }finally{f.store.close();}
});
test('authenticated owner can create, list, save and inspect a durable incomplete draft',async()=>{
 const f=fixture();try{const created=await f.call('POST',root,{requestId:'synthetic-api-request',content:{name:'合成'}});assert.equal(created.status,201);const id=created.result.id;
 assert.equal((await f.call('GET')).drafts.length,1);assert.equal((await f.call('GET',`${root}/${id}`)).result.content.name,'合成');
 assert.equal((await f.call('PATCH',`${root}/${id}`,{expectedVersion:1,content:{name:'新名称'}})).result.version,2);
 const p=await f.call('POST',`${root}/${id}/preview`,{expectedVersion:2});assert.equal(p.status,200);assert.ok(p.result.errors.length);assert.deepEqual(f.audit,['workflow.workspace.create','workflow.workspace.save']);
 }finally{f.store.close();}
});
test('cross-owner reads/writes and actor spoofing are denied; list reveals no foreign drafts',async()=>{
 const f=fixture();try{const a=await f.call('POST',root,{requestId:'synthetic-api-request',content:{name:'合成'}});const url=`${root}/${a.result.id}`;
 assert.equal((await f.call('GET',url,null,{actor:'other'})).status,403);assert.deepEqual((await f.call('GET',root,null,{actor:'other'})).drafts,[]);
 assert.equal((await f.call('PATCH',url,{expectedVersion:1,content:{name:'覆盖'}},{actor:'other'})).status,403);
 assert.equal((await f.call('POST',root,{requestId:'synthetic-api-request',content:{name:'合成'},actor:'other'})).status,400);
 }finally{f.store.close();}
});
test('CSRF and trusted-origin guards run before private draft mutations',async()=>{
 const f=fixture();try{const body={requestId:'synthetic-api-request',content:{name:'合成'}};
 assert.equal((await f.call('POST',root,body,{noCsrf:true})).status,403);assert.equal((await f.call('POST',root,body,{origin:'https://other.test'})).status,403);assert.deepEqual(f.store.read(),[]);assert.equal(await f.call('GET',root,null,{signedOut:true}),undefined);
 }finally{f.store.close();}
});
test('disabled workspace returns an explicit unavailable response and exposes no submission endpoint',async()=>{
 const f=fixture();try{assert.equal((await f.call('GET',root,null,{disabled:true})).status,503);assert.equal((await f.call('POST',root+'/id/submit',{})).status,405);}finally{f.store.close();}
});

test('opt-in submission enforces authentication, CSRF, field whitelist, owner and latest saved preview',async()=>{
 const f=fixture();try{
  const content={qqGroup:'123456789',name:'合成提交',region:'suzhou',category:'生命中心',bookingMode:'unified',date:'2030-01-01',endDate:'2030-01-01',start:'09:15',end:'11:45',deadline:'2029-12-31T18:00',location:'合成地点',capacity:'2',serviceHours:'2',trainingHours:'0',travelHours:'0',work:'合成工作',notice:'合成通知'};
  const created=await f.call('POST',root,{requestId:'synthetic-submit-api',content}),url=`${root}/${created.result.id}`;
  const preview=(await f.call('POST',url+'/preview',{expectedVersion:1})).result,body={expectedVersion:1,digest:preview.digest},options={submissions:true};
  assert.equal(await f.call('POST',url+'/submit',body,{...options,signedOut:true}),undefined);
  assert.equal((await f.call('POST',url+'/submit',body,{...options,noCsrf:true})).status,403);
  assert.equal((await f.call('POST',url+'/submit',body,{...options,origin:'https://other.test'})).status,403);
  assert.equal((await f.call('POST',url+'/submit',{...body,responsibleId:'forged'},options)).status,400);
  assert.equal((await f.call('POST',url+'/submit',body,{...options,actor:'other'})).status,403);
  assert.equal((await f.call('POST',url+'/submit',body,options)).status,409);assert.equal(f.businessWrites(),0);
  await f.call('POST',url+'/confirm-preview',body);
  const submitted=await f.call('POST',url+'/submit',body,options);assert.equal(submitted.status,200);assert.equal(submitted.result.stage,'待审批');
  assert.deepEqual((await f.call('POST',url+'/submit',body,options)).result,submitted.result);assert.equal(f.businessWrites(),1);
 }finally{f.store.close();}
});

test('profile reads require regional center scope before retrieving any private archive',async()=>{
 const f=fixture(),scope='?region=nanjing&category='+encodeURIComponent('生命中心');
 const directory={roster:{complete:true,rows:[{accountId:'owner',region:'nanjing',role:'director',active:true,categories:['生命中心'],name:'合成主任'}]},profiles:{complete:true,baseUuid:'synthetic',accounts:[{accountId:'owner',realName:'合成主任',studentId:'999990001',emailVerified:true}],bindings:[{'账号ID':'owner','资料BaseUUID':'synthetic','资料行ID':'p1','资料同步状态':'已同步'}],profiles:[{_id:'p1','姓名':'合成主任','学号':'999990001','院系':'合成院系','手机号':'private'}]}};
 try{
  assert.equal((await f.call('GET',root+'/responsible-options'+scope)).status,503);
  const options=await f.call('GET',root+'/responsible-options'+scope,null,{directory});assert.deepEqual(options.options,[{id:'owner',name:'合成主任'}]);
  assert.equal((await f.call('GET',root+'/responsible-profile'+scope+'&accountId=foreign',null,{directory})).status,403);assert.equal(f.profileReads(),0);
  const response=await f.call('GET',root+'/responsible-profile'+scope+'&accountId=owner',null,{directory});assert.equal(response.status,200);assert.equal(response.profile.department,'合成院系');assert.equal(response.profile.phone,undefined);assert.equal(response.profile.studentId,undefined);assert.equal(f.profileReads(),1);
 }finally{f.store.close();}
});

test('copy endpoint rejects forged content, CSRF and cross-owner access and retries one stable draft',async()=>{
 const f=fixture();try{
  const source=(await f.call('POST',root,{requestId:'synthetic-source-copy-api',content:{name:'合成复制源'}})).result,url=`${root}/${source.id}/copy`,body={requestId:'synthetic-copy-api-request',expectedVersion:1};
  assert.equal((await f.call('POST',url,body,{noCsrf:true})).status,403);assert.equal((await f.call('POST',url,body,{actor:'other'})).status,403);
  assert.equal((await f.call('POST',url,{...body,content:{name:'伪造'}})).status,400);
  const copied=await f.call('POST',url,body);assert.equal(copied.status,201);assert.equal(copied.result.stage,'草稿');assert.notEqual(copied.result.id,source.id);assert.deepEqual((await f.call('POST',url,body)).result,copied.result);assert.equal(f.store.read().length,2);
 }finally{f.store.close();}
});
