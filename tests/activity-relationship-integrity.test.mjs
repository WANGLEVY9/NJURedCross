import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectActivityRelationships} from '../lib/events/activity-relationship-integrity.js';
import {activityProjects} from '../public/app/shared/activity-projects.js';

const event=(id,{status='报名中',config={},...extra}={})=>({_id:id,活动ID:id,活动名称:'合成项目',状态:status,报名日期:'2030-01-01',报名页配置:JSON.stringify(config),...extra});
const group={_id:'group-row',活动组ID:'project-a'};

test('valid grouped parent and child pass relationship inspection',()=>{
  const parent=event('parent',{config:{positionPlan:{eventIds:['child']},bookingMode:'grouped'},活动组ID:'project-a'});
  const child=event('child',{config:{ordinary:{groupId:'project-a'},parentActivityId:'parent'},活动组ID:'project-a',父活动ID:'parent'});
  const report=inspectActivityRelationships([parent,child],[group]);
  assert.equal(report.ok,true);
  assert.deepEqual(report.counts,{});
});

test('missing parent, mismatched group and child outside approved plan are distinct failures',()=>{
  const parent=event('parent',{config:{positionPlan:{eventIds:['other']},bookingMode:'grouped'},活动组ID:'project-a'});
  const child=event('child',{config:{ordinary:{groupId:'project-b'},parentActivityId:'parent'},活动组ID:'project-b',父活动ID:'parent'});
  const orphan=event('orphan',{config:{ordinary:{groupId:'project-a'},parentActivityId:'missing'},活动组ID:'project-a',父活动ID:'missing'});
  const report=inspectActivityRelationships([parent,child,orphan],[group]);
  assert.equal(report.ok,false);
  assert.ok(report.counts.parent_group_mismatch);
  assert.ok(report.counts.parent_not_unique);
  assert.ok(report.counts.child_outside_parent_plan);
});

test('duplicate group rows and active missing group records fail closed',()=>{
  const row=event('event',{config:{ordinary:{groupId:'project-a'}},活动组ID:'project-a'});
  let report=inspectActivityRelationships([row],[group,{...group,_id:'duplicate'}]);
  assert.equal(report.counts.duplicate_group_row,1);
  report=inspectActivityRelationships([row],[]);
  assert.equal(report.counts.group_record_missing,1);
});

test('damaged configuration keeps native parent relationship recognizable',()=>{
  const parent=event('parent',{活动组ID:'project-a'});
  const child=event('child',{活动组ID:'project-a',父活动ID:'parent',报名页配置:'{"ordinary":',configurationError:true});
  const report=inspectActivityRelationships([parent,child],[group]);
  assert.equal(report.ok,false);
  assert.equal(report.counts.configuration_invalid,1);
  assert.equal(report.counts.child_without_group,undefined);
  assert.equal(report.counts.parent_not_unique,undefined);
  const projects=activityProjects([parent,child]);
  assert.equal(projects.length,1);
  assert.equal(projects[0].sessions.length,2);
  assert.equal(projects[0].configurationError,true);
});
