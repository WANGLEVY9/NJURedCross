import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApprovalRouting,validateApprovalMappings} from '../lib/events/approval-routing.js';
import {createApprovalRoutingStore} from '../lib/events/approval-routing-store.js';
import {createWorkflow,WF,workflowEventApproved} from '../lib/events/workflow.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';

const body={name:'合成主席审核活动',date:'2030-10-15',slot:'09:00-12:00',startTime:'09:00',endTime:'12:00',category:'志愿服务',center:'博爱类',capacity:2,registrationLimit:3,serviceHours:3,location:'合成场地',work:'合成现场服务'};
function fixture(initial={'博爱中心':'chair-a','综事中心':'chair-b'}){
 let seq=0,settings={version:0,mappings:initial};
 const accounts=[{accountId:'chair-a',username:'chair-login-a',realName:'合成博爱主席',role:'platform_admin',permissions:['events']},{accountId:'chair-b',realName:'合成综事主席',role:'platform_admin',permissions:['events']},{accountId:'owner',realName:'合成负责人',role:'platform_admin',permissions:['events']},{accountId:'super',role:'super_admin'},{accountId:'member',role:'member'},{accountId:'inactive',role:'platform_admin',status:'停用',permissions:['events']}];
 const store={read:async()=>structuredClone(settings),update:async(version,build)=>{if(version!==settings.version)throw Object.assign(Error('Conflict'),{statusCode:409});settings={version:version+1,mappings:await build()};return structuredClone(settings);}};
 const routing=createApprovalRouting({store,getAccounts:async()=>accounts});
 const rows=Object.fromEntries(Object.values(WF).map(table=>[table,[]]));
 const base={getMetadata:async()=>({tables:Object.keys(rows).map(name=>({name}))}),listRows:async(t,_v,_o,_c,start=0,count=500)=>structuredClone(rows[t].slice(start,start+count)),appendRow:async(t,row)=>{const saved={...row,_id:`test-${++seq}`};rows[t].push(saved);return {_id:saved._id};},updateRow:async(t,id,patch)=>Object.assign(rows[t].find(r=>r._id===id),patch)};
 const w=createWorkflow(base,{approvalRouting:routing});
 return {accounts,routing,rows,w,event:()=>rows[WF.events].at(-1)};
}

test('missing category mapping permits a draft but rejects submission before any partial write',async()=>{
 const f=fixture({});await assert.rejects(f.w.create(body,'owner'),{statusCode:409});assert.equal(f.rows[WF.events].length,0);
 const draft=await f.w.create({...body,submit:false},'owner'),before=structuredClone(f.rows);
 await assert.rejects(f.w.submit(draft._id),{statusCode:409});assert.deepEqual(f.rows,before);
 await f.routing.save({version:0,mappings:{'博爱中心':'chair-a'}});await f.w.submit(draft._id);
 assert.equal(JSON.parse(f.event()['报名页配置']).approval.reviewerId,'chair-a');
});

test('category aliases resolve to a stable chair ID and unrelated ordinary administrators cannot approve',async()=>{
 const f=fixture(),event=await f.w.create({...body,approval:{reviewerId:'owner'},reviewerId:'owner'},'owner');
 const approval=JSON.parse(event['报名页配置']).approval;assert.equal(approval.category,'博爱中心');assert.equal(approval.reviewerId,'chair-a');
 for(const actor of ['owner','chair-b','chair-login-a'])await assert.rejects(f.w.approve(event._id,actor,'platform_admin'),{statusCode:403});
 const before=structuredClone(f.rows);await f.routing.describe((await f.w.overview()).events,'chair-b','platform_admin');assert.deepEqual(f.rows,before);
 assert.equal((await f.routing.describe((await f.w.overview()).events,'chair-a','platform_admin'))[0].approvalAccess.canReview,true);
 await f.w.approve(event._id,'chair-a','platform_admin');assert.equal(workflowEventApproved(f.event()),true);await f.w.publish(event._id);assert.equal(f.event()['状态'],'报名中');
});

