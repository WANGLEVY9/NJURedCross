import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceRosterEvidence,workspaceRosterPermissions} from '../lib/events/workspace-roster.js';

const chair=(region,accountId='chair')=>({accountId,region,role:'presidium',active:true,categories:[],name:'主席团 & 指导组'});
const event={stage:'待审批',region:'suzhou',category:'生命中心',ownerId:'owner'};
test('identically named presidiums approve only their roster-bound region',()=>{
  assert.equal(workspaceRosterPermissions(event,'chair',[chair('nanjing')],{complete:true}).review,false);
  assert.equal(workspaceRosterPermissions(event,'chair',[chair('suzhou')],{complete:true}).review,true);
  assert.equal(workspaceRosterPermissions({...event,region:'nanjing'},'chair',[chair('suzhou')],{complete:true}).review,false);
});
test('missing, partial, duplicate and inactive roster evidence fails closed',()=>{
  for(const [rows,options]of [[[],{complete:true}],[[chair('suzhou')],{}],[[chair('suzhou'),chair('suzhou')],{complete:true}],[[{...chair('suzhou'),active:false}],{complete:true}]])
    assert.equal(workspaceRosterPermissions(event,'chair',rows,options).review,false);
  assert.equal(workspaceRosterEvidence('chair','suzhou',[{...chair('suzhou'),role:'super_admin'}],{complete:true}).verified,false);
});
test('directors require both ownership and matching center and region to edit a draft',()=>{
  const row={accountId:'owner',region:'suzhou',role:'director',active:true,categories:['生命中心']};
  const draft={...event,stage:'草稿'};
  assert.equal(workspaceRosterPermissions(draft,'owner',[row],{complete:true}).edit,true);
  for(const changed of [{...row,region:'nanjing'},{...row,categories:['博爱中心']},{...row,accountId:'other'}])
    assert.equal(workspaceRosterPermissions(draft,'owner',[changed],{complete:true}).edit,false);
  assert.equal(workspaceRosterPermissions(event,'owner',[row],{complete:true}).edit,false);
});
test('regional category bindings reject unavailable specialties and cannot be mutated by callers',()=>{
  assert.equal(workspaceRosterEvidence('chair','suzhou',[{...chair('suzhou'),categories:['献血车专项']}],{complete:true}).verified,false);
  const rows=[chair('nanjing')],evidence=workspaceRosterEvidence('chair','nanjing',rows,{complete:true});
  assert.equal(evidence.categories.length,7);evidence.categories.pop();assert.deepEqual(rows[0].categories,[]);
});
