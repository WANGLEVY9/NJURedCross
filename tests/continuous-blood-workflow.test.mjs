import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {createHoursPostingStore} from '../lib/events/hours-posting-store.js';
import {HOURS_POSTING_TABLES as T} from '../lib/events/hours-posting.js';

function fixture({posting=false}={}){
 let seq=0,time=Date.parse('2026-10-12T10:00:00+08:00');
 const source=id=>({_id:id,日期:'2026-10-12',点位:'新街口中央',活动时间:'上午 11~15点',周次:46});
 const tables={...Object.fromEntries(Object.values(WF).map(name=>[name,[]])),source:[source('seat-a'),source('seat-b')],'市血液献血车排班表（模板表）':[{序号:'周一',点位:'新街口中央',活动时间:'上午 11~15点',姓名:'不应返回的个人信息',邮箱:'private@example.test'}]};
 const postingStore=posting?createHoursPostingStore():null;if(posting)tables[T.legacy]=[];
 const base={getMetadata:async()=>({tables:Object.keys(tables).map(name=>({name,columns:name==='source'?['网站报名ID','网站账号ID'].map(name=>({name,type:'text'})):name===T.legacy?[{name:'活动ID',type:'text'}]:[]}))}),listRows:async(table,_v,_o,_c,start=0,count=500)=>structuredClone((tables[table]||[]).slice(start,start+count)),getRow:async(table,id)=>structuredClone(tables[table].find(row=>row._id===id)),appendRow:async(table,row)=>{const saved={...row,_id:`continuous-${++seq}`};tables[table].push(saved);return {_id:saved._id};},updateRow:async(table,id,patch)=>Object.assign(tables[table].find(row=>row._id===id),patch)};
 const w=createWorkflow(base,{mode:'production',bloodSourceTable:'source',hoursPostingStore:postingStore,now:()=>time});
 const account=n=>({accountId:`person-${n}`,studentId:`99999000${n}`,realName:`合成${n}`,email:`99999000${n}@smail.nju.edu.cn`,emailVerified:true});
 return {w,base,tables,source,account,postingStore,setTime:value=>{time=Date.parse(value);}};
}

