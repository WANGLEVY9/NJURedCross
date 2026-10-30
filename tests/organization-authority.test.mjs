import test from 'node:test';
import assert from 'node:assert/strict';
import {organizationAuthority,assertRecordAuthority} from '../lib/events/organization-authority.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';
import {createWorkflow} from '../lib/events/workflow.js';

const account={accountId:'director',username:'director',role:'member',emailVerified:true,studentId:'999990001',realName:'合成主任'};
const events=[{_id:'a',活动ID:'WF-a',组织类别:'生命中心',报名页配置:'{}'},{_id:'b',活动ID:'WF-b',组织类别:'博爱中心',报名页配置:'{}'}];
const base={query:async()=>[{学号:account.studentId,姓名:account.realName,部门:'生命中心主任团'}]};
test('delegated blood managers can access generated shifts without gaining other categories or regions',async()=>{
 const id='BS-'+ 'a'.repeat(24),sourceId='WF-blood-source';
 const event={_id:id,活动ID:id,报名页配置:JSON.stringify({source:{kind:'generated_blood'},sourceActivityIds:[sourceId]})};
 const roster=categories=>({complete:true,policy:'two-stage',rows:[{accountId:account.accountId,region:'nanjing',role:'director',active:true,categories}]});
 const authority=await organizationAuthority(account,base,[],{workspaceRoster:roster(['献血车专项'])});
 assert.equal(authority.canEnter,true);assert.equal(authority.access(event).manage,true);authority.assertEvent(id);
 const filtered=authority.filter({events:[event],registrations:[{活动ID:sourceId},{活动ID:'foreign'}]});
 assert.deepEqual(filtered.registrations,[{活动ID:sourceId}]);
 assert.throws(()=>authority.assertEvent('ordinary-foreign'),{statusCode:403});
 const unrelated=await organizationAuthority(account,base,[],{workspaceRoster:roster(['生命中心'])});
 assert.throws(()=>unrelated.assertEvent(id),{statusCode:403});assert.equal(unrelated.filter({events:[event]}).events.length,0);
 const suzhou=await organizationAuthority(account,base,[],{workspaceRoster:{complete:true,rows:[{accountId:account.accountId,region:'suzhou',role:'director',active:true,categories:['生命中心']}]}});
 assert.throws(()=>suzhou.assertEvent(id),{statusCode:403});
});

test('adding and revoking blood authority changes catalogue, detail and registration mutation access',async()=>{
 const id='BS-'+'b'.repeat(24),event={_id:id,活动ID:id,活动名称:'合成献血车',报名页配置:JSON.stringify({source:{kind:'generated_blood'},blood:{mode:'blood_vehicle'}})};
 let granted=false,writes=0;
 const ctx={requirePortalSession:()=>account,requireCsrf:()=>true,actor:()=>account.accountId,
  getEventAuthority:()=>organizationAuthority(account,base,[],{workspaceRoster:{complete:true,policy:'two-stage',managedAccountIds:[account.accountId],rows:granted?[{accountId:account.accountId,region:'nanjing',role:'director',active:true,categories:['献血车专项']}]:[]}}),
  getAuthorityBase:async()=>({query:async()=>[{_id:'registration',活动ID:id}]}),
  getWorkflow:async()=>({catalog:async()=>({events:[event]}),detail:async()=>({events:[event],registrations:[]}),read:async()=>({events:[event],registrations:[{_id:'registration',活动ID:id}]}),confirm:async()=>{writes++;return {};}}),
  readJson:async()=>({}),audit:async()=>{},json:(_res,status,payload)=>({status,...payload})};
 const call=(path,method='GET')=>workflowRoutes({method,headers:{}},{},new URL('https://test.invalid/api/volunteer/workflow'+path),ctx);
 assert.equal((await call('/events/'+id+'/detail')).status,403);
 granted=true;
 const catalog=await call('/catalog');assert.equal(catalog.status,200);assert.equal(catalog.events[0].readOnly,false);
 const detail=await call('/events/'+id+'/detail');assert.equal(detail.status,200);assert.equal(detail.events[0].managementAccess.manage,true);
 await call('/registrations/registration/confirm','POST');assert.equal(writes,1);
 granted=false;
 assert.equal((await call('/events/'+id+'/detail')).status,403);
 assert.equal((await call('/registrations/registration/confirm','POST')).status,403);assert.equal(writes,1);
});
test('fresh organization authority denies cross-center access and ignores stale ownership projections',async()=>{
 const authority=await organizationAuthority(account,base,events);
 assert.equal(authority.canEnter,true);authority.assertEvent('a');
 assert.throws(()=>authority.assertEvent('b'),{statusCode:403});
 authority.assertCreate({center:'生命中心'});
 for(const center of ['博爱中心','主席团专项','一加助残专项','献血车专项'])assert.throws(()=>authority.assertCreate({center}),{statusCode:403});
 const data=authority.filter({events:events.map(e=>({...e,负责人账号ID:'director',报名页配置:JSON.stringify({sourceActivityIds:['WF-b']})})),registrations:[{活动ID:'WF-a'},{活动ID:'WF-b'}],ledger:[{活动ID:'WF-b'}],profiles:[{账号ID:'private'}],summaries:[{账号ID:'private'}]});
 assert.deepEqual(data.events.map(e=>e._id),['a']);assert.equal(data.registrations.length,1);assert.equal(data.ledger.length,0);
 assert.deepEqual(data.profiles,[]);assert.deepEqual(data.summaries,[]);
 await assert.rejects(assertRecordAuthority({query:async()=>[{_id:'r',活动ID:'WF-b'}]},authority,'registrations',['r']),{statusCode:403});
 await assertRecordAuthority({query:async()=>[{_id:'r',活动ID:'WF-a'}]},authority,'registrations',['r']);
});
test('workflow HTTP route applies scope before mutations and filters catalogue responses',async()=>{
 const authority=await organizationAuthority(account,base,events);let called=false;
 const ctx={requirePortalSession:()=>account,getEventAuthority:async()=>authority,requireCsrf:()=>true,json:(_res,_status,payload)=>payload,getWorkflow:async()=>({catalog:async()=>({events}),confirm:async()=>{called=true;}}),getAuthorityBase:async()=>({query:async()=>[{_id:'r',活动ID:'WF-b'}]}),actor:()=>account.accountId,readJson:async()=>({}),audit:async()=>{}};
 const result=await workflowRoutes({method:'GET',headers:{}},{},new URL('https://test.invalid/api/volunteer/workflow/catalog'),ctx);
 assert.deepEqual(result.events.map(e=>e._id),['a','b']);assert.equal(result.events.find(e=>e._id==='b').readOnly,true);
 await assert.rejects(workflowRoutes({method:'POST',headers:{}},{},new URL('https://test.invalid/api/volunteer/workflow/registrations/r/confirm'),ctx),{statusCode:403});
 assert.equal(called,false);
});

