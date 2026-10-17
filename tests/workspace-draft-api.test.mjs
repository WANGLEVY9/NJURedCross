import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowRoutes} from '../lib/events/workflow-api.js';
import {openWorkspaceDraftStore} from '../lib/events/workspace-draft-store.js';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';
const root='/api/volunteer/workflow/workspace-drafts';
function fixture(){
 const store=openWorkspaceDraftStore(':memory:');let tail=Promise.resolve();const audit=[];
 const service=createWorkspaceDrafts({...store,queue:fn=>{const p=tail.then(fn);tail=p.catch(()=>{});return p;},authorize:async(row,actor)=>{if(row.ownerId!==actor)throw Object.assign(Error('forbidden'),{statusCode:403});}});
 async function call(method,path=root,body,options={}){
  let response;const session={username:options.actor||'owner',role:'platform_admin'};
  const ctx={requireConsoleAccess:()=>options.signedOut?null:session,requireCsrf:()=>{if(options.noCsrf){response={status:403};return false;}return true;},readJson:async()=>body,actor:s=>s.username,json:(_res,status,data)=>{response={status,...data};},audit:async(_r,_s,action)=>audit.push(action),getWorkspaceDrafts:async()=>service};
  if(options.disabled)delete ctx.getWorkspaceDrafts;
  try{await workflowRoutes({method,headers:{host:'local.test',...(options.origin?{origin:options.origin}:{})}},{},new URL(path,'http://local.test'),ctx);}catch(error){response={status:error.statusCode||500};}
  return response;
 }
 return {store,call,audit};
}
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
