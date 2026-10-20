import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowRoutes} from '../lib/events/workflow-api.js';

test('source/template endpoint requires management access, stays read-only and respects organization scope',async()=>{
 let reads=0;
 const endpoint=new URL('http://local.test/api/volunteer/workflow/blood-schedule-source');
 const session={username:'synthetic-admin',role:'super_admin'};
 const make=extra=>({requireConsoleAccess:()=>session,requirePortalSession:()=>session,requireCsrf:()=>true,actor:()=>session.username,json:(_res,status,body)=>({status,...body}),getWorkflow:async()=>({bloodScheduleSource:async()=>{reads++;return {writes:false,templateRows:[]};}}),...extra});
 assert.equal(await workflowRoutes({method:'GET',headers:{}},{},endpoint,make({requireConsoleAccess:()=>null})),undefined);
 assert.equal(reads,0);
 const allowed=await workflowRoutes({method:'GET',headers:{}},{},endpoint,make());
 assert.equal(allowed.status,200);assert.equal(allowed.result.writes,false);assert.equal(reads,1);
 const post=await workflowRoutes({method:'POST',headers:{}},{},endpoint,make());
 assert.equal(post.status,405);assert.equal(reads,1);
 await assert.rejects(workflowRoutes({method:'GET',headers:{}},{},endpoint,make({getEventAuthority:async()=>({canEnter:true,assertGlobal(){throw Object.assign(Error('denied'),{statusCode:403});}})})),{statusCode:403});
 assert.equal(reads,1);
});
