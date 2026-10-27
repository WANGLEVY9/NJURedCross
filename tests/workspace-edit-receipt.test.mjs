import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createActivityLifecycleStore} from '../lib/events/activity-lifecycle-store.js';
import {workspaceEditReference,resolveWorkspaceEdit} from '../lib/events/workspace-edit-receipt.js';
import {assertWorkflowConfigWrite,readWorkflowConfig} from '../lib/events/workflow-config-integrity.js';

test('private edit receipts survive reopening, are event-scoped, immutable and digest checked',()=>{
 const dir=mkdtempSync(join(tmpdir(),'synthetic-edit-receipt-')),file=join(dir,'activity.sqlite');
 let store=createActivityLifecycleStore(file);
 try{
  const receipt={status:'applying',actor:'synthetic-chair',token:'test-token',digest:'request-digest',expectedVersion:1,content:{deadline:'2030-01-01T12:00'},plan:{jobs:[]}};
  store.saveWorkspaceEdit('event-one',receipt);store.close();store=createActivityLifecycleStore(file);
  const reference=workspaceEditReference(receipt,'finishing');
  assert.deepEqual(resolveWorkspaceEdit('event-one',reference,store),receipt);
  assert.throws(()=>resolveWorkspaceEdit('event-two',reference,store),{code:'workspace_edit_receipt_unavailable'});
  assert.throws(()=>resolveWorkspaceEdit('event-one',{...reference,digest:'changed'},store),{code:'workspace_edit_receipt_unavailable'});
  assert.throws(()=>store.saveWorkspaceEdit('event-one',{...receipt,content:{}}),{code:'workspace_edit_conflict'});
  const legacy={...receipt,status:'finishing'};assert.deepEqual(resolveWorkspaceEdit('event-one',legacy,store),legacy);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('configuration validation rejects truncation, non-object JSON and oversized text before writes',()=>{
 assert.deepEqual(readWorkflowConfig({报名页配置:''}),{});
 for(const text of ['{"bookingMode":','null','[]','42'])
  assert.throws(()=>assertWorkflowConfigWrite({报名页配置:text}),{code:'workflow_configuration_invalid'});
 assert.throws(()=>assertWorkflowConfigWrite({报名页配置:JSON.stringify({note:'合成'.repeat(5000)})}),{code:'workflow_configuration_too_large'});
 assert.deepEqual(readWorkflowConfig({报名页配置:'{"bookingMode":"grouped"}'}),{bookingMode:'grouped'});
});
