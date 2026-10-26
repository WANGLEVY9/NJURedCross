import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceDraftRoutes} from '../lib/events/workspace-draft-api.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';

async function capabilities(overrides={}){
  let payload;
  const ctx={
    getWorkspaceDrafts:async()=>({}),
    getWorkspaceSubmissions:async()=>({}),
    getWorkspaceRoster:async()=>({complete:true,rows:[]}),
    actor:()=> 'synthetic-owner',
    json:(_res,status,body)=>{payload={status,...body};return payload;},
    ...overrides,
  };
  await workspaceDraftRoutes({method:'GET',headers:{}},null,new URL('http://localhost/api/volunteer/workflow/workspace-drafts/capabilities'),ctx,{username:'synthetic-owner'});
  return payload;
}

test('workspace capability is closed when the trusted roster is missing or unreadable',async()=>{
  const missing=await capabilities({getWorkspaceRoster:async()=>({complete:false,rows:[]})});
  assert.deepEqual(missing.capabilities,{enabled:true,canCreate:true,creationScopes:undefined,rosterAvailable:false,canSubmit:false});
  const failed=await capabilities({getWorkspaceRoster:async()=>{throw new Error('synthetic failure');}});
  assert.deepEqual(failed.capabilities,{enabled:true,canCreate:true,creationScopes:undefined,rosterAvailable:false,canSubmit:false});
});

test('workspace capability requires both current roster evidence and the submission provider',async()=>{
  const ready=await capabilities();
  assert.deepEqual(ready.capabilities,{enabled:true,canCreate:true,creationScopes:undefined,rosterAvailable:true,canSubmit:true});
  const withoutSubmit=await capabilities({getWorkspaceSubmissions:undefined});
  assert.equal(withoutSubmit.capabilities.canSubmit,false);
});

test('a disabled workspace answers its capability probe before reading activity authority',async()=>{
  let authorityReads=0;
  const ctx={
    getEventAuthority:async()=>{authorityReads++;throw new Error('authority must not be read');},
    requirePortalSession:()=>({username:'synthetic-owner',role:'platform_admin'}),
    json:(_res,status,body)=>({status,...body}),
  };
  const result=await workflowRoutes(
    {method:'GET',headers:{}},
    null,
    new URL('http://localhost/api/volunteer/workflow/workspace-drafts/capabilities'),
    ctx,
  );
  assert.equal(authorityReads,0);
  assert.equal(result.status,200);
  assert.deepEqual(result.capabilities,{enabled:false,rosterAvailable:false,canSubmit:false});
});

test('creating within center scope is independent of roster submission readiness and existing events',async()=>{
 const scopes=[{region:'nanjing',category:'生命中心'}];
 const result=await capabilities({workspaceAuthority:{creationScopes:scopes},getWorkspaceRoster:async()=>({complete:false,rows:[]})});
 assert.equal(result.capabilities.canCreate,true);assert.deepEqual(result.capabilities.creationScopes,scopes);assert.equal(result.capabilities.canSubmit,false);
 assert.equal((await capabilities({workspaceAuthority:{creationScopes:[]}})).capabilities.canCreate,false);
});
