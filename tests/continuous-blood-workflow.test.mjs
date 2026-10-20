import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF} from '../lib/events/workflow.js';

function fixture(){
 let seq=0,time=Date.parse('2026-10-12T10:00:00+08:00');
 const source=id=>({_id:id,日期:'2026-10-12',点位:'新街口中央',活动时间:'上午 11~15点',周次:46});
 const tables={...Object.fromEntries(Object.values(WF).map(name=>[name,[]])),source:[source('seat-a'),source('seat-b')],'市血液献血车排班表（模板表）':[{序号:'周一',点位:'新街口中央',活动时间:'上午 11~15点',姓名:'不应返回的个人信息',邮箱:'private@example.test'}]};
 const base={getMetadata:async()=>({tables:Object.keys(tables).map(name=>({name,columns:name==='source'?['网站报名ID','网站账号ID'].map(name=>({name,type:'text'})):[]}))}),listRows:async(table,_v,_o,_c,start=0,count=500)=>structuredClone((tables[table]||[]).slice(start,start+count)),getRow:async(table,id)=>structuredClone(tables[table].find(row=>row._id===id)),appendRow:async(table,row)=>{const saved={...row,_id:`continuous-${++seq}`};tables[table].push(saved);return {_id:saved._id};},updateRow:async(table,id,patch)=>Object.assign(tables[table].find(row=>row._id===id),patch)};
 const w=createWorkflow(base,{mode:'production',bloodSourceTable:'source',now:()=>time});
 const account=n=>({accountId:`person-${n}`,studentId:`99999000${n}`,realName:`合成${n}`,email:`99999000${n}@smail.nju.edu.cn`,emailVerified:true});
 return {w,base,tables,source,account,setTime:value=>{time=Date.parse(value);}};
}

test('continuous source slots, pending registrations and partial hours coexist without closing the project',async()=>{
 const f=fixture(),event=(await f.w.publicRead()).events[0];
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
 await f.w.post(firstEntry._id);assert.equal(Number(f.tables[WF.summaries][0].服务时长),1);
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
