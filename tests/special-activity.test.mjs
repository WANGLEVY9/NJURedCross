import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpecialActivity,normalizeSpecialDraft,specialScheduleSessions,normalizeCompletionRegistration,specialActivity,DUTY_CAPACITY,dutyPerSessionCapacity} from '../public/app/shared/special-activity.js';
const period=(start='08:00',end='12:00')=>({start,end,capacity:'3',serviceHours:'4',trainingHours:'0',travelHours:'1'});
const input=()=>({v:1,type:'hospital-examination',dates:['2027-01-04','2026-12-31'],places:[{location:'鼓楼校医院',periods:[period('13:00','17:00'),period()]},{location:'仙林校医院',periods:[period()]}],cutoffMinutes:30});
const range={date:'2026-12-01',endDate:'2027-01-31'};
test('explicit service dates cross December and years; only selected days produce ordered sessions',()=>{
 const c=normalizeSpecialActivity(input(),range),sessions=specialScheduleSessions(c);
 assert.equal(sessions.length,6);assert.deepEqual([...new Set(sessions.map(s=>s.date))],['2026-12-31','2027-01-04']);
 assert.deepEqual(sessions.slice(0,3).map(s=>[s.location,s.start]),[['鼓楼校医院','08:00'],['鼓楼校医院','13:00'],['仙林校医院','08:00']]);
 assert.equal(sessions[0].deadline,'2026-12-30T00:00:00.000Z');assert.equal(sessions[3].week,'2027-01-04');
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
test('duty card reports the newest session capacity instead of the frozen week or the group sum',()=>{
 // 名额升级后组里仍留着旧周次（容量 1），sessions 升序、最新一班在末尾。
 assert.equal(dutyPerSessionCapacity({recurringDuty:true,capacity:'62',sessions:[{capacity:1},{capacity:'1'},{capacity:2}]}),2);
 // 单班行没有 sessions，用自己的容量。
 assert.equal(dutyPerSessionCapacity({recurringDuty:true,capacity:'2'}),2);
 // 容量读不成数字时不能把整组求和（62）当成每班人数。
 assert.equal(dutyPerSessionCapacity({recurringDuty:true,capacity:'62',sessions:[{capacity:''},{capacity:null}]}),DUTY_CAPACITY);
 assert.equal(dutyPerSessionCapacity({recurringDuty:true,sessions:[]}),DUTY_CAPACITY);
 assert.equal(dutyPerSessionCapacity({}),DUTY_CAPACITY);
 assert.equal(dutyPerSessionCapacity({sessions:[{capacity:3},{capacity:'3'}]}),3);
});
test('completion requires a past China date, one-decimal duration, integer quantity and certificate',()=>{
 const c={requestId:'12345678-1234-4234-8234-123456789012',date:'2026-11-10',duration:'1.5',quantity:2,photoId:'12345678-1234-4234-8234-123456789012'},now=Date.parse('2026-11-09T16:05:00Z');
 assert.equal(normalizeCompletionRegistration(c,now).duration,1.5);
 for(const patch of [{date:'2026-11-11'},{duration:1.25},{duration:0},{quantity:1.5},{photoId:''},{accountId:'someone-else'}])assert.throws(()=>normalizeCompletionRegistration({...c,...patch},now));
});
