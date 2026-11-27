import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityProjects,projectEvents,activityProjectKey,activityGroupId,weekRowContainingDate} from '../public/app/shared/activity-projects.js';
import {activityInformationView} from '../lib/events/activity-information-view.js';
const event=(id,config={},date='2026-10-29')=>({_id:id,活动ID:id,活动名称:'同名活动',状态:'报名中',报名日期:date,报名页配置:JSON.stringify(config)});
test('explicit ordinary group collapses 16 sessions without losing their identities',()=>{
 const rows=Array.from({length:16},(_,i)=>event(`s${i}`,{ordinary:{groupId:'week'}}));
 const projects=activityProjects([...rows,event('independent')]);
 assert.equal(projects.length,2);assert.equal(projects[0].sessions.length,16);
 assert.equal(projectEvents(rows,rows[15]).length,16);
 assert.equal(new Set(projects[0].sessions.map(e=>e['活动ID'])).size,16);
});
test('blood project uses explicit blood marker and calendar week, not title',()=>{
 const a=event('a',{blood:{}}),b=event('b',{blood:{}},'2026-10-30'),c=event('c',{blood:{}},'2026-11-02');
 assert.equal(activityProjects([a,b,c,event('other')]).length,3);
 assert.deepEqual(projectEvents([a,b,c],a).map(e=>e._id),['a','b']);
 assert.notEqual(activityProjectKey(a),activityProjectKey(c));
});
test('same names and malformed configs are never merged, superseded rows are hidden',()=>{
 assert.equal(activityProjects([event('a'),{...event('b'),报名页配置:'broken'},{...event('c'),sourceSuperseded:true}]).length,2);
});

test('first position generation does not change the group ID already exposed for a grouped parent',()=>{
 const draft=event('parent',{bookingMode:'grouped'});
 const published=event('parent',{bookingMode:'grouped',positionPlan:{groupId:'PROJECT-parent'}});
 const shift=event('shift',{ordinary:{groupId:'PROJECT-parent'},parentActivityId:'parent'});
 assert.equal(activityGroupId(draft),activityGroupId(published));
 assert.equal(activityGroupId(shift),activityGroupId(published));
 assert.equal(activityGroupId(event('another')), 'event:another');
 assert.equal(activityGroupId({...shift,relationshipError:true}),null);
 assert.equal(activityGroupId({...shift,报名页配置:'null'}),null);
});

test('saved schedule and blood week identities take precedence over an edited display date',()=>{
 const week='2026-10-26';
 const schedule=event('shift',{special:{type:'schedule',rootId:'ROOT',week},ordinary:{groupId:'PROJECT-ROOT'}},'2026-11-02');
 const blood=event('blood',{blood:{weekStart:week}},'2026-11-02');
 for(const [row,expected] of [[schedule,'schedule:ROOT:2026-10-26'],[blood,'blood:2026-10-26']]){
  assert.equal(activityGroupId(row),expected);
  const readOnly=activityInformationView(row);
  assert.equal(readOnly.groupId,expected);
  assert.equal(activityProjectKey(readOnly),expected);
 }
});

test('closed future source shifts keep the week manageable when its first shift already ended',()=>{
 const config={blood:{},source:{kind:'generated_blood'}};
 const past={...event('past',config,'2026-10-26'),状态:'已结束'};
 const future={...event('future',config,'2026-10-29'),状态:'进行中'};
 let project=activityProjects([past,future])[0];assert.equal(project._id,'future');assert.equal(project['状态'],'进行中');assert.equal(project.sessions.length,2);
 future['状态']='报名中';project=activityProjects([past,future])[0];assert.equal(project['状态'],'报名中');
 future['状态']='停点';project=activityProjects([past,future])[0];assert.equal(project['状态'],'停点');
});

test('weekly directory resolves the row containing today, and never rewrites past-only groups',()=>{
 const duty=(id,groupId,monday)=>{
  const days=Array.from({length:5},(_,i)=>{const d=new Date(monday+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});
  return activityProjects(days.map((date,index)=>event(id+'-'+index,{ordinary:{groupId}},date)))[0];
 };
 const group=[duty('w1','DUTY-2026-11-16','2026-11-16'),duty('w2','DUTY-2026-11-23','2026-11-23'),duty('w3','DUTY-2026-11-30','2026-11-30')];
 assert.equal(weekRowContainingDate(group,'2026-11-27').sessions[0]['报名日期'].slice(0,10),'2026-11-23');
 assert.equal(weekRowContainingDate(group,'2026-11-16').sessions[0]['报名日期'].slice(0,10),'2026-11-16');
 assert.equal(weekRowContainingDate(group,'2026-11-29').sessions[0]['报名日期'].slice(0,10),'2026-11-23');
 // 本周不存在时返回 null：调用方维持原有顺序，不把默认项改成最后一周。
 assert.equal(weekRowContainingDate(group,'2026-12-20'),null);
 assert.equal(weekRowContainingDate([],'2026-11-27'),null);
 assert.equal(weekRowContainingDate(group,'not-a-date'),null);
});

test('week row detection prefers the sessions span over the project date',()=>{
 const project={_id:'week',报名日期:'2026-11-16',sessions:[{报名日期:'2026-11-16'},{报名日期:'2026-11-20'}]};
 assert.equal(weekRowContainingDate([project],'2026-11-20'),project);
 // 周末同样属于同一自然周：组宣部只在工作日排班，不能因此判不到本周。
 assert.equal(weekRowContainingDate([project],'2026-11-21'),project);
 assert.equal(weekRowContainingDate([project],'2026-11-23'),null);
});
