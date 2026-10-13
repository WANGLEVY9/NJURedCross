import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityProjects,projectEvents,activityProjectKey} from '../public/app/shared/activity-projects.js';
const event=(id,config={},date='2026-10-29')=>({_id:id,活动ID:id,活动名称:'同名活动',状态:'报名中',报名日期:date,报名页配置:JSON.stringify(config)});
test('explicit ordinary group collapses 16 sessions without losing their identities',()=>{
 const rows=Array.from({length:16},(_,i)=>event(`s${i}`,{ordinary:{groupId:'week'}}));
 const projects=activityProjects([...rows,event('independent')]);
 assert.equal(projects.length,2);assert.equal(projects[0].sessions.length,16);
 assert.equal(projectEvents(rows,rows[15]).length,16);
 assert.equal(new Set(projects[0].sessions.map(e=>e['活动ID'])).size,16);
});
test('blood project uses explicit blood marker and calendar month, not title',()=>{
 const a=event('a',{blood:{}}),b=event('b',{blood:{}},'2026-10-30'),c=event('c',{blood:{}},'2026-11-01');
 assert.equal(activityProjects([a,b,c,event('other')]).length,3);
 assert.deepEqual(projectEvents([a,b,c],a).map(e=>e._id),['a','b']);
 assert.notEqual(activityProjectKey(a),activityProjectKey(c));
});
test('same names and malformed configs are never merged, superseded rows are hidden',()=>{
 assert.equal(activityProjects([event('a'),{...event('b'),报名页配置:'broken'},{...event('c'),sourceSuperseded:true}]).length,2);
});
