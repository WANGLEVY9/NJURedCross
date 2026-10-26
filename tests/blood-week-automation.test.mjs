import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BLOOD_SOURCE_TABLE} from '../lib/events/blood-source.js';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {createBloodWeekStore} from '../lib/events/blood-week-store.js';
import {createActivityLifecycleStore} from '../lib/events/activity-lifecycle-store.js';
import {planBloodWeek} from '../lib/events/blood-week-automation.js';
import {registrationOpen} from '../public/app/shared/activity-management.js';
import {activityProjects,activityProjectKey} from '../public/app/shared/activity-projects.js';

const THIS_MONDAY='2026-10-19',NEXT_MONDAY='2026-10-26',TARGET_MONDAY='2026-11-02';
const NOW='2026-10-21T10:00:00+08:00'; // 周三：底表已有本周与下周，自动生成应落在下下周。
const source=(id,date,week,extra={})=>({_id:id,日期:`${date}T00:00:00+08:00`,点位:'新街口中央',活动时间:'上午 11~15点',周次:week,...extra});
function fixture({now=NOW,store=null,mode='test',lifecycle=null}={}){
 let n=0;const tables=Object.fromEntries(Object.values(WF).map(name=>[name,[]]));
 tables[BLOOD_SOURCE_TABLE]=[
  source('a1',THIS_MONDAY,46),source('a2',THIS_MONDAY,46,{点位:'仙林学则路',活动时间:'下午 14~18点'}),
  source('b1',NEXT_MONDAY,47),source('b2',NEXT_MONDAY,47,{点位:'仙林学则路',活动时间:'下午 14~18点'}),
 ];
 const writes=[];
 const base={async listRows(t,_v,_o,_c,s=0,l=500){return structuredClone((tables[t]||[]).slice(s,s+l));},
  async appendRow(t,row){writes.push(t);const created={...row,_id:`gen-${++n}`};tables[t].push(created);return {_id:created._id};},
  async updateRow(t,id,patch){writes.push(t);Object.assign(tables[t].find(row=>row._id===id),patch);}};
 return {tables,base,writes,w:createWorkflow(base,{now:()=>Date.parse(now),bloodSourceTable:BLOOD_SOURCE_TABLE,bloodWeekStore:store,mode,...(lifecycle?{activityLifecycleStore:lifecycle}:{})})};
}
async function storeFixture(options={}){
 const dir=await mkdtemp(join(tmpdir(),'blood-week-'));
 const store=createBloodWeekStore(join(dir,'blood-week.sqlite'));
 const f=fixture({...options,store});
 return {dir,store,...f};
}
const inWeek=(rows,monday)=>rows.filter(row=>String(row['日期']||'').slice(0,10)>=monday&&String(row['日期']||'').slice(0,10)<='2026-11-08');

test('next week plan skips the two weeks already in the source table',()=>{
 const f=fixture();
 const plan=planBloodWeek({rows:f.tables[BLOOD_SOURCE_TABLE],now:Date.parse(NOW)});
 assert.equal(plan.monday,TARGET_MONDAY);
 assert.equal(plan.sunday,'2026-11-08');
 assert.equal(plan.label,'11.2-11.8');
 assert.equal(plan.week,48);
 assert.equal(plan.template.monday,NEXT_MONDAY);
 assert.equal(plan.positions.length,2);
 assert.deepEqual([...new Set(plan.positions.map(row=>row['日期']))],[TARGET_MONDAY]);
 assert.deepEqual([...new Set(plan.positions.map(row=>row['周次']))],[48]);
 assert.deepEqual(f.writes,[]);
});

test('weekly positions keep the template structure and never copy participants',()=>{
 const f=fixture();
 f.tables[BLOOD_SOURCE_TABLE].push({...source('b3',NEXT_MONDAY,47),姓名:'旧志愿者',学号:'999990001',邮箱:'old@example.org',网站报名ID:'BS-old',报名结果:'成功'});
 f.tables[BLOOD_SOURCE_TABLE].push({...source('b4',NEXT_MONDAY,47),报名结果:'停点'});
 const plan=planBloodWeek({rows:f.tables[BLOOD_SOURCE_TABLE],now:Date.parse(NOW)});
 assert.equal(plan.positions.length,4);
 assert.equal(plan.positions.filter(row=>row['报名结果']==='停点').length,1);
 assert.equal(plan.positions.filter(row=>row['报名结果']==='可报名').length,3);
 for(const row of plan.positions)assert.deepEqual(Object.keys(row).sort(),['周次','报名结果','日期','活动时间','点位']);
 assert.equal(JSON.stringify(plan.positions).includes('旧志愿者'),false);
});

