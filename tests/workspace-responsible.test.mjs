import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceResponsibleOptions,assertWorkspaceResponsible,workspaceResponsibleProfile} from '../lib/events/workspace-responsible.js';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';
import {openWorkspaceDraftStore} from '../lib/events/workspace-draft-store.js';
import {createMutationQueue} from '../lib/events/safety.js';
const director=(accountId,region,category)=>({accountId,region,role:'director',active:true,categories:[category],name:'同名主任'});
const roster=()=>({complete:true,rows:[director('owner','nanjing','生命中心'),director('second','nanjing','生命中心'),director('love','nanjing','博爱中心'),director('sz','suzhou','生命中心'),{accountId:'chair',region:'nanjing',role:'presidium',active:true,categories:[],name:'主席团'}]});
test('responsible options use stable IDs and expose only the selected region and center',()=>{
 const result=workspaceResponsibleOptions('owner','nanjing','生命中心',roster());assert.deepEqual(result.map(row=>row.id),['owner','second']);assert.deepEqual(Object.keys(result[0]).sort(),['id','name']);
 assert.deepEqual(workspaceResponsibleOptions('chair','nanjing','生命中心',roster()),result);
 assert.throws(()=>workspaceResponsibleOptions('owner','suzhou','生命中心',roster()),{statusCode:403});
 assert.throws(()=>workspaceResponsibleOptions('owner','nanjing','博爱中心',roster()),{statusCode:403});
});
test('unknown, duplicate, revoked and cross-region recipients are rejected without name matching',()=>{
 for(const id of ['同名主任','sz','love','missing','chair'])assert.throws(()=>assertWorkspaceResponsible({region:'nanjing',category:'生命中心',responsibleId:id},'owner',roster()),{statusCode:403});
 const data=roster();data.rows.push(director('second','nanjing','生命中心'));assert.throws(()=>assertWorkspaceResponsible({region:'nanjing',category:'生命中心',responsibleId:'second'},'owner',data),{statusCode:403});
 const revoked=roster();revoked.rows[1].active=false;assert.throws(()=>assertWorkspaceResponsible({region:'nanjing',category:'生命中心',responsibleId:'second'},'owner',revoked),{statusCode:403});
});

const profileData=()=>({complete:true,baseUuid:'synthetic-profile-base',accounts:[{accountId:'second',realName:'同名主任',studentId:'999990002',emailVerified:true,status:'启用'}],bindings:[{'账号ID':'second','资料BaseUUID':'synthetic-profile-base','资料行ID':'profile-2','资料同步状态':'已同步'}],profiles:[{_id:'profile-2','姓名':'同名主任','学号':'999990002','院系':'合成院系','校区':'仙林','年级':'2030级','手机号':'private','邮箱':'private'}]});
test('personal archive resolves exact verified binding and returns only necessary profile fields',()=>{
 const result=workspaceResponsibleProfile('owner','nanjing','生命中心','second',roster(),profileData());
 assert.deepEqual(result,{accountId:'second',name:'同名主任',department:'合成院系',grade:'2030级',campus:'仙林'});
});
test('ambiguous identity bindings, mismatched source and same-name foreign profiles fail closed',()=>{
 const changes=[data=>{data.complete=false;},data=>{data.bindings.push({...data.bindings[0]});},data=>{data.bindings.push({...data.bindings[0],'账号ID':'other'});},data=>{data.bindings[0]['资料BaseUUID']='other';},data=>{data.profiles[0]['学号']='999990003';},data=>{data.profiles[0]['姓名']='另一人';},data=>{data.profiles.push({...data.profiles[0]});},data=>{data.accounts[0].status='停用';}];
 for(const change of changes){const data=profileData();change(data);assert.throws(()=>workspaceResponsibleProfile('owner','nanjing','生命中心','second',roster(),data));}
 assert.throws(()=>workspaceResponsibleProfile('owner','nanjing','生命中心','sz',roster(),profileData()),{statusCode:403});
});
test('incomplete rosters cannot provide choices; incomplete drafts may omit responsibility',()=>{
 assert.throws(()=>workspaceResponsibleOptions('owner','nanjing','生命中心',{...roster(),complete:false}),{statusCode:503});
 assert.doesNotThrow(()=>assertWorkspaceResponsible({},'owner',null));assert.throws(()=>assertWorkspaceResponsible({},'owner',null,{required:true}),{statusCode:400});
});
test('saving a responsible selection invalidates its preview and fresh roster revocation blocks save',async()=>{
 const store=openWorkspaceDraftStore(':memory:');let data=roster();
 const drafts=createWorkspaceDrafts({...store,queue:createMutationQueue(),authorize:async(row,actor)=>{if(row.ownerId!==actor)throw Error('forbidden');},validateResponsible:(content,actor,options)=>assertWorkspaceResponsible(content,actor,data,options)});
 try{
  const draft=await drafts.create({requestId:'synthetic-owner-choice',content:{name:'合成草稿',region:'nanjing',category:'生命中心'}},'owner');
  const previous=await drafts.preview(draft.id,{expectedVersion:1},'owner');await drafts.confirmPreview(draft.id,{expectedVersion:1,digest:previous.digest},'owner');
  const saved=await drafts.save(draft.id,{expectedVersion:1,content:{...draft.content,responsibleId:'second'}},'owner');assert.equal(saved.version,2);assert.equal(store.read()[0].preview,null);
  assert.notEqual((await drafts.preview(draft.id,{expectedVersion:2},'owner')).digest,previous.digest);
  data.rows[1].active=false;await assert.rejects(drafts.save(draft.id,{expectedVersion:2,content:saved.content},'owner'),{statusCode:403});assert.equal(store.read()[0].version,2);
 }finally{store.close();}
});
