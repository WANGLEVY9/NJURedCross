import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceDraftRoutes} from '../lib/events/workspace-draft-api.js';

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
  assert.deepEqual(missing.capabilities,{enabled:true,rosterAvailable:false,canSubmit:true});
  const failed=await capabilities({getWorkspaceRoster:async()=>{throw new Error('synthetic failure');}});
  assert.deepEqual(failed.capabilities,{enabled:true,rosterAvailable:false,canSubmit:true});
});

test('workspace capability requires both current roster evidence and the submission provider',async()=>{
  const ready=await capabilities();
  assert.deepEqual(ready.capabilities,{enabled:true,rosterAvailable:true,canSubmit:true});
  const withoutSubmit=await capabilities({getWorkspaceSubmissions:undefined});
  assert.equal(withoutSubmit.capabilities.canSubmit,false);
});
