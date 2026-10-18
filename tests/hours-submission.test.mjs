import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {createHoursSubmissionStore} from '../lib/events/hours-submission-store.js';
import {hoursReadiness} from '../public/app/shared/hours-submission.js';
import {activityStage} from '../public/app/shared/activity-stage.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';

async function fixture(options={}){
 let seq=0;const rows=Object.fromEntries(Object.values(WF).map(table=>[table,[]]));
 const base={listRows:async(t,_v,_o,_c,start=0,limit=500)=>structuredClone(rows[t].slice(start,start+limit)),appendRow:async(t,value)=>{const row={...value,_id:`synthetic-${++seq}`};rows[t].push(row);return {_id:row._id};},updateRow:async(t,id,patch)=>Object.assign(rows[t].find(row=>row._id===id),patch)};
 const w=createWorkflow(base,options),e=await w.create({name:'合成整表提交测试',date:'2026-10-01',slot:'09:00-11:00',capacity:4,serviceHours:2,trainingHours:0,travelHours:0,location:'合成场地',work:'合成服务'},'owner');
 await w.approve(e._id,'chair');await w.publish(e._id);const regs=[];
 for(let i=1;i<=2;i++){const sid=`99999000${i}`,row=await w.register(e._id,{accountId:`member-${i}`,studentId:sid,realName:`合成同学${i}`,email:`${sid}@smail.nju.edu.cn`,emailVerified:true});await w.confirm(row._id);regs.push(row);}
 return {w,rows,e,regs,base};
}

test('whole-sheet readiness excludes approved leave and refuses pending leave or incomplete attendance',()=>{
 const regs=[{_id:'one',报名状态:'已签到'},{_id:'two',报名状态:'已确认'},{_id:'leave',报名状态:'已请假',请假状态:'已批准'},{_id:'pending',报名状态:'已确认',请假状态:'待审批'}];
 const ledger=[{报名行ID:'one',状态:'待批准'}];
 const r=hoursReadiness(regs,ledger,{absences:{two:{reason:'合成缺席'}}});
 assert.equal(r.required.length,3);assert.equal(r.complete,2);assert.deepEqual(r.pending.map(row=>row._id),['pending']);
 assert.equal(hoursReadiness(regs,[...ledger,...ledger],{}).pending.length,3);
});

test('complete roster submission locks attendance and owner edits, return unlocks, approval and finish remain explicit',async()=>{
 const {w,rows,e,regs}=await fixture();
 assert.equal(rows[WF.events][0].岗位,'默认服务岗');
 await w.attendanceBatch(e._id,[{id:regs[0]._id,hours:{serviceHours:2}}],'checker');
 assert.equal(activityStage((await w.detail(e._id)).events[0],{ledger:rows[WF.ledger]}),'registering');
 await assert.rejects(w.submitHoursSheet(e._id,0,'owner'),/截止/);await w.close(e._id);
 await assert.rejects(w.submitHoursSheet(e._id,0,'owner'),/1 人未处理/);
 let state=await w.markHoursAbsence(e._id,regs[1]._id,'未到场',0,'owner');
 assert.equal(state.revision,1);
 state=await w.submitHoursSheet(e._id,1,'owner');assert.equal(state.phase,'submitted');
 assert.equal(activityStage((await w.detail(e._id)).events[0]),'hours');
 const before=structuredClone(rows),entry=rows[WF.ledger][0];
 await assert.rejects(w.reviewHours(regs[0]._id,'checker',{serviceHours:1,expectedDigest:entry.核对摘要}),/已提交/);
 await assert.rejects(w.checkin(regs[1]._id,'checker'),/已提交/);
 await assert.rejects(w.markHoursAbsence(e._id,regs[1]._id,null,2,'owner'),/不能修改/);
 await assert.rejects(w.finish(e._id,'chair'),/完成审核/);assert.deepEqual(rows,before);
 await assert.rejects(w.returnHoursSheet(e._id,1,'核对时长','chair'),/已变化/);
 state=await w.returnHoursSheet(e._id,2,'核对时长','chair');assert.equal(state.phase,'returned');
 assert.equal(activityStage((await w.detail(e._id)).events[0]),'running');
 await assert.rejects(w.approveHours(entry._id,'chair'),/已退回或尚未提交/);
 await w.reviewHours(regs[0]._id,'checker',{serviceHours:1,expectedDigest:entry.核对摘要});
 state=await w.markHoursAbsence(e._id,regs[1]._id,null,3,'owner');
 await assert.rejects(w.submitHoursSheet(e._id,state.revision,'owner'),/1 人未处理/);
 state=await w.markHoursAbsence(e._id,regs[1]._id,'再次核实未到场',state.revision,'owner');
 state=await w.submitHoursSheet(e._id,state.revision,'owner');
 await w.approveHours(entry._id,'chair');assert.equal(rows[WF.events][0].状态,'进行中');
 await w.finish(e._id,'chair');assert.equal(rows[WF.events][0].状态,'已结束');
 await assert.rejects(w.returnHoursSheet(e._id,state.revision,'重新核对','chair'),/仅审核中/);
});

