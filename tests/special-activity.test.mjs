import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpecialActivity,normalizeSpecialDraft,specialScheduleSessions,normalizeCompletionRegistration,specialActivity} from '../public/app/shared/special-activity.js';
const period=(start='08:00',end='12:00')=>({start,end,capacity:'3',serviceHours:'4',trainingHours:'0',travelHours:'1'});
const input=()=>({v:1,type:'hospital-examination',dates:['2027-01-04','2026-12-31'],places:[{location:'鼓楼校医院',periods:[period('13:00','17:00'),period()]},{location:'仙林校医院',periods:[period()]}],cutoffMinutes:30});
const range={date:'2026-12-01',endDate:'2027-01-31'};
test('explicit service dates cross December and years; only selected days produce ordered sessions',()=>{
 const c=normalizeSpecialActivity(input(),range),sessions=specialScheduleSessions(c);
 assert.equal(sessions.length,6);assert.deepEqual([...new Set(sessions.map(s=>s.date))],['2026-12-31','2027-01-04']);
 assert.deepEqual(sessions.slice(0,3).map(s=>[s.location,s.start]),[['鼓楼校医院','08:00'],['鼓楼校医院','13:00'],['仙林校医院','08:00']]);
 assert.equal(sessions[0].deadline,'2026-12-30T23:30:00.000Z');assert.equal(sessions[3].week,'2027-01-04');
 assert.ok(sessions.every(s=>!Object.hasOwn(s,'position')));
});
test('schedule rejects invalid dates, out of range, duplicate and overlapping slots and injected records',()=>{
 for(const mutate of [c=>c.dates.push(c.dates[0]),c=>c.dates.push('2026-02-30'),c=>c.dates.push('2027-02-01'),c=>c.places[0].periods.push(period('11:00','14:00')),c=>c.places[0].periods[0].capacity='0',c=>c.registrations=[]]){
  const c=input();mutate(c);assert.throws(()=>normalizeSpecialActivity(c,range));
 }
});
test('incomplete draft saves without inventing dates, people or runtime state',()=>{
 const c={v:1,type:'hospital-vaccination',dates:[],places:[],cutoffMinutes:0};
 assert.deepEqual(normalizeSpecialDraft(c),c);assert.throws(()=>normalizeSpecialActivity(c,range));
 assert.throws(()=>normalizeSpecialDraft({...c,approval:{approved:true}}));
});
test('province registration has only a daily quota and component completion has no booking quota',()=>{
 assert.deepEqual(normalizeSpecialActivity({v:1,type:'province-service',dailyCapacity:4}),{v:1,type:'province-service',dailyCapacity:4});
 assert.throws(()=>normalizeSpecialActivity({v:1,type:'province-service',dailyCapacity:4,places:[]}));
 assert.throws(()=>normalizeSpecialActivity({v:1,type:'component-donation',dailyCapacity:4}));
 assert.equal(specialActivity({'活动名称':'校医院体检'}),null);
});
test('completion requires a past China date, one-decimal duration, integer quantity and certificate',()=>{
 const c={requestId:'12345678-1234-4234-8234-123456789012',date:'2026-11-10',duration:'1.5',quantity:2,photoId:'12345678-1234-4234-8234-123456789012'},now=Date.parse('2026-11-09T16:05:00Z');
 assert.equal(normalizeCompletionRegistration(c,now).duration,1.5);
 for(const patch of [{date:'2026-11-11'},{duration:1.25},{duration:0},{quantity:1.5},{photoId:''},{accountId:'someone-else'}])assert.throws(()=>normalizeCompletionRegistration({...c,...patch},now));
});