test('an explicit target week is honoured and a duplicated week is reported instead of rewritten',()=>{
 const f=fixture();
 const plan=planBloodWeek({rows:f.tables[BLOOD_SOURCE_TABLE],now:Date.parse(NOW),monday:'2026-11-09'});
 assert.equal(plan.monday,'2026-11-09');
 assert.equal(plan.week,49);
 assert.equal(plan.existing,0);
 const duplicated=planBloodWeek({rows:[...f.tables[BLOOD_SOURCE_TABLE],source('x','2026-11-09',49)],now:Date.parse(NOW),monday:'2026-11-09'});
 assert.equal(duplicated.existing,1);
 assert.equal(planBloodWeek({rows:f.tables[BLOOD_SOURCE_TABLE],now:Date.parse(NOW),monday:'2026-11-09'}).existing,0);
});

test('a source table already covering the target week is never extended automatically',()=>{
 const f=fixture();
 f.tables[BLOOD_SOURCE_TABLE].push(source('c1',TARGET_MONDAY,48),source('c2','2026-11-09',49));
 const plan=planBloodWeek({rows:f.tables[BLOOD_SOURCE_TABLE],now:Date.parse(NOW)});
 assert.equal(plan.monday,TARGET_MONDAY);
 assert.equal(plan.existing,1);
 assert.equal(plan.template.monday,NEXT_MONDAY);
 assert.deepEqual(f.writes,[]);
});

test('generation writes the whole week once and schedules publication for the configured Thursday',async t=>{
 const f=await storeFixture();t.after(async()=>{f.store.close();await rm(f.dir,{recursive:true,force:true});});
 const result=await f.w.generateBloodWeek({actor:'synthetic-admin'});
 assert.equal(result.monday,TARGET_MONDAY);
 assert.equal(result.rows,2);
 assert.equal(result.publishAt,'2026-10-22T09:00:00+08:00');
 assert.equal(inWeek(f.tables[BLOOD_SOURCE_TABLE],TARGET_MONDAY).length,2);
 assert.equal(f.writes.length,2);
 assert.deepEqual([...new Set(f.writes)],[BLOOD_SOURCE_TABLE]);
 assert.equal((await f.w.bloodWeekStatus()).weeks.find(week=>week.monday===TARGET_MONDAY).publishAt,'2026-10-22T09:00:00+08:00');
 const events=(await f.w.read()).events.filter(row=>row['报名日期']===TARGET_MONDAY);
 assert.equal(events.length,2);
 for(const event of events){
  assert.equal(JSON.parse(event['报名页配置']).publishAt,'2026-10-22T09:00:00+08:00');
  assert.equal(registrationOpen(event,Date.parse('2026-10-22T08:59:59+08:00')),false);
  assert.equal(registrationOpen(event,Date.parse('2026-10-22T09:00:00+08:00')),true);
 }
 await assert.rejects(f.w.generateBloodWeek({actor:'synthetic-admin',monday:TARGET_MONDAY}),error=>error.statusCode===409&&error.code==='blood_week_exists');
 assert.equal(inWeek(f.tables[BLOOD_SOURCE_TABLE],TARGET_MONDAY).length,2);
});

test('weekly projects group by date range instead of by month',async t=>{
 const f=await storeFixture();t.after(async()=>{f.store.close();await rm(f.dir,{recursive:true,force:true});});
 await f.w.generateBloodWeek({actor:'synthetic-admin',publishAt:null});
 const events=(await f.w.read()).events;
 const project=activityProjects(events).find(item=>activityProjectKey(item)==='blood:2026-11-02');
 assert.equal(project.projectName,'11.2-11.8 市血液献血车志愿服务活动');
 assert.equal(project.sessions.length,2);
 const thisWeek=activityProjects(events).find(item=>activityProjectKey(item)==='blood:2026-10-19');
 assert.equal(thisWeek.projectName,'10.19-10.25 市血液献血车志愿服务活动');
 assert.equal(activityProjects(events).filter(item=>String(item.projectName).includes('献血车')).length,3);
});

test('a weekly project without its own decision inherits the previous monthly switch',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'blood-week-lifecycle-'));
 const lifecycle=createActivityLifecycleStore(join(dir,'lifecycle.sqlite'));
 const f=fixture({lifecycle});
 t.after(async()=>{lifecycle.close();await rm(dir,{recursive:true,force:true});});
 const before=(await f.w.read()).events.filter(row=>row['报名日期']===NEXT_MONDAY);
 assert.equal(JSON.parse(before[0]['报名页配置']).sourceRegistration.enabled,true);
 lifecycle.setRegistration('blood:2026-10',{enabled:false,revision:0,actor:'synthetic-admin',at:'2026-10-01T00:00:00.000Z'});
 const after=(await f.w.read()).events.filter(row=>row['报名日期']===NEXT_MONDAY);
 assert.equal(JSON.parse(after[0]['报名页配置']).sourceRegistration.enabled,false);
 assert.equal(after[0]['状态'],'进行中');
});

