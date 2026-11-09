import test from 'node:test';
import assert from 'node:assert/strict';
import {specialScheduleRoutes} from '../lib/events/special-schedule-api.js';

const event=(id,root,week)=>({_id:id,活动ID:id,地点:'合成地点',报名页配置:JSON.stringify({special:{v:1,type:'schedule',rootId:root,week}})});
test('project total includes only the selected project and checks every included event authority',async()=>{
 const events=[event('a','one','2030-12-09'),event('b','one','2030-12-16'),event('c','other','2030-12-16')],seen=[];
 const data={events,registrations:events.map(e=>({_id:'r-'+e._id,活动ID:e['活动ID'],姓名:'合成同学',学号:'999990001',报名日期:'2030-12-10',报名时段:'08:00–12:00',报名状态:'已确认'})),ledger:[]};
 const authority={assertEvent:id=>{seen.push(id);return events.find(e=>e._id===id);}};
 let payload;const ctx={json:(_res,_status,p)=>{payload=p;}};
 await specialScheduleRoutes({method:'GET'},{},new URL('http://localhost/api/volunteer/workflow/events/a/schedule-total'),ctx,{read:async()=>data},authority);
 assert.deepEqual(payload.rows.map(r=>r.id),['r-a','r-b']);assert.equal(payload.participantCount,1);assert.equal(payload.sessionCount,2);assert.ok(seen.includes('b'));assert.ok(!seen.includes('c'));
 await assert.rejects(specialScheduleRoutes({method:'GET'},{},new URL('http://localhost/api/volunteer/workflow/events/a/schedule-total'),ctx,{read:async()=>data},{assertEvent:id=>{if(id==='b')throw Error('denied');return events[0];}}),/denied/);
});
