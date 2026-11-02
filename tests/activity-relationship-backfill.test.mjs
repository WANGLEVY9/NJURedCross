import test from 'node:test';
import assert from 'node:assert/strict';
import {planActivityRelationshipBackfill} from '../lib/events/activity-relationship-backfill.js';

const event=(id,config,extra={})=>({_id:id,活动ID:id,状态:'报名中',报名日期:'2030-01-01',报名页配置:JSON.stringify(config),...extra});
const group={_id:'group-row',活动组ID:'project-a'};

test('backfill derives only missing native relationship fields from complete configuration',()=>{
  const parent=event('parent',{positionPlan:{groupId:'project-a',eventIds:['child']},bookingMode:'grouped'});
  const child=event('child',{ordinary:{groupId:'project-a'},parentActivityId:'parent'});
  const result=planActivityRelationshipBackfill([parent,child],[group]);
  assert.deepEqual(result.patches,[
    {eventId:'child',activityId:'child',patch:{活动组ID:'project-a',父活动ID:'parent'}},
    {eventId:'parent',activityId:'parent',patch:{活动组ID:'project-a'}},
  ]);
  assert.equal(result.changedRows,2);assert.equal(result.blocked.length,0);assert.equal(result.report.ok,true);
});

test('already migrated rows are idempotent and matching JSON is not rewritten',()=>{
  const row=event('child',{ordinary:{groupId:'project-a'},parentActivityId:'parent'},{活动组ID:'project-a',父活动ID:'parent'});
  const result=planActivityRelationshipBackfill([event('parent',{positionPlan:{eventIds:['child']},bookingMode:'grouped'},{活动组ID:'project-a',父活动ID:''}),row],[group]);
  assert.deepEqual(result.patches,[]);assert.equal(result.blocked.length,0);assert.equal(result.report.ok,true);
});

test('damaged or conflicting configuration is blocked instead of guessed',()=>{
  const damaged=event('damaged',null,{报名页配置:'{"ordinary":'});
  const conflict=event('conflict',{ordinary:{groupId:'project-a'},parentActivityId:'parent'},{活动组ID:'foreign',父活动ID:'parent'});
  const result=planActivityRelationshipBackfill([damaged,conflict],[group]);
  assert.deepEqual(result.patches,[]);
  assert.deepEqual(result.blocked.map(row=>row.code),['group_relation_conflict','configuration_unrecoverable']);
});