test('submission verifies fresh ledger evidence before changing whole-sheet state',async()=>{
 const {w,rows,e,regs}=await fixture();await w.close(e._id);
 await w.attendanceBatch(e._id,regs.map(row=>({id:row._id,hours:{serviceHours:2}})),'checker');
 rows[WF.ledger][0].服务时长=9;
 await assert.rejects(w.submitHoursSheet(e._id,0,'owner'),/改变/);
 assert.equal((await w.hoursSubmissionStatus(e._id)).current.revision,0);
});

test('production core cannot approve before whole-sheet submission, and fully excused rosters can still close',async()=>{
 const {w,rows,e,regs}=await fixture({mode:'production'});
 await w.attendanceBatch(e._id,regs.map(row=>({id:row._id,hours:{serviceHours:2}})),'checker');
 await assert.rejects(w.approveHours(rows[WF.ledger][0]._id,'chair'),/尚未提交/);
 const empty=await fixture();
 for(const row of empty.rows[WF.registrations])Object.assign(row,{报名状态:'已请假',请假状态:'已批准'});
 await empty.w.close(empty.e._id);await empty.w.submitHoursSheet(empty.e._id,0,'owner');
 await empty.w.finish(empty.e._id,'chair');assert.equal(empty.rows[WF.events][0].状态,'已结束');
});

test('private submission state survives restart, rejects concurrent stale edits and fails closed on corrupt JSON',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'synthetic-hours-sheet-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'review.json');
 const store=createHoursSubmissionStore(path),key='event:synthetic';
 const results=await Promise.allSettled([store.update(key,0,c=>({...c,phase:'submitted'})),store.update(key,0,c=>({...c,phase:'returned'}))]);
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
 const restarted=createHoursSubmissionStore(path);assert.equal((await restarted.read())[key].phase,'submitted');
 const saved=await readFile(path,'utf8');assert.equal(JSON.parse(saved)[key].revision,1);
 await writeFile(path,'{"broken":');await assert.rejects(restarted.read(),{statusCode:503});
 await assert.rejects(restarted.update(key,1,c=>c),{statusCode:503});
 await writeFile(path,saved);await rm(path);await assert.rejects(restarted.read(),{statusCode:503});
 const afterLoss=createHoursSubmissionStore(path);
 await assert.rejects(afterLoss.read(),{statusCode:503});
 await assert.rejects(afterLoss.update(key,0,c=>({...c,phase:'draft'})),{statusCode:503});
 assert.equal(await readFile(`${path}.initialized`,'utf8'),'initialized-v1\n');
 await assert.rejects(readFile(path),{code:'ENOENT'});
});

test('private initialization supports new installs, adopts existing JSON and retains committed state after an interrupted replacement',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'synthetic-hours-bootstrap-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'review.json'),key='event:synthetic-private-identity';
 const fresh=createHoursSubmissionStore(path);assert.deepEqual(await fresh.read(),{});
 // A crash after empty bootstrap but before the first operational commit is safe
 // to resume. The marker carries no identity, absence reason or other row data.
 await writeFile(path,'{}\n',{mode:0o600});await writeFile(`${path}.initialized`,'initialized-v1\n',{mode:0o600});
 const resumed=createHoursSubmissionStore(path);assert.deepEqual(await resumed.read(),{});
 await resumed.update(key,0,c=>({...c,phase:'submitted',absences:{private:{reason:'合成私有缺席说明'}}}));
 const committed=await readFile(path,'utf8');
 await writeFile(`${path}.interrupted.tmp`,'{"partial":');
 assert.deepEqual(await createHoursSubmissionStore(path).read(),JSON.parse(committed));
 assert.equal(await readFile(`${path}.initialized`,'utf8'),'initialized-v1\n');
 if(process.platform!=='win32'){
  assert.equal((await stat(path)).mode&0o777,0o600);
  assert.equal((await stat(`${path}.initialized`)).mode&0o777,0o600);
 }
 // Upgrade an existing store that predates the marker before serving its state.
 await rm(`${path}.initialized`);
 assert.deepEqual(await createHoursSubmissionStore(path).read(),JSON.parse(committed));
 assert.equal(await readFile(`${path}.initialized`,'utf8'),'initialized-v1\n');
 await rm(path);await assert.rejects(createHoursSubmissionStore(path).read(),{statusCode:503});
});

