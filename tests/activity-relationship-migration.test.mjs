import test from 'node:test';
import assert from 'node:assert/strict';
import {planActivityRelationshipBackfill} from '../lib/events/activity-relationship-backfill.js';
import {inspectActivityRelationships} from '../lib/events/activity-relationship-integrity.js';
import {executeRelationshipBackfill,relationshipBackfillDigest,validateRelationshipBackfillInvocation} from '../lib/events/activity-relationship-migration.js';

const root='C:/repo';
const event=(id,config,extra={})=>({_id:id,活动ID:id,状态:'报名中',报名日期:'2030-01-01',报名页配置:JSON.stringify(config),...extra});
const group={_id:'group-row',活动组ID:'project-a'};
const fixture=()=>{
  const events=[
    event('parent',{positionPlan:{groupId:'project-a',eventIds:['child']},bookingMode:'grouped'}),
    event('child',{ordinary:{groupId:'project-a'},parentActivityId:'parent'}),
  ];
  const groups=[group],baseline=inspectActivityRelationships(events,groups),plan=planActivityRelationshipBackfill(events,groups);
  return {events,groups,baseline,plan,digest:relationshipBackfillDigest(plan.patches)};
};

test('apply invocation requires confirm, digest and external absolute backup path',()=>{
  assert.equal(validateRelationshipBackfillInvocation({apply:false,root}),null);
  assert.throws(()=>validateRelationshipBackfillInvocation({apply:true,root}),{code:'activity_relationship_confirmation_required'});
  assert.throws(()=>validateRelationshipBackfillInvocation({apply:true,confirm:'APPLY-ACTIVITY-RELATIONS',root}),{code:'activity_relationship_digest_required'});
  assert.throws(()=>validateRelationshipBackfillInvocation({apply:true,confirm:'APPLY-ACTIVITY-RELATIONS',expectedDigest:'a'.repeat(64),backupDir:'C:/repo/backup',root}),{code:'activity_relationship_backup_invalid'});
  assert.equal(validateRelationshipBackfillInvocation({apply:true,confirm:'APPLY-ACTIVITY-RELATIONS',expectedDigest:'a'.repeat(64),backupDir:'C:/backup',root}),'C:\\backup');
});

test('guarded apply backs up first, writes identity patches and validates readback',async()=>{
  const f=fixture();let backedUp=false;
  const result=await executeRelationshipBackfill({
    plan:f.plan,baseline:f.baseline,digest:f.digest,expectedDigest:f.digest,schemaReady:true,
    backup:async()=>{backedUp=true;},
    update:async item=>{const row=f.events.find(row=>row._id===item.eventId);Object.assign(row,item.patch);},
    reload:async()=>({events:structuredClone(f.events),groups:f.groups}),
  });
  assert.equal(backedUp,true);assert.equal(result.writes,2);assert.equal(result.after.ok,true);
  assert.ok(f.events.every(row=>row.活动组ID==='project-a'));
});

test('stale digest and schema readiness are rejected before backup',async()=>{
  const f=fixture();let backups=0;
  const base={plan:f.plan,baseline:f.baseline,digest:f.digest,expectedDigest:'b'.repeat(64),schemaReady:true,backup:async()=>{backups++;},update:async()=>{throw Error('must not write');},reload:async()=>({events:f.events,groups:f.groups})};
  await assert.rejects(executeRelationshipBackfill(base),{code:'activity_relationship_digest_changed'});
  await assert.rejects(executeRelationshipBackfill({...base,expectedDigest:f.digest,schemaReady:false}),{code:'activity_relationship_schema_missing'});
  assert.equal(backups,0);
});

test('partial write failure reports written count for manual reconciliation',async()=>{
  const f=fixture();let writes=0;
  await assert.rejects(executeRelationshipBackfill({
    plan:f.plan,baseline:f.baseline,digest:f.digest,expectedDigest:f.digest,schemaReady:true,
    backup:async()=>{},
    update:async item=>{if(writes++)throw Error('synthetic interrupted apply');Object.assign(f.events.find(row=>row._id===item.eventId),item.patch);},
    reload:async()=>({events:f.events,groups:f.groups}),
  }),error=>error.appliedRows===1);
});

test('a silent readback mismatch fails after writes',async()=>{
  const f=fixture();
  await assert.rejects(executeRelationshipBackfill({
    plan:f.plan,baseline:f.baseline,digest:f.digest,expectedDigest:f.digest,schemaReady:true,
    backup:async()=>{},update:async()=>{},reload:async()=>({events:f.events,groups:f.groups}),
  }),{code:'activity_relationship_readback_mismatch'});
});