for(const posting of [false,true])test(`continuous source slots, pending registrations and partial hours coexist without closing the project (${posting?'two-summary posting':'legacy guard'})`,async t=>{
 const f=fixture({posting});t.after(()=>f.postingStore?.close());const event=(await f.w.publicRead()).events[0];
 const a=await f.w.register(event._id,f.account(1)),b=await f.w.register(event._id,f.account(2));
 await f.w.confirm(a._id);await f.w.confirm(b._id);
 f.setTime('2026-10-12T12:00:00+08:00');
 for(const [i,row]of [a,b].entries())await f.w.submitAttendance(row.报名ID,f.account(i+1),`${i+1}0000000-0000-4000-8000-000000000000`);
 const first=await f.w.attendanceBatch(event._id,[{id:a._id,hours:{serviceHours:1,trainingHours:0,travelHours:0,work:'第一批服务'}}],'recorder');
 assert.equal(first.succeeded,1);
 const firstEntry=structuredClone(f.tables[WF.ledger][0]);assert.match(firstEntry.来源摘要,/^v4:/);
 assert.equal(f.tables[WF.registrations].find(row=>row._id===b._id).报名状态,'已确认');
 // Increase source capacity after hours were recorded; do not rewrite participants.
 f.tables.source.push(f.source('seat-c'),{...f.source('next-day'),日期:'2026-10-13'});
 const expanded=(await f.w.publicRead()).events.find(row=>row._id===event._id);
 assert.equal(expanded.容量,3);assert.equal(expanded._id,event._id);
 const next=(await f.w.publicRead()).events.find(row=>row.报名日期==='2026-10-13');
 const pending=await f.w.register(next._id,f.account(3));
 const parallel=await Promise.all([f.w.approveBatch(event._id,[{id:firstEntry._id,expectedDigest:firstEntry.核对摘要}],'reviewer','platform_admin'),f.w.confirm(pending._id)]);
 assert.equal(parallel[0].succeeded,1);
 assert.equal((await f.w.exportDraft(event._id)).rows.length,1);
 assert.equal(f.tables[WF.registrations].find(row=>row._id===pending._id).报名状态,'已确认');
 const second=await f.w.attendanceBatch(event._id,[{id:b._id,hours:{serviceHours:2,trainingHours:0,travelHours:0,work:'第二批服务'}}],'recorder');
 assert.equal(second.succeeded,1);
 const approved=structuredClone(f.tables[WF.ledger].find(row=>row._id===firstEntry._id));
 // Removing an unused seat is also capacity-only; verified evidence stays valid.
 f.tables.source=f.tables.source.filter(row=>row._id!=='seat-c');
 const review=await f.w.reviewDraft(event._id);assert.equal(review.entries.length,2);
 const secondEntry=review.entries.find(row=>row.报名行ID===b._id);
 assert.equal((await f.w.approveBatch(event._id,[{id:secondEntry._id,expectedDigest:secondEntry.核对摘要}],'reviewer','platform_admin')).succeeded,1);
 assert.deepEqual(f.tables[WF.ledger].find(row=>row._id===firstEntry._id),approved);
 assert.equal((await f.w.exportDraft(event._id)).rows.length,2);
 if(posting){
  await f.w.post(firstEntry._id);
  const summaries=()=>f.tables[WF.summaries].map(row=>[row.学号,Number(row.服务时长)]).sort();
  assert.deepEqual(summaries(),[[f.account(1).studentId,1],[f.account(2).studentId,2]]);
  assert.deepEqual(f.tables[T.legacy].map(row=>[row.学号,Number(row.志愿时长)]).sort(),summaries());
  assert.equal(f.tables[WF.profiles].length,0);
  assert.equal((await f.w.publicRead()).events.find(row=>row._id===event._id).状态,'进行中');
  await f.w.post(firstEntry._id);await f.w.synchronizeHours({manual:true});
  assert.deepEqual(summaries(),[[f.account(1).studentId,1],[f.account(2).studentId,2]]);
  assert.deepEqual(f.tables[T.legacy].map(row=>[row.学号,Number(row.志愿时长)]).sort(),summaries());
  assert.equal(f.tables[WF.profiles].length,0);
 }else{
  // Preserve main's fail-closed contract when production posting is unconfigured.
  await assert.rejects(f.w.post(firstEntry._id),{statusCode:503});
  assert.equal(f.tables[WF.summaries].length,0);
 }

});

test('template entry is read-only, lists only schedule fields and uses the existing source adapter',async()=>{
 const f=fixture(),before=structuredClone(f.tables);
 const result=await f.w.bloodScheduleSource();
 assert.equal(result.sourceTable,'source');assert.equal(result.sessionCount,1);assert.equal(result.capacity,2);assert.equal(result.writes,false);
 assert.deepEqual(Object.keys(result.templateRows[0]),['序号','点位','活动时间']);
 assert.equal(JSON.stringify(result).includes('private@example.test'),false);
 assert.deepEqual(f.tables,before);
 delete f.tables['市血液献血车排班表（模板表）'];
 assert.equal((await f.w.bloodScheduleSource()).templateAvailable,false);
});

test('missing source linkage columns stop before creating a pending website registration',async()=>{
 const f=fixture(),event=(await f.w.publicRead()).events[0];
 f.base.getMetadata=async()=>({tables:[{name:'source',columns:[]}]});
 await assert.rejects(f.w.register(event._id,f.account(1)),{statusCode:503,code:'blood_booking_schema_required'});
 assert.deepEqual(f.tables[WF.registrations],[]);
 assert.ok(f.tables.source.every(row=>!row.网站报名ID));
 assert.deepEqual((await f.w.bloodScheduleSource()).missingBookingColumns,['网站报名ID','网站账号ID']);
});