test('console administrators can browse cross-scope information without receiving participant data or write access',async()=>{
 const admin={...account,role:'platform_admin'};const rows=events.map(row=>({...row,活动名称:row._id,工作内容:'合成活动工作',服务时长:2,通知草稿:'合成通知',负责人账号ID:'private-owner',rosterToken:'private-token',报名页配置:JSON.stringify({center:row.组织类别,region:'南京活动',approval:{reviewerIds:['private-reviewer']},coOwners:['private-co-owner']})}));
 const authority=await organizationAuthority(admin,base,rows,{workspaceRoster:{complete:true,policy:'two-stage',rows:[]}});assert.equal(authority.canEnter,false);
 let writes=0;const ctx={requirePortalSession:()=>admin,getEventAuthority:async()=>authority,requireCsrf:()=>true,json:(_res,status,payload)=>({status,...payload}),getWorkflow:async()=>({...createWorkflow({listRows:()=>assert.fail('authority snapshot should supply metadata')}),catalog:async()=>({events:rows}),confirm:async()=>{writes++;}}),actor:()=>admin.accountId};
 const read=path=>workflowRoutes({method:'GET',headers:{}},{},new URL('https://test.invalid/api/volunteer/workflow'+path),ctx);
 const catalog=await read('/catalog');assert.equal(catalog.status,200);assert.equal(catalog.events.length,2);assert.ok(catalog.events.every(row=>row.readOnly));
 const information=await read('/events/b/information');assert.equal(information.status,200);assert.equal(information.events[0].工作内容,'合成活动工作');
 assert.equal(JSON.stringify(information).includes('private-'),false);assert.equal(information.registrations,undefined);assert.equal(information.ledger,undefined);
 assert.equal((await read('/events/b/detail')).status,403);
 const denied=await workflowRoutes({method:'POST',headers:{}},{},new URL('https://test.invalid/api/volunteer/workflow/registrations/r/confirm'),ctx);assert.equal(denied.status,403);assert.equal(writes,0);
 const memberCtx={...ctx,getEventAuthority:async()=>({...authority,account:{...admin,role:'member'}})};const member=await workflowRoutes({method:'GET',headers:{}},{},new URL('https://test.invalid/api/volunteer/workflow/catalog'),memberCtx);assert.equal(member.status,403);
});

test('creation scopes preserve fresh center authority until migrated but never restore explicitly revoked accounts',async()=>{
 const roster={complete:true,policy:'two-stage',managedAccountIds:[],rows:[]};
 const authority=await organizationAuthority(account,base,[],{workspaceRoster:roster});assert.equal(authority.canEnter,true);assert.ok(authority.creationScopes.some(scope=>scope.region==='nanjing'&&scope.category==='生命中心'));
 authority.assertCreate({center:'生命中心',region:'nanjing'});assert.throws(()=>authority.assertCreate({center:'博爱中心',region:'nanjing'}),{statusCode:403});
 const revoked=await organizationAuthority(account,{query:async()=>{throw Error('revoked accounts must not fall back');}},[],{workspaceRoster:{...roster,managedAccountIds:[account.accountId]}});assert.equal(revoked.canEnter,false);assert.deepEqual(revoked.creationScopes,[]);
});


test('configured regional directors cannot create across regions while existing global authority remains unchanged',async()=>{
 const rows=[{accountId:'nanjing-director',region:'nanjing',role:'director',active:true,categories:['生命中心']},{accountId:'suzhou-director',region:'suzhou',role:'director',active:true,categories:['生命中心']},{accountId:'chair',region:'nanjing',role:'global',active:true,categories:['生命中心']},{accountId:'chair',region:'suzhou',role:'global',active:true,categories:['生命中心']}];
 for(const [actor,allowed,foreign]of [['nanjing-director','nanjing','suzhou'],['suzhou-director','suzhou','nanjing']]){
  const authority=await organizationAuthority({...account,accountId:actor,role:'platform_admin'},base,[],{workspaceRoster:{complete:true,rows}});
  authority.assertCreate({center:'生命中心',region:allowed});assert.throws(()=>authority.assertCreate({center:'生命中心',region:foreign}),{statusCode:403});assert.ok(authority.creationScopes.every(scope=>scope.region===allowed));
 }
 const chairman=await organizationAuthority({...account,accountId:'chair',role:'super_admin'},base,[],{workspaceRoster:{complete:true,rows}});
 for(const region of ['nanjing','suzhou']){chairman.assertCreate({center:'生命中心',region});assert.ok(chairman.creationScopes.some(scope=>scope.region===region));}
});
