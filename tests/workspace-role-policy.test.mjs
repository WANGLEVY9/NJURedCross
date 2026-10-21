import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileWorkspaceRoleAssignments,withWorkspaceSuperAdmins} from '../lib/events/workspace-role-policy.js';
import {createWorkspaceRoleStore} from '../lib/events/workspace-role-store.js';
import {readWorkspaceRoster} from '../lib/events/workspace-providers.js';
import {workspaceResponsibleOptions} from '../lib/events/workspace-responsible.js';
import {createWorkspaceDraftAuthorization,workspaceDraftAccess} from '../lib/events/workspace-draft-access.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {organizationAuthority} from '../lib/events/organization-authority.js';
import {createWorkflow,WF,workflowApprovalHash,workflowEventApproved} from '../lib/events/workflow.js';

const account=(accountId,role='platform_admin')=>({accountId,role,status:'启用',realName:`合成人员-${accountId}`,emailVerified:true,email:`${accountId}@example.test`,studentId:'999990001'});
const accounts=[account('super','super_admin'),account('initial'),account('life-final'),account('other-final'),account('sz')];
const assignments=[{accountId:'initial',roles:['R03']},{accountId:'life-final',roles:['R05'],finalCategories:['生命中心']},{accountId:'other-final',roles:['R05'],finalCategories:['博爱中心']},{accountId:'sz',roles:['R04','R06']}];
const roster=()=>withWorkspaceSuperAdmins({complete:true,policy:'two-stage',rows:compileWorkspaceRoleAssignments(assignments,accounts)},accounts);

test('role codes enforce region and final category scope without authorizing unrelated roles',async()=>{
 const data=roster(),routing=createWorkspaceApprovalRouting({getRoster:async()=>data});
 const event={状态:'待审核',申请版本:1,活动地区:'南京地区',组织类别:'生命中心',报名页配置:JSON.stringify({region:'南京活动',center:'生命中心'})};
 const binding=await routing.assign(event),bound={...event,报名页配置:JSON.stringify({...JSON.parse(event['报名页配置']),approval:binding})};
 assert.deepEqual(binding.levels.initial.ids,['initial','super']);assert.deepEqual(binding.levels.final.ids,['life-final','super']);
 await assert.rejects(routing.assertReviewer(bound,'life-final'),{statusCode:403});await assert.rejects(routing.assertReviewer(bound,'sz'),{statusCode:403});
 assert.equal((await routing.assertReviewer(bound,'initial')).approvalLevel,'initial');
 const dualRoster={complete:true,policy:'two-stage',rows:compileWorkspaceRoleAssignments([{accountId:'initial',roles:['R03','R05'],finalCategories:['生命中心']}],accounts)};
 const dual=createWorkspaceApprovalRouting({getRoster:async()=>dualRoster}),dualBinding=await dual.assign(event);
 await assert.rejects(dual.assertReviewer({...event,报名页配置:JSON.stringify({region:'南京活动',center:'生命中心',approval:{...dualBinding,initialReview:{actor:'initial'}}})},'initial'),{statusCode:403});
 assert.throws(()=>compileWorkspaceRoleAssignments([{accountId:'initial',roles:['R11']}],accounts,{validateAccounts:true}),/已核验/);
 const revoked=compileWorkspaceRoleAssignments(assignments,accounts.map(row=>row.accountId==='initial'?{...row,role:'member'}:row));
 assert.equal(revoked.find(row=>row.accountId==='initial').active,false);assert.equal(revoked.find(row=>row.accountId==='life-final').active,true);
 assert.throws(()=>compileWorkspaceRoleAssignments([{accountId:'initial',roles:['R10']}],accounts),/角色/);
 assert.throws(()=>compileWorkspaceRoleAssignments([{accountId:'life-final',roles:['R05']}],accounts),/分管/);
});

