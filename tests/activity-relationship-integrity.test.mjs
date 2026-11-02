import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectActivityRelationships} from '../lib/events/activity-relationship-integrity.js';
import {activityProjects} from '../public/app/shared/activity-projects.js';

const event=(id,{status='报名中',config={},...extra}={})=>({_id:id,活动ID:id,活动名称:'合成项目',状态:status,报名日期:'2030-01-01',报名页配置:JSON.stringify(config),...extra});
const group={_id:'group-row',活动组ID:'project-a'};

test('valid legacy grouped parent and child pass relationship inspection',()=>{
  const parent=event('parent',{config:{positionPlan:{groupId:'project-a',eventIds:['child']},bookingMode:'grouped'}});
  const child=event('child',{config:{ordinary:{groupId:'project-a'},parentActivityId:'parent'}});
  const report=inspectActivityRelationships([parent,child],[group]);
  assert.equal(report.ok,true);
  assert.deepEqual(report.counts,{});
});

test('missing parent, mismatched group and child outside approved plan are distinct failures',()=>{
  const parent=event('parent',{config:{positionPlan:{groupId:'project-a',eventIds:['other']},bookingMode:'grouped'}});
  const child=event('child',{config:{ordinary:{groupId:'project-b'},parentActivityId:'parent'}});
  const orphan=event('orphan',{config:{ordinary:{groupId:'project-a'},parentActivityId:'missing'}});
  const report=inspectActivityRelationships([parent,child,orphan],[group]);
  assert.equal(report.ok,false);
  assert.ok(report.counts.parent_group_mismatch);
  assert.ok(report.counts.parent_not_unique);
  assert.ok(report.counts.child_outside_parent_plan);
});

test('duplicate group rows and active missing group records fail closed',()=>{
  const row=event('event',{config:{ordinary:{groupId:'project-a'}}});
  let report=inspectActivityRelationships([row],[group,{...group,_id:'duplicate'}]);
  assert.equal(report.counts.duplicate_group_row,1);
  report=inspectActivityRelationships([row],[]);
  assert.equal(report.counts.group_record_missing,1);
});

test('malformed configuration is reported without guessing relationships',()=>{
  const broken=event('broken',{报名页配置:'{"ordinary":',configurationError:true});
  const report=inspectActivityRelationships([broken],[]);
  assert.equal(report.ok,false);
  assert.equal(report.counts.configuration_invalid,1);
  assert.equal(report.counts.child_without_group,undefined);
  assert.equal(activityProjects([broken]).length,1);
});

test('archived malformed configurations do not keep current integrity checks red',()=>{
  const broken=event('archived',{status:'已归档',报名页配置:'{"ordinary":',configurationError:true});
  const report=inspectActivityRelationships([broken],[]);
  assert.equal(report.ok,true);
  assert.equal(report.checked.ignoredArchived,1);
});