test('every active super administrator has global approval and return rights; one approval completes the task',async()=>{
 const f=fixture();f.accounts.push({accountId:'super-two',realName:'合成全局审核人二',role:'super_admin'});
 const a=await f.w.create(body,'owner'),b=await f.w.create({...body,center:'综事中心'},'owner');
 const described=await f.routing.describe((await f.w.overview()).events,'super','super_admin');assert.equal(described.every(e=>e.approvalAccess.canReview),true);
 await f.w.approve(a._id,'super','super_admin');assert.equal(f.rows[WF.events].find(e=>e._id===a._id)['审批人'],'super');
 await assert.rejects(f.w.approve(a._id,'chair-a','platform_admin'),{statusCode:409});
 await f.w.returnApproval(b._id,'super-two','super_admin','合成全局退回原因');
 const returned=JSON.parse(f.event()['报名页配置']).approvalReturn;assert.equal(returned.reviewerName,'合成全局审核人二');assert.equal(returned.reviewerId,'super-two');
 await f.w.submit(b._id);await f.w.approve(b._id,'super-two','super_admin');
});

test('global approval uses current account roles and fails closed when a super is disabled or demoted',async()=>{
 const f=fixture(),event=await f.w.create(body,'owner');const admin=f.accounts.find(a=>a.accountId==='super');
 admin.status='停用';await assert.rejects(f.w.approve(event._id,'super','super_admin'),{statusCode:403});assert.equal((await f.routing.describe([f.event()],'super','super_admin'))[0].approvalAccess.canReview,false);
 admin.status='启用';admin.role='platform_admin';await assert.rejects(f.w.approve(event._id,'super','super_admin'),{statusCode:403});await assert.rejects(f.w.returnApproval(event._id,'super','super_admin','伪造全局退回'),{statusCode:403});
 assert.equal((await f.routing.describe([f.event()],'super','super_admin'))[0].approvalAccess.canReview,false);
});

test('changing the mapping does not silently transfer pending work; editing category assigns its new chair',async()=>{
 const f=fixture(),event=await f.w.create(body,'owner');
 await f.routing.save({version:0,mappings:{'博爱中心':'chair-b','综事中心':'chair-b'}});
 await f.w.approve(event._id,'chair-a','platform_admin');
 await f.w.edit(event._id,{...body,center:'综事类'},'owner');assert.equal(JSON.parse(f.event()['报名页配置']).approval,undefined);
 await f.w.submit(event._id);assert.equal(JSON.parse(f.event()['报名页配置']).approval.reviewerId,'chair-b');
 await assert.rejects(f.w.approve(event._id,'chair-a','platform_admin'),{statusCode:403});await f.w.approve(event._id,'chair-b','platform_admin');
 await f.w.editNotice(event._id,'合成新版通知','owner');assert.equal(JSON.parse(f.event()['报名页配置']).approval,undefined);await f.w.submit(event._id);await f.w.approve(event._id,'chair-b','platform_admin');
});

test('the assigned chair can return with a reason and the owner can edit and resubmit',async()=>{
 const f=fixture(),event=await f.w.create(body,'owner'),before=structuredClone(f.rows);
 await assert.rejects(f.w.returnApproval(event._id,'chair-b','platform_admin','请补充安排'),{statusCode:403});
 await assert.rejects(f.w.returnApproval(event._id,'chair-a','platform_admin',''),{statusCode:400});assert.deepEqual(f.rows,before);
 await f.w.returnApproval(event._id,'chair-a','platform_admin','请补充活动地点');assert.equal(f.event()['状态'],'草稿');assert.equal(JSON.parse(f.event()['报名页配置']).approvalReturn.reason,'请补充活动地点');
 await assert.rejects(f.w.approve(event._id,'chair-a','platform_admin'),{statusCode:409});
 await f.w.edit(event._id,{...body,location:'合成场地二'},'owner');assert.equal(JSON.parse(f.event()['报名页配置']).approvalReturn.reason,'请补充活动地点');
 await f.w.submit(event._id);assert.equal(JSON.parse(f.event()['报名页配置']).approvalReturn,undefined);await f.w.approve(event._id,'chair-a','platform_admin');
});

test('disabled or revoked chairs cannot submit, approve or return, and self-review remains blocked',async()=>{
 const f=fixture(),event=await f.w.create(body,'owner');f.accounts[0].status='停用';
 await assert.rejects(f.w.approve(event._id,'chair-a','platform_admin'),{statusCode:403});await assert.rejects(f.w.returnApproval(event._id,'chair-a','platform_admin','退回'),{statusCode:403});
 await assert.rejects(f.w.create(body,'owner'),{statusCode:409});f.accounts[0].status='启用';f.accounts[0].permissions=['materials'];await assert.rejects(f.w.create(body,'owner'),{statusCode:409});
 f.accounts[0].permissions=['events'];const own=await f.w.create(body,'chair-a');await assert.rejects(f.w.approve(own._id,'chair-a','platform_admin'),{statusCode:403});
});

