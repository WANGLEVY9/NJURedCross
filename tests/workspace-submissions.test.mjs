import test from 'node:test';
import assert from 'node:assert/strict';
import {openWorkspaceDraftStore} from '../lib/events/workspace-draft-store.js';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';
import {createWorkspaceSubmissions} from '../lib/events/workspace-submissions.js';
import {createMutationQueue} from '../lib/events/safety.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const content={name:'合成转换活动',region:'suzhou',category:'生命中心',bookingMode:'unified',date:'2030-01-01',endDate:'2030-01-02',start:'09:15',end:'11:45',deadline:'2029-12-31T18:00',location:'合成地点',capacity:'2',serviceHours:'2',trainingHours:'0',travelHours:'0',work:'合成工作',notice:'手工合成通知'};
async function fixture(t,path=':memory:'){
 const store=openWorkspaceDraftStore(path);t.after(()=>store.close());const queue=createMutationQueue();let writes=0,mode='success',allowed=true,prepared=true;
 const business=new Map(),authorize=async(row,actor)=>{if(!allowed||actor!=='owner'||row.ownerId!==actor)throw Object.assign(new Error('forbidden'),{statusCode:403});};
 const unscoped=()=>{throw Error('point operations must not scan every draft');};
 const drafts=createWorkspaceDrafts({...store,read:unscoped,queue,authorize});
 const make=(extra={})=>createWorkspaceSubmissions({...store,read:unscoped,queue,drafts,authorize,prepare:async draft=>{if(!prepared)throw Object.assign(new Error('roster unavailable'),{statusCode:503});return {content:draft.content,responsibleId:'verified-owner'};},
  apply:async claim=>{writes++;if(mode==='before')throw Error('connection lost before write');const result={activityId:claim.activityId,token:claim.token,digest:claim.digest};business.set(claim.activityId,result);if(mode==='after')throw Error('response lost after write');return result;},
  inspect:async claim=>business.get(claim.activityId),...extra});
 const row=await drafts.create({requestId:'synthetic-submit-key',content},'owner');const preview=await drafts.preview(row.id,{expectedVersion:1},'owner');await drafts.confirmPreview(row.id,{expectedVersion:1,digest:preview.digest},'owner');
 return {store,drafts,make,row,body:{expectedVersion:1,digest:preview.digest},business,writes:()=>writes,setMode:value=>{mode=value;},setAllowed:value=>{allowed=value;},setPrepared:value=>{prepared=value;}};
}
test('successful durable handoff freezes the draft and repeats return the same activity without another write',async t=>{
 const f=await fixture(t),service=f.make(),result=await service.submit(f.row.id,f.body,'owner');
 assert.equal(result.stage,'待审批');assert.equal(result.activityId,`WS-${f.row.id}`);assert.equal(result.version,3);
 assert.deepEqual(await service.submit(f.row.id,f.body,'owner'),result);assert.equal(f.writes(),1);
 const saved=await f.drafts.get(f.row.id,'owner');assert.equal(saved.submissionStatus,'complete');assert.equal(saved.content.notice,content.notice);
 assert.equal((await f.drafts.preview(f.row.id,{expectedVersion:3},'owner')).content.name,content.name);
 await assert.rejects(f.drafts.save(f.row.id,{expectedVersion:3,content:{name:'覆盖'}},'owner'),{statusCode:409});
});
test('lost success response is reconciled by a new coordinator using the original durable identity',async t=>{
 const f=await fixture(t);f.setMode('after');await assert.rejects(f.make().submit(f.row.id,f.body,'owner'),{code:'workspace_submission_uncertain'});
 assert.equal(f.store.read()[0].submission.status,'pending');assert.equal(f.writes(),1);
 const result=await f.make().submit(f.row.id,f.body,'owner');assert.equal(result.stage,'待审批');assert.equal(f.writes(),1);assert.equal(f.business.size,1);
});
test('uncertain absent business row never triggers a second create and blocks draft editing',async t=>{
 const f=await fixture(t);f.setMode('before');await assert.rejects(f.make().submit(f.row.id,f.body,'owner'),{code:'workspace_submission_uncertain'});
 for(let i=0;i<3;i++)await assert.rejects(f.make().submit(f.row.id,f.body,'owner'),{code:'workspace_submission_uncertain'});
 assert.equal(f.writes(),1);await assert.rejects(f.drafts.save(f.row.id,{expectedVersion:2,content:{name:'改写待核对活动'}},'owner'),{statusCode:409});
});
test('a stale preview or unavailable responsible roster rejects before the durable handoff',async t=>{
 const f=await fixture(t);f.setPrepared(false);await assert.rejects(f.make().submit(f.row.id,f.body,'owner'),{statusCode:503});assert.equal(f.store.read()[0].submission,undefined);
 f.setPrepared(true);await f.drafts.save(f.row.id,{expectedVersion:1,content:{...content,name:'新版本'}},'owner');
 await assert.rejects(f.make().submit(f.row.id,f.body,'owner'),{statusCode:409});assert.equal(f.writes(),0);
});
test('reconciliation refuses foreign receipt, changed request identity and revoked authority',async t=>{
 const f=await fixture(t);f.setMode('after');await assert.rejects(f.make().submit(f.row.id,f.body,'owner'));
 const forged=f.make({inspect:async claim=>({activityId:claim.activityId,token:'foreign',digest:claim.digest})});
 await assert.rejects(forged.submit(f.row.id,f.body,'owner'),{code:'workspace_submission_uncertain'});
 await assert.rejects(f.make().submit(f.row.id,{...f.body,digest:'changed'},'owner'),{statusCode:409});
 f.setAllowed(false);await assert.rejects(f.make().submit(f.row.id,f.body,'owner'),{statusCode:403});assert.equal(f.writes(),1);
});
test('interleaved save during preflight wins CAS and prevents a stale external write',async t=>{
 const f=await fixture(t);const service=f.make({prepare:async()=>{f.store.update(f.row.id,{version:2,content:{...content,name:'另一个连接保存'}},1);return {content};}});
 await assert.rejects(service.submit(f.row.id,f.body,'owner'),{statusCode:409});assert.equal(f.writes(),0);assert.equal(f.store.read()[0].submission,undefined);
});

test('independent database connections and process queues can claim an activity only once',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'workspace-submit-')),path=join(dir,'private.sqlite');
 // Parent cleanup runs after both connection cleanup hooks.
 try{await t.test('race durable claims',async child=>{
  const f=await fixture(child,path),other=openWorkspaceDraftStore(path);child.after(()=>other.close());
  let arrivals=0;const gate=Promise.withResolvers();
  const prepare=async()=>{if(++arrivals===2)gate.resolve();await gate.promise;return {content,responsibleId:'verified-owner'};};
  const a=f.make({prepare}),b=f.make({...other,queue:createMutationQueue(),prepare});
  const results=await Promise.allSettled([a.submit(f.row.id,f.body,'owner'),b.submit(f.row.id,f.body,'owner')]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.statusCode,409);assert.equal(f.writes(),1);
  const reopened=openWorkspaceDraftStore(path);try{assert.equal(reopened.read()[0].submission.status,'complete');assert.equal(reopened.read()[0].submission.activityId,`WS-${f.row.id}`);}finally{reopened.close();}
 });}finally{rmSync(dir,{recursive:true,force:true});}
});