test('management can override or cancel a week publication time',async t=>{
 const f=await storeFixture();t.after(async()=>{f.store.close();await rm(f.dir,{recursive:true,force:true});});
 const generated=await f.w.generateBloodWeek({actor:'synthetic-admin'});
 assert.equal(generated.publishAt,'2026-10-22T09:00:00+08:00');
 const moved=await f.w.bloodWeekPublish({monday:TARGET_MONDAY,publishAt:'2026-10-25T09:00:00+08:00',actor:'synthetic-admin'});
 assert.equal(moved.publishAt,'2026-10-25T09:00:00+08:00');
 let event=(await f.w.read()).events.find(row=>row['报名日期']===TARGET_MONDAY);
 assert.equal(registrationOpen(event,Date.parse('2026-10-25T08:59:00+08:00')),false);
 const opened=await f.w.bloodWeekPublish({monday:TARGET_MONDAY,publishAt:null,actor:'synthetic-admin'});
 assert.equal(opened.publishAt,null);
 event=(await f.w.read()).events.find(row=>row['报名日期']===TARGET_MONDAY);
 assert.equal(registrationOpen(event,Date.parse('2026-10-21T10:00:01+08:00')),true);
 await assert.rejects(f.w.bloodWeekPublish({monday:'2026-11-03',publishAt:null}),{statusCode:400});
 await assert.rejects(f.w.bloodWeekPublish({monday:TARGET_MONDAY,publishAt:'2026-10-20T09:00:00+08:00'}),{statusCode:400});
});

test('scheduled automation runs once per week and only on the configured weekday and time',async t=>{
 const f=await storeFixture();t.after(async()=>{f.store.close();await rm(f.dir,{recursive:true,force:true});});
 const run=await f.w.runBloodWeekAutomation({actor:'automation'});
 assert.equal(run.ran,true);
 assert.equal(run.result.monday,TARGET_MONDAY);
 assert.equal(run.result.rows,2);
 const status=await f.w.bloodWeekStatus();
 assert.equal(status.weeks.find(week=>week.monday===TARGET_MONDAY).sessions,2);
 // 同一周内再次触发不再写入；已存在也视为本周完成。
 const again=await f.w.runBloodWeekAutomation({actor:'automation'});
 assert.equal(again.ran,false);
 assert.equal(again.reason,'already-run');
 assert.equal(inWeek(f.tables[BLOOD_SOURCE_TABLE],TARGET_MONDAY).length,2);
});

test('disabled or mistimed automation never writes to the source table',async t=>{
 const f=await storeFixture();t.after(async()=>{f.store.close();await rm(f.dir,{recursive:true,force:true});});
 await f.w.bloodWeekSettings({generateHour:23});
 assert.deepEqual(await f.w.runBloodWeekAutomation({actor:'automation'}),{ran:false,reason:'too-early'});
 await f.w.bloodWeekSettings({generateHour:9,generateWeekday:2});
 assert.deepEqual(await f.w.runBloodWeekAutomation({actor:'automation'}),{ran:false,reason:'not-scheduled'});
 await f.w.bloodWeekSettings({autoGenerate:false,generateWeekday:3});
 assert.deepEqual(await f.w.runBloodWeekAutomation({actor:'automation'}),{ran:false,reason:'disabled'});
 assert.deepEqual(f.writes,[]);
 await assert.rejects(f.w.bloodWeekSettings({generateWeekday:9}),{statusCode:400});
 await assert.rejects(f.w.bloodWeekSettings({publishHour:24}),{statusCode:400});
});

test('publishing can be turned off, after which a generated week opens immediately',async t=>{
 const f=await storeFixture();t.after(async()=>{f.store.close();await rm(f.dir,{recursive:true,force:true});});
 await f.w.bloodWeekSettings({autoPublish:false});
 const result=await f.w.generateBloodWeek({actor:'synthetic-admin'});
 assert.equal(result.publishAt,null);
 const event=(await f.w.read()).events.find(row=>row['报名日期']===TARGET_MONDAY);
 assert.equal(registrationOpen(event,Date.parse(NOW)),true);
});

test('a week generated from a stopped template keeps its stopped shifts',async t=>{
 const f=await storeFixture();t.after(async()=>{f.store.close();await rm(f.dir,{recursive:true,force:true});});
 for(const row of f.tables[BLOOD_SOURCE_TABLE])if(String(row['日期']).startsWith(NEXT_MONDAY))row['报名结果']='停点';
 const result=await f.w.generateBloodWeek({actor:'synthetic-admin'});
 assert.equal(result.rows,2);
 const events=(await f.w.read()).events.filter(row=>row['报名日期']===TARGET_MONDAY);
 assert.ok(events.every(row=>row['状态']==='停点'));
});