test('finish validates all approved and posted entries against current sources before writing any result',async t=>{
 const cases=[
  ['approved ledger changed',false,rows=>{rows[WF.ledger][1].服务时长=9;}],
  ['attendance evidence changed',false,rows=>{rows[WF.checkins][1].核验说明='外部修改签到依据';}],
  ['attendance evidence removed',false,rows=>{rows[WF.checkins].pop();}],
  ['posted ledger changed',true,rows=>{rows[WF.ledger][1].服务时长=9;}],
 ];
 for(const [name,post,mutate] of cases)await t.test(name,async()=>{
  const {w,rows,e,regs}=await fixture();await w.close(e._id);
  const attendance=await w.attendanceBatch(e._id,regs.map(row=>({id:row._id,hours:{serviceHours:2}})),'checker');assert.equal(attendance.failed,0);
  await w.submitHoursSheet(e._id,0,'owner');
  for(const entry of rows[WF.ledger])await w.approveHours(entry._id,'chair');
  if(post)for(const entry of rows[WF.ledger])await w.post(entry._id);
  const valid=structuredClone(rows);mutate(rows);const changed=structuredClone(rows);
  await assert.rejects(w.finish(e._id,'chair'),error=>[404,409].includes(error.statusCode)&&/改变|签到|不一致/.test(error.message));
  assert.deepEqual(rows,changed,'failed finish must not change event, ledger or mirror tables');
  Object.assign(rows,valid);await w.finish(e._id,'chair');
  assert.equal(rows[WF.events][0].状态,'已结束');
 });
});

test('private state failure blocks console mutations without taking down public activity reads',async()=>{
 const {base}=await fixture();const broken=createWorkflow(base,{hoursSubmissionStore:{read:async()=>{throw Object.assign(new Error('合成私有状态损坏'),{statusCode:503});}}});
 const publicData=await broken.publicRead();assert.ok(publicData.events.length);assert.ok(publicData.events.every(row=>!row.hoursSubmission));
 await assert.rejects(broken.catalog(),{statusCode:503});
});

test('HTTP review requires designation and whole-sheet submission; owner may submit but cannot return or approve',async()=>{
 const {w,e,regs}=await fixture();await w.close(e._id);await w.attendanceBatch(e._id,regs.map(row=>({id:row._id,hours:{serviceHours:2}})),'checker');
 let actor='owner',role='platform_admin',body={revision:0};const denied=()=>Object.assign(new Error('仅指定审核人'),{statusCode:403});
 const ctx={getWorkflow:async()=>w,requireConsoleAccess:()=>({username:actor,role}),requireCsrf:()=>true,actor:s=>s.username,readJson:async()=>body,audit:async()=>{},json:(_res,status,payload)=>({status,payload}),approvalRouting:{assertReviewer:async(_e,id)=>{if(id!=='chair')throw denied();}}};
 const call=action=>workflowRoutes({method:'POST',headers:{host:'localhost',origin:'http://localhost'}},null,new URL(`http://localhost/api/volunteer/workflow/events/${e._id}/${action}`),ctx);
 body={items:[]};await assert.rejects(call('hours-approve'),{statusCode:403});
 actor='chair';await assert.rejects(call('hours-approve'),{statusCode:409});
 actor='owner';body={revision:0};assert.equal((await call('submit-hours')).status,200);
 role='super_admin';body={items:[]};await assert.rejects(call('hours-approve'),{statusCode:403});role='platform_admin';
 body={revision:1,reason:'重新核实'};await assert.rejects(call('return-hours'),{statusCode:403});
 actor='chair';assert.equal((await call('return-hours')).status,200);
});
