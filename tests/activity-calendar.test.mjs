import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarEntries,calendarMonday,calendarAddDays,calendarWeekLayout} from '../public/app/shared/activity-calendar.js';
const row=(id,c={},extra={})=>({_id:id,活动ID:id,活动名称:id,组织类别:'生命中心',状态:'报名中',报名日期:'2026-11-15',报名页配置:JSON.stringify(c),...extra});
test('calendar weeks start Monday across month and year boundaries',()=>{assert.equal(calendarMonday('2026-11-01'),'2026-10-26');assert.equal(calendarAddDays('2026-12-31',1),'2027-01-01');});
test('grouped positions use their real dates and collapse parent/child duplication',()=>{
 const positions=[{start:'2026-11-15T16:00:00+08:00',end:'2026-11-15T17:30:00+08:00'},{start:'2026-11-15T16:00:00+08:00',end:'2026-11-15T18:00:00+08:00'}];
 const items=calendarEntries([row('parent',{positionDraft:{positions}}),row('child',{parentActivityId:'parent'}),row('registry',{longTerm:true})],'2026-11-01','2026-11-30');
 assert.equal(items.length,1);assert.equal(items[0].date,'2026-11-15');assert.equal(items[0].time,'16:00–18:00');assert.equal(items[0].positions,2);assert.equal(items[0].category,'生命中心');
});
test('multi-day spans are clipped to the visible period and recurring sessions are excluded',()=>{
 const items=calendarEntries([row('trip',{window:{start:'2026-10-30T10:00:00+08:00',end:'2026-11-02T18:00:00+08:00'}}),row('duty',{recurringDuty:true,ordinary:{start:'2026-11-03T09:00:00+08:00',end:'2026-11-03T12:00:00+08:00'}})],'2026-11-01','2026-11-03');
 assert.deepEqual(items.map(e=>e.date),['2026-11-01','2026-11-02']);
});


test('routine registries and blood shifts are excluded while fixed-date special schedules remain',()=>{
 const entries=calendarEntries([
  row('municipal',{blood:{mode:'blood_vehicle'}}),row('component',{special:{type:'component-donation'}}),row('province',{special:{type:'province-service'}}),row('legacy-blood',{}, {组织类别:'献血车专项'}),row('indefinite',{longTerm:true}),row('duty',{recurringDuty:true}),
  row('examination',{special:{type:'hospital-examination'}}),row('ordinary'),
 ],'2026-11-01','2026-11-30');
 assert.deepEqual(entries.map(e=>e.id),['examination','ordinary']);
});


test('consecutive dates form one weekly bar and split at week boundaries',()=>{
 const entries=calendarEntries([row('long',{window:{start:'2026-11-12T09:00:00+08:00',end:'2026-11-17T17:00:00+08:00'}})],'2026-11-01','2026-11-30');
 const first=calendarWeekLayout(entries,'2026-11-09'),second=calendarWeekLayout(entries,'2026-11-16');
 assert.equal(first.spans.length,1);assert.equal(first.spans[0].column,4);assert.equal(first.spans[0].length,4);assert.equal(first.spans[0].continuesAfter,true);assert.equal(first.singles.length,0);
 assert.equal(second.spans[0].column,1);assert.equal(second.spans[0].length,2);assert.equal(second.spans[0].continuesBefore,true);
});
test('date gaps and different categories are never bridged',()=>{
 const e=(id,date)=>({id,date,name:'相同名称',category:id});
 const layout=calendarWeekLayout([e('a','2026-11-09'),e('a','2026-11-11'),e('b','2026-11-12'),e('c','2026-11-13')],'2026-11-09');
 assert.equal(layout.spans.length,0);assert.equal(layout.singles.length,4);
});


test('same-title daily records and positions merge into one title-only two-day bar',()=>{
 const e=(id,date,name)=>({id,date,name,category:'主席团专项',region:'南京地区',time:'08:30–10:30'});
 const layout=calendarWeekLayout([e('a','2026-10-29','10.29 献血周志愿服务活动'),e('b','2026-10-29','献血周志愿服务活动'),e('c','2026-10-30','10.30 献血周志愿服务活动'),e('d','2026-10-30','献血周志愿服务活动')],'2026-10-26');
 assert.equal(layout.spans.length,1);assert.equal(layout.spans[0].length,2);assert.equal(layout.spans[0].name,'献血周志愿服务活动');assert.equal(layout.spans[0].items.length,4);assert.equal(layout.singles.length,0);
});
