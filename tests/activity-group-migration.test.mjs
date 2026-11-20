import test from 'node:test';
import assert from 'node:assert/strict';
import {activityGroupId,activityProjects,projectEvents} from '../public/app/shared/activity-projects.js';
import {applyActivityGroupCells,planActivityGroupMigration} from '../lib/events/activity-group-migration.js';
import {workflowApprovalHash} from '../lib/events/workflow.js';

const row=(id,config,extra={})=>({_id:'row-'+id,活动ID:id,活动名称:'会员大会（合成）',状态:'已结束',报名日期:'2026-11-16',报名页配置:JSON.stringify(config),...extra});
const groups=[{_id:'project',活动组ID:'PROJECT-meeting'}];
const example=()=>[
 row('meeting',{positionPlan:{groupId:'PROJECT-meeting',eventIds:['welcome','sign-in']}}),
 row('welcome',{ordinary:{groupId:'PROJECT-meeting'},parentActivityId:'meeting'}),
 row('sign-in',{ordinary:{groupId:'PROJECT-meeting'},parentActivityId:'meeting'}),
 row('another',{}),
];

test('rehearse scan, backfill and rollback: historical projects open, approval and existing IDs are unchanged',async()=>{
 const events=example(),initial=structuredClone(events),map=new Map(events.map(e=>[e._id,e])),writes=[];
 const plan=planActivityGroupMigration(events,groups,{activityId:'meeting'});
 assert.deepEqual(plan.issues,[]);assert.equal(plan.scanned,3);assert.deepEqual(events,initial);
 const deps={read:async id=>map.get(id),update:async(id,patch)=>{writes.push(id);Object.assign(map.get(id),patch);}};
 assert.deepEqual(await applyActivityGroupCells(plan,deps),{written:3,verified:3});
 assert.deepEqual(await applyActivityGroupCells(plan,deps),{written:0,verified:3});
 assert.equal(activityGroupId(events[0]),'ordinary:PROJECT-meeting');
 assert.deepEqual(projectEvents(events,events[0]).map(row=>row['活动ID']),['meeting','welcome','sign-in']);
 assert.equal(activityProjects(events).length,2);
 assert.deepEqual(events.map(workflowApprovalHash),initial.map(workflowApprovalHash));
 assert.deepEqual(await applyActivityGroupCells(plan,{...deps,rollback:true}),{written:3,verified:3});
 assert.deepEqual(events.map(e=>({...e,活动组ID:e['活动组ID']||''})),initial.map(e=>({...e,活动组ID:''})));
 assert.equal(projectEvents(events,events[0]).length,3);
 assert.equal(writes.length,6);
});

test('unknown or conflicting relations are reported; a changed row stops migration before any write',async()=>{
 const rows=example();
 assert.ok(planActivityGroupMigration(rows,[]).issues.includes('group_record_missing'));
 rows[1]['活动组ID']='another-group';
 assert.equal(activityGroupId(rows[1]),null);
 assert.ok(planActivityGroupMigration(rows,groups).issues.includes('stored_group_mismatch'));
 delete rows[1]['活动组ID'];
 const snapshot=planActivityGroupMigration(rows,groups,{activityId:'meeting'});
 rows[2]['报名页配置']='{}';
 await assert.rejects(applyActivityGroupCells(snapshot,{read:async id=>rows.find(e=>e._id===id),update:async()=>assert.fail('write before complete validation')}),/已变化/);
});

test('persisted legacy blood week is stable when the display date changes',async()=>{
 const first=row('blood-a',{blood:{week:12}}),second=row('blood-b',{blood:{week:12}});
 const data=[first,second],plan=planActivityGroupMigration(data,[]);
 const deps={read:async id=>data.find(e=>e._id===id),update:async(id,patch)=>Object.assign(data.find(e=>e._id===id),patch)};
 await applyActivityGroupCells(plan,deps);
 first['报名日期']='2026-11-24';
 assert.equal(activityGroupId(first),'blood:2026-11-16');
 assert.deepEqual(projectEvents(data,first),data);
});