test('capacity-independent hours still reject changed attendance evidence and changed review details',async()=>{
 const f=fixture(),event=(await f.w.publicRead()).events[0],row=await f.w.register(event._id,f.account(1));
 await f.w.confirm(row._id);f.setTime('2026-10-12T12:00:00+08:00');
 await f.w.submitAttendance(row.报名ID,f.account(1),'10000000-0000-4000-8000-000000000000');
 await f.w.attendanceBatch(event._id,[{id:row._id,hours:{serviceHours:1,trainingHours:0,travelHours:0,work:'合成服务'}}],'recorder');
 const check=f.tables[WF.checkins][0],old=check.核验说明;check.核验说明='被修改的依据';
 await assert.rejects(f.w.reviewDraft(event._id),/源记录已改变/);check.核验说明=old;
 f.tables[WF.ledger][0].具体工作地点='被篡改的地点';
 await assert.rejects(f.w.reviewDraft(event._id),/核定时长或工作内容已改变/);
});

test('clock-ended generated sessions retain their pending review queue but never reopen signup',async()=>{
 const f=fixture(),event=(await f.w.publicRead()).events[0],row=await f.w.register(event._id,f.account(1));
 f.setTime('2026-10-12T16:00:00+08:00');
 await f.w.confirm(row._id);await f.w.confirm(row._id);
 assert.equal(f.tables[WF.registrations][0].报名状态,'已确认');
 await assert.rejects(f.w.register(event._id,f.account(2)),{statusCode:409});
 assert.equal((await f.w.publicRead()).events[0].状态,'已结束');
});


test('clock-ended blood shifts accept late evidence until final weekly archive and keep a frozen export',async()=>{
 const f=fixture(),event=(await f.w.publicRead()).events[0];
 const registration=await f.w.register(event._id,f.account(1));await f.w.confirm(registration._id);
 await assert.rejects(f.w.submitAttendance(registration.报名ID,f.account(1),'10000000-0000-4000-8000-000000000000'),{statusCode:409});
 f.setTime('2026-10-12T16:00:00+08:00');
 const expired=(await f.w.publicRead()).events.find(e=>e._id===event._id);assert.equal(expired.状态,'已结束');
 assert.equal(f.w.attendanceOpen(expired,[expired]),true);
 await assert.rejects(f.w.archiveBloodWeek(event._id,'reviewer'),{statusCode:409});
 await f.w.submitAttendance(registration.报名ID,f.account(1),'10000000-0000-4000-8000-000000000000');
 const recorded=await f.w.attendanceBatch(event._id,[{id:registration._id,hours:{serviceHours:2,trainingHours:0,travelHours:0,work:'完整服务'}}],'recorder');assert.equal(recorded.succeeded,1);
 await assert.rejects(f.w.archiveBloodWeek(event._id,'reviewer'),{statusCode:409});
 const entry=f.tables[WF.ledger][0];assert.equal((await f.w.approveBatch(event._id,[{id:entry._id,expectedDigest:entry.核对摘要}],'reviewer','platform_admin')).succeeded,1);
 assert.equal((await f.w.archiveBloodWeek(event._id,'reviewer')).archived,true);
 const frozen=await f.w.exportDraft(event._id);assert.equal(frozen.rows[0].服务时长,2);
 assert.equal((await f.w.reviewDraft(event._id)).entries.length,1);
 assert.equal((await f.w.catalog()).events.find(e=>e._id===event._id).状态,'已结束');
 assert.ok(JSON.parse((await f.w.catalog()).events.find(e=>e._id===event._id).报名页配置).bloodWeekArchive);
 assert.equal(f.w.attendanceOpen((await f.w.publicRead()).events.find(e=>e._id===event._id),[]),false);
 await assert.rejects(f.w.checkin(registration._id,'recorder','late'),{statusCode:409});
 assert.equal((await f.w.archiveBloodWeek(event._id,'reviewer')).archived,true);
 f.tables[WF.ledger][0].服务时长=99;
 assert.equal((await f.w.exportDraft(event._id)).rows[0].服务时长,2);
 f.tables.source=[];assert.ok((await f.w.catalog()).events.some(e=>e._id===event._id));assert.equal((await f.w.exportDraft(event._id)).rows[0].服务时长,2);
});