test('fresh verified super-admin can choose itself and submit without a private regional file',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'workspace-roles-'));
 try{
  const data=await readWorkspaceRoster(join(dir,'missing.json'),accounts),content={name:'合成校外活动',region:'suzhou',category:'生命中心',responsibleId:'super'},row={ownerId:'super',stage:'草稿',content};
  assert.equal(data.complete,true);assert.deepEqual(workspaceResponsibleOptions('super','suzhou','生命中心',data),[{id:'super',name:'合成人员-super'}]);
  assert.equal(workspaceDraftAccess(row,'super',data).canEdit,true);
  assert.equal(workspaceDraftAccess({ownerId:'other',stage:'草稿',content:{name:'合成未分类草稿'}},'super',data).canEdit,true);
  await createWorkspaceDraftAuthorization({actor:'super',getRoster:async()=>data})(row,'super','submit');
  const inactive=withWorkspaceSuperAdmins({complete:false,rows:[]},accounts.map(row=>({...row,status:'停用'})));
  assert.equal(inactive.complete,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('role settings reject ordinary actors, stale versions and spoofed identity fields',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'workspace-role-store-')),path=join(dir,'roles.json');let snapshot=accounts;
 try{
  const store=createWorkspaceRoleStore(path,async()=>snapshot);
  await assert.rejects(store.settings('initial'),{statusCode:403});
  await assert.rejects(store.save('initial',{version:0,assignments}),{statusCode:403});
  assert.equal((await store.settings('super')).version,0);
  await store.save('super',{version:0,assignments});
  await assert.rejects(store.save('super',{version:0,assignments}),{statusCode:409});
  await assert.rejects(store.save('super',{version:1,assignments:[{accountId:'initial',roles:['R03'],name:'super'}]}),{statusCode:400});
  assert.equal((await readWorkspaceRoster(path,accounts)).policy,'two-stage');
  assert.equal(JSON.parse(await readFile(path,'utf8')).version,1);
  snapshot=accounts.map(row=>row.accountId==='super'?{...row,role:'platform_admin'}:row);
  await assert.rejects(store.save('super',{version:1,assignments}),{statusCode:403});
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('new two-level workflow cannot publish after initial review and rechecks terminal authority',async()=>{
 let data=roster();const routing=createWorkspaceApprovalRouting({getRoster:async()=>data});
 const tables=Object.fromEntries(Object.values(WF).map(name=>[name,[]]));let seq=0;
 const base={getMetadata:async()=>({tables:Object.keys(tables).map(name=>({name}))}),listRows:async(table,_v,_o,_c,start=0,count=500)=>structuredClone(tables[table].slice(start,start+count)),appendRow:async(table,row)=>{const saved={...row,_id:`synthetic-role-${++seq}`};tables[table].push(saved);return {_id:saved._id};},updateRow:async(table,id,patch)=>Object.assign(tables[table].find(row=>row._id===id),patch)};
 const workflow=createWorkflow(base,{approvalRouting:routing});
 const event=await workflow.create({name:'合成分级审批',region:'南京活动',center:'生命中心',date:'2030-10-15',slot:'09:15-11:45',window:{start:'2030-10-15T09:15',end:'2030-10-15T11:45'},capacity:4,serviceHours:2.5,trainingHours:0,travelHours:0,location:'校外社区',work:'合成工作'},'applicant');
 const current=()=>tables[WF.events].find(row=>row._id===event._id);
 await assert.rejects(workflow.approve(event._id,'life-final','platform_admin'),{statusCode:403});
 await workflow.approve(event._id,'initial','platform_admin');assert.equal(current()['状态'],'待审核');assert.equal(workflowEventApproved(current()),false);
 assert.equal(JSON.parse(current()['报名页配置']).approval.initialReview.actor,'initial');
 await assert.rejects(workflow.publish(event._id,{actor:'life-final'}));
 await assert.rejects(workflow.approve(event._id,'initial','platform_admin'),{statusCode:403});
 await assert.rejects(workflow.approve(event._id,'other-final','platform_admin'),{statusCode:403});
 const snapshot=structuredClone(current());data={...data,rows:data.rows.map(row=>row.accountId==='life-final'?{...row,active:false}:row)};
 await assert.rejects(workflow.approve(event._id,'life-final','platform_admin'),{statusCode:403});assert.deepEqual(current(),snapshot);
 data=roster();await workflow.approve(event._id,'life-final','platform_admin',workflowApprovalHash(current()));
 assert.equal(current()['状态'],'可发布');assert.equal(workflowEventApproved(current()),true);
 await assert.rejects(workflow.publish(event._id,{actor:'other-final'}),{statusCode:403});
 await workflow.publish(event._id,{actor:'life-final'});assert.equal(current()['状态'],'报名中');
});

test('outer API authority uses the same region-bound role evidence as workspace operations',async()=>{
 const events=[{_id:'nj',活动ID:'nj',组织类别:'生命中心',活动地区:'南京地区',负责人账号ID:'owner'},{_id:'sz',活动ID:'sz',组织类别:'生命中心',活动地区:'苏州地区',负责人账号ID:'owner'}];
 const authority=await organizationAuthority(accounts[2],{query:async()=>{throw Error('must use verified regional bindings');}},events,{workspaceRoster:roster()});
 assert.equal(authority.canEnter,true);authority.assertEvent('nj');assert.throws(()=>authority.assertEvent('sz'),{statusCode:403});
 authority.assertCreate({center:'生命中心',region:'nanjing'});assert.throws(()=>authority.assertCreate({center:'生命中心',region:'suzhou'}),{statusCode:403});
 assert.throws(()=>authority.assertCreate({center:'博爱中心',region:'nanjing'}),{statusCode:403});
 const revoked=await organizationAuthority({...accounts[2],organization:{verified:true,global:true,categories:['生命中心']}},{query:async()=>{throw Error('must not restore old department authority');}},events,{workspaceRoster:{complete:true,policy:'two-stage',rows:[]}});
 assert.equal(revoked.canEnter,false);assert.throws(()=>revoked.assertEvent('nj'),{statusCode:403});
});