test('legacy pending requests require resubmission for ordinary chairs but permit global super review',async()=>{
 const f=fixture(),event=await f.w.create(body,'owner');const config=JSON.parse(f.event()['报名页配置']);delete config.approval;f.event()['报名页配置']=JSON.stringify(config);
 await assert.rejects(f.w.approve(event._id,'chair-a','platform_admin'),{statusCode:409});
 await f.w.edit(event._id,body,'owner');await f.w.submit(event._id);await f.w.approve(event._id,'chair-a','platform_admin');
 const legacy=await f.w.create({...body,name:'合成历史申请'},'owner'),legacyConfig=JSON.parse(f.event()['报名页配置']);delete legacyConfig.approval;f.event()['报名页配置']=JSON.stringify(legacyConfig);
 await f.w.returnApproval(legacy._id,'super','super_admin','合成旧申请退回');assert.equal(JSON.parse(f.event()['报名页配置']).approvalReturn.reviewerName,'super');await f.w.submit(legacy._id);await f.w.approve(legacy._id,'super','super_admin');
});

test('configuration rejects members, inactive accounts, forged fields and stale writes; output is a whitelist',async()=>{
 const f=fixture();f.accounts[0].passwordHash='private-hash';
 for(const id of ['member','inactive','missing'])await assert.rejects(f.routing.save({version:0,mappings:{'博爱中心':id}}),{statusCode:400});
 await assert.rejects(f.routing.save({version:0,mappings:{'博爱中心':'chair-a'},role:'super_admin'}),{statusCode:400});
 assert.throws(()=>validateApprovalMappings({'未知类':'chair-a'}),{statusCode:400});
 await f.routing.save({version:0,mappings:{'博爱中心':'chair-a'}});await assert.rejects(f.routing.save({version:0,mappings:{}}),{statusCode:409});
 const settings=await f.routing.settings();assert.equal(JSON.stringify(settings).includes('private-hash'),false);assert.equal(settings.reviewers.some(a=>['member','inactive'].includes(a.id)),false);
});

test('approval routes require session, CSRF, same origin and super-admin configuration; review enforces assignment',async()=>{
 const f=fixture();let session={role:'platform_admin',username:'owner'},csrf=true,audits=0;
 const ctx={approvalRouting:f.routing,getWorkflow:async()=>f.w,requireConsoleAccess:()=>session,requireCsrf:()=>csrf,actor:s=>s.username,readJson:async req=>req.body||{},json:(_res,status,payload)=>({status,payload}),audit:async()=>{audits++;}};
 const call=(path,method='GET',body={},origin='http://local')=>workflowRoutes({method,body,headers:{host:'local',origin}},null,new URL(`http://local/api/volunteer/workflow/${path}`),ctx);
 assert.equal((await call('approval-routing')).payload.canConfigure,false);await assert.rejects(call('approval-routing','PUT',{version:0,mappings:{}}),{statusCode:403});
 session=null;assert.equal(await call('approval-routing'),undefined);session={role:'super_admin',username:'super'};csrf=false;assert.equal(await call('approval-routing','PUT',{}),undefined);csrf=true;assert.equal((await call('approval-routing','PUT',{},'https://evil.example')).status,403);
 assert.equal((await call('approval-routing','PUT',{version:0,mappings:{'博爱中心':'chair-a'}})).status,200);
 const event=await f.w.create(body,'owner');session={role:'platform_admin',username:'chair-b'};await assert.rejects(call(`events/${event._id}/approve`,'POST',{role:'super_admin',reviewerId:'chair-b'}),{statusCode:403});
 session={role:'platform_admin',username:'chair-a'};assert.equal((await call(`events/${event._id}/return-approval`,'POST',{reason:'合成退回原因'})).status,200);assert.equal(audits,2);
});

test('private mapping store persists through restart, protects concurrent stale saves and fails closed on corruption',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'nju-chair-test-')),path=join(directory,'approvers.json');
 try{
  const store=createApprovalRoutingStore(path);assert.deepEqual(await store.read(),{version:0,mappings:{}});
  const results=await Promise.allSettled([store.update(0,async()=>({'博爱中心':'chair-a'})),store.update(0,async()=>({'综事中心':'chair-b'}))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);
  const restarted=createApprovalRoutingStore(path);assert.equal((await restarted.read()).mappings['博爱中心'],'chair-a');assert.equal(JSON.parse(await readFile(path,'utf8')).version,1);
  await writeFile(path,'not json');await assert.rejects(restarted.read(),{statusCode:503});await assert.rejects(restarted.update(1,async()=>({})),{statusCode:503});
 }finally{await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(directory);}
});