test('manager supplement saves evidence without approving attendance or hours',async()=>{
 const f=fixture(),event=(await f.w.publicRead()).events[0],row=await f.w.register(event._id,f.account(1));await f.w.confirm(row._id);
 await assert.rejects(f.w.supplementAttendance(row._id,'recorder','20000000-0000-4000-8000-000000000000'),{statusCode:409});
 f.setTime('2026-10-12T16:00:00+08:00');await f.w.supplementAttendance(row._id,'recorder','20000000-0000-4000-8000-000000000000');
 assert.equal(f.tables[WF.registrations][0].报名状态,'已确认');assert.equal(f.tables[WF.ledger].length,0);assert.equal(f.tables[WF.checkins].length,0);
 await assert.rejects(f.w.supplementAttendance(row._id,'recorder','30000000-0000-4000-8000-000000000000'),{statusCode:409});
});


test('blood registration closes exactly at shift start while attendance remains open',async()=>{
 const f=fixture(),event=(await f.w.publicRead()).events[0];
 f.setTime('2026-10-12T10:59:59+08:00');assert.equal((await f.w.publicRead()).events[0].状态,'报名中');
 f.setTime('2026-10-12T11:00:00+08:00');const started=(await f.w.publicRead()).events[0];assert.equal(started.状态,'进行中');
 await assert.rejects(f.w.register(event._id,f.account(1)),{statusCode:409});assert.equal(f.w.attendanceOpen(started,[started]),true);
});


test('no-show registration requires a reason, is reversible and never fabricates checkin evidence',async()=>{
 const f=fixture(),event=(await f.w.publicRead()).events[0];
 const a=await f.w.register(event._id,f.account(1)),b=await f.w.register(event._id,f.account(2));await f.w.confirm(a._id);await f.w.confirm(b._id);
 await assert.rejects(f.w.markBloodAbsence(b._id,'recorder','未到场'),{statusCode:409});
 f.setTime('2026-10-12T16:00:00+08:00');
 await assert.rejects(f.w.markBloodAbsence(b._id,'recorder',''),{statusCode:400});
 await f.w.markBloodAbsence(b._id,'recorder','已联系核实未到场');
 await assert.rejects(f.w.submitAttendance(b.报名ID,f.account(2),'20000000-0000-4000-8000-000000000000'),{statusCode:409});
 assert.equal(f.tables[WF.checkins].length,0);assert.equal(f.tables[WF.ledger].length,0);
 await f.w.markBloodAbsence(b._id,'recorder',null);assert.equal((await f.w.read()).events[0].bloodAbsences[b._id],undefined);
 await f.w.markBloodAbsence(b._id,'recorder','已联系核实未到场');
 await f.w.submitAttendance(a.报名ID,f.account(1),'10000000-0000-4000-8000-000000000000');
 assert.equal((await f.w.attendanceBatch(event._id,[{id:a._id,hours:{serviceHours:2,trainingHours:0,travelHours:0,work:'实际服务'}}],'recorder')).succeeded,1);
 const entry=f.tables[WF.ledger][0];await f.w.approveBatch(event._id,[{id:entry._id,expectedDigest:entry.核对摘要}],'reviewer','platform_admin');
 assert.equal((await f.w.archiveBloodWeek(event._id,'reviewer')).archived,true);
 await assert.rejects(f.w.markBloodAbsence(b._id,'recorder',null),{statusCode:409});
});
