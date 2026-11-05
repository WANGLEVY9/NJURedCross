import {createWorkspaceDraftAuthorization} from '../lib/events/workspace-draft-access.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {openWorkspaceDraftStore} from '../lib/events/workspace-draft-store.js';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';
import {createWorkspaceSubmissions} from '../lib/events/workspace-submissions.js';
import {createMutationQueue} from '../lib/events/safety.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const content={qqGroup:'123456789',name:'合成转换活动',region:'suzhou',category:'生命中心',bookingMode:'unified',date:'2030-01-01',endDate:'2030-01-02',start:'09:15',end:'11:45',deadline:'2029-12-31T18:00',location:'合成地点',capacity:'2',serviceHours:'2',trainingHours:'0',travelHours:'0',work:'合成工作',notice:'手工合成通知'};
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


for(const actor of ['responsible','chair','global'])test(`${actor} reconciles another submitter's successful handoff without another activity write`,async t=>{
 const store=openWorkspaceDraftStore(':memory:');t.after(()=>store.close());const claim={actor:'owner',status:'pending',activityId:'WS-recovery',token:'original-token',digest:'original-digest',draftVersion:1};
 store.append({id:'recovery',ownerId:'owner',requestId:'synthetic-recovery',version:2,stage:'草稿',content:{...content,responsibleId:'responsible'},submission:claim});
 const roster={complete:true,rows:[{accountId:'responsible',region:'suzhou',role:'director',active:true,categories:['生命中心']},{accountId:'chair',region:'suzhou',role:'presidium',active:true,categories:[]},{accountId:'global',region:'nanjing',role:'global',active:true,categories:[]}]};
 const service=createWorkspaceSubmissions({...store,queue:createMutationQueue(),drafts:{submission:()=>assert.fail('must not create a second plan')},authorize:createWorkspaceDraftAuthorization({actor,getRoster:async()=>roster}),prepare:()=>assert.fail('no prepare'),apply:()=>assert.fail('no write'),inspect:async saved=>{assert.equal(saved.actor,'owner');return {activityId:claim.activityId,token:claim.token,digest:claim.digest};}});
 const result=await service.reconcile('recovery',actor);assert.equal(result.stage,'待审批');assert.equal(result.activityId,'WS-recovery');assert.equal(store.readById('recovery')[0].submission.actor,'owner');assert.deepEqual(await service.reconcile('recovery',actor),result);
});

test('dedicated reconciliation preserves uncertain and mismatched receipts without replaying apply',async t=>{
 const f=await fixture(t);f.setMode('before');await assert.rejects(f.make().submit(f.row.id,f.body,'owner'));
 await assert.rejects(f.make().reconcile(f.row.id,'owner'),{code:'workspace_submission_uncertain'});assert.equal(f.writes(),1);assert.equal(f.store.readById(f.row.id)[0].submission.status,'pending');
 await assert.rejects(f.make({inspect:async claim=>({activityId:claim.activityId,token:'foreign',digest:claim.digest})}).reconcile(f.row.id,'owner'),{code:'workspace_submission_uncertain'});assert.equal(f.writes(),1);
});


test('explicit restoration archives the failed claim preserves content and requires a fresh preview before resubmission',async t=>{
 const f=await fixture(t);f.setMode('before');await assert.rejects(f.make().submit(f.row.id,f.body,'owner'));const previous=structuredClone(f.store.readById(f.row.id)[0]);
 const result=await f.make().restore(f.row.id,{expectedVersion:2},'owner');assert.equal(result.restored,true);assert.equal(result.version,3);const restored=f.store.readById(f.row.id)[0];
 assert.deepEqual(restored.content,previous.content);assert.equal(restored.submission,null);assert.equal(restored.preview,null);assert.equal(restored.submissionHistory[0].token,previous.submission.token);assert.equal(restored.submissionHistory[0].status,'cancelled');assert.equal(f.writes(),1);
 assert.deepEqual(await f.make().restore(f.row.id,{expectedVersion:2},'owner'),result);assert.equal(f.store.readById(f.row.id)[0].submissionHistory.length,1);
 await assert.rejects(f.make().submit(f.row.id,f.body,'owner'),{statusCode:409});
 await f.drafts.save(f.row.id,{expectedVersion:3,content:{...content,name:'恢复后的原活动'}},'owner');const preview=await f.drafts.preview(f.row.id,{expectedVersion:4},'owner');await f.drafts.confirmPreview(f.row.id,{expectedVersion:4,digest:preview.digest},'owner');f.setMode('success');
 const submitted=await f.make().submit(f.row.id,{expectedVersion:4,digest:preview.digest},'owner');assert.equal(submitted.activityId,previous.submission.activityId);assert.equal(f.business.size,1);assert.notEqual(f.store.readById(f.row.id)[0].submission.token,previous.submission.token);
});

