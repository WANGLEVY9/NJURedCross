import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApprovalRouting,approvalRoutingRoutes} from '../lib/events/approval-routing.js';
import {createApprovalRoutingStore} from '../lib/events/approval-routing-store.js';

test('organization defaults require actual presidium membership and persist multiple reviewers per category',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nju-approval-defaults-'));
 try{
  const accounts=['chair','guide','director','super'].map(id=>({accountId:id,role:id==='super'?'super_admin':'member',emailVerified:true,realName:`合成${id}`,organization:{verified:true,reviewer:['chair','guide'].includes(id),global:['chair','guide'].includes(id)}}));
  const path=join(dir,'defaults.json'),store=createApprovalRoutingStore(path),routing=createApprovalRouting({store,getAccounts:async()=>accounts,organizationMode:true});
  assert.equal(await routing.canConfigure('chair'),true);assert.equal(await routing.canConfigure('guide'),true);
  for(const actor of ['director','super','missing']){
   assert.equal(await routing.canConfigure(actor),false);
   await assert.rejects(routing.save({version:0,mappings:{}},actor),{statusCode:403});
  }
  for(const ids of [['chair','chair'],['super'],['director'],['missing']])await assert.rejects(routing.save({version:0,mappings:{生命中心:ids}},'chair'),{statusCode:400});
  await routing.save({version:0,mappings:{生命中心:['chair','guide'],博爱中心:['guide']}},'chair');
  assert.deepEqual((await createApprovalRoutingStore(path).read()).mappings['生命中心'],['chair','guide']);
  const event={组织类别:'生命中心',报名页配置:'{}'},assigned=await routing.assign(event);
  assert.deepEqual(assigned.reviewerIds,['chair','guide']);assert.equal(assigned.policy,'any');
  await routing.save({version:1,mappings:{生命中心:['guide']}},'guide');
  assert.deepEqual(assigned.reviewerIds,['chair','guide']);assert.deepEqual((await routing.assign(event)).reviewerIds,['guide']);
  await assert.rejects(routing.save({version:1,mappings:{}},'chair'),{statusCode:409});
  await assert.rejects(routing.assign({...event,报名页配置:JSON.stringify({reviewerIds:[]})}),{statusCode:400});
  accounts[1].status='停用';await assert.rejects(routing.assign(event),{statusCode:400});
  let writes=0;
  const ctx={approvalRouting:routing,actor:s=>s.accountId,readJson:async()=>{writes++;return {};},json:(_r,status,payload)=>({status,payload})};
  await assert.rejects(approvalRoutingRoutes({method:'PUT'},{},new URL('https://fixture.invalid/api/volunteer/workflow/approval-routing'),ctx,{accountId:'super',role:'super_admin'}),{statusCode:403});assert.equal(writes,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
