import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowRoutes} from '../lib/events/workflow-api.js';

test('administrator tools use fresh authority, keep registry super-only and never load business tables',async()=>{
 for(const [role,global,expected]of [['super_admin',true,{enableRegistry:true,bloodSchedule:true}],['platform_admin',true,{enableRegistry:false,bloodSchedule:true}],['platform_admin',false,{enableRegistry:false,bloodSchedule:false}]]){
  let response,fresh=false;const session={username:'synthetic-manager',role},account={accountId:session.username,role,emailVerified:true,status:'启用'};
  const ctx={requirePortalSession:()=>session,getEventAuthority:async(_s,options)=>{fresh=options.allowCache===false;return {account,global};},getAccount:async()=>{throw Error('unexpected fallback');},getWorkflow:async()=>{throw Error('must not load workflow');},json:(_r,status,body)=>{response={status,body};}};
  await workflowRoutes({method:'GET',headers:{}},{},new URL('http://localhost/api/volunteer/workflow/management-tools'),ctx);
  assert.equal(response.status,200);assert.deepEqual(response.body.capabilities,expected);assert.equal(fresh,true);
 }
});

test('missing authority and unauthenticated sessions never expose administrative tools',async()=>{
 for(const signedIn of [true,false]){
  let response,loaded=false;
  const ctx={requirePortalSession:()=>signedIn?{username:'synthetic'}:null,getEventAuthority:async()=>null,getAccount:async()=>{loaded=true;},json:(_r,status,body)=>{response={status,body};}};
  await workflowRoutes({method:'GET',headers:{}},{},new URL('http://localhost/api/volunteer/workflow/management-tools'),ctx);
  assert.equal(loaded,false);if(signedIn)assert.equal(response.status,403);else assert.equal(response,undefined);
 }
});