test('restoration opens an already generated activity without clearing its original claim',async t=>{
 const f=await fixture(t);f.setMode('after');await assert.rejects(f.make().submit(f.row.id,f.body,'owner'));const result=await f.make().restore(f.row.id,{expectedVersion:2},'owner');assert.equal(result.restored,false);assert.equal(result.stage,'待审批');assert.equal(f.store.readById(f.row.id)[0].submission.status,'complete');assert.equal(f.writes(),1);
});

test('restoration leaves original state intact on failed reads mismatched receipts stale versions and revoked authority',async t=>{
 const f=await fixture(t);f.setMode('before');await assert.rejects(f.make().submit(f.row.id,f.body,'owner'));const snapshot=structuredClone(f.store.readById(f.row.id)[0]);
 for(const inspect of [async()=>{throw Error('unavailable');},async claim=>({activityId:claim.activityId,token:'foreign',digest:claim.digest})]){await assert.rejects(f.make({inspect}).restore(f.row.id,{expectedVersion:2},'owner'));assert.deepEqual(f.store.readById(f.row.id)[0],snapshot);}
 await assert.rejects(f.make().restore(f.row.id,{expectedVersion:1},'owner'),{statusCode:409});f.setAllowed(false);await assert.rejects(f.make().restore(f.row.id,{expectedVersion:2},'owner'),{statusCode:403});assert.deepEqual(f.store.readById(f.row.id)[0],snapshot);
});

test('a concurrent state update wins CAS and cannot be cleared by restoration',async t=>{
 const f=await fixture(t);f.setMode('before');await assert.rejects(f.make().submit(f.row.id,f.body,'owner'));
 const service=f.make({inspect:async()=>{const row=f.store.readById(f.row.id)[0];f.store.update(row.id,{version:row.version+1,submission:{...row.submission,token:'newer-token'}},row.version);return null;}});
 await assert.rejects(service.restore(f.row.id,{expectedVersion:2},'owner'),{statusCode:409});assert.equal(f.store.readById(f.row.id)[0].submission.token,'newer-token');
});

test('an earlier remote activity that appears after restoration blocks a second create',async t=>{
 const f=await fixture(t);f.setMode('before');await assert.rejects(f.make().submit(f.row.id,f.body,'owner'));const claim=f.store.readById(f.row.id)[0].submission;await f.make().restore(f.row.id,{expectedVersion:2},'owner');
 f.business.set(claim.activityId,{activityId:claim.activityId,token:claim.token,digest:claim.digest});const preview=await f.drafts.preview(f.row.id,{expectedVersion:3},'owner');await f.drafts.confirmPreview(f.row.id,{expectedVersion:3,digest:preview.digest},'owner');await assert.rejects(f.make().submit(f.row.id,{expectedVersion:3,digest:preview.digest},'owner'),/正式活动已出现/);assert.equal(f.writes(),1);
});

test('restore waits for the current apply task and opens its successful activity',async t=>{
 const f=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers();let inspections=0;
 const service=f.make({apply:async claim=>{entered.resolve();await release.promise;const result={activityId:claim.activityId,token:claim.token,digest:claim.digest};f.business.set(claim.activityId,result);return result;},inspect:async claim=>{inspections++;return f.business.get(claim.activityId);}});
 const submitting=service.submit(f.row.id,f.body,'owner');await entered.promise;const restoring=service.restore(f.row.id,{expectedVersion:2},'owner');assert.equal(inspections,0);release.resolve();await submitting;const result=await restoring;assert.equal(result.restored,false);assert.equal(result.stage,'待审批');assert.equal(f.store.readById(f.row.id)[0].submission.status,'complete');
});
