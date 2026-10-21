import test from 'node:test';
import assert from 'node:assert/strict';
import {organizationAuthority,assertRecordAuthority} from '../lib/events/organization-authority.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';

const account={accountId:'director',username:'director',role:'member',emailVerified:true,studentId:'999990001',realName:'合成主任'};
const events=[{_id:'a',活动ID:'WF-a',组织类别:'生命中心',报名页配置:'{}'},{_id:'b',活动ID:'WF-b',组织类别:'博爱中心',报名页配置:'{}'}];
const base={query:async()=>[{学号:account.studentId,姓名:account.realName,部门:'生命中心主任团'}]};
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
 let writes=0;const ctx={requirePortalSession:()=>admin,getEventAuthority:async()=>authority,requireCsrf:()=>true,json:(_res,status,payload)=>({status,...payload}),getWorkflow:async()=>({catalog:async()=>({events:rows}),confirm:async()=>{writes++;}}),actor:()=>admin.accountId};
 const read=path=>workflowRoutes({method:'GET',headers:{}},{},new URL('https://test.invalid/api/volunteer/workflow'+path),ctx);
 const catalog=await read('/catalog');assert.equal(catalog.status,200);assert.equal(catalog.events.length,2);assert.ok(catalog.events.every(row=>row.readOnly));
 const information=await read('/events/b/information');assert.equal(information.status,200);assert.equal(information.events[0].工作内容,'合成活动工作');
 assert.equal(JSON.stringify(information).includes('private-'),false);assert.equal(information.registrations,undefined);assert.equal(information.ledger,undefined);
 assert.equal((await read('/events/b/detail')).status,403);
 const denied=await workflowRoutes({method:'POST',headers:{}},{},new URL('https://test.invalid/api/volunteer/workflow/registrations/r/confirm'),ctx);assert.equal(denied.status,403);assert.equal(writes,0);
 const memberCtx={...ctx,getEventAuthority:async()=>({...authority,account:{...admin,role:'member'}})};const member=await workflowRoutes({method:'GET',headers:{}},{},new URL('https://test.invalid/api/volunteer/workflow/catalog'),memberCtx);assert.equal(member.status,403);
});
