import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,workflowEventApproved,workflowApprovalHash} from '../lib/events/workflow.js';
import {ORDINARY_GROUP_TABLE} from '../lib/events/ordinary-groups.js';

const input={name:'合成定时活动',center:'生命中心',bookingMode:'unified',window:{start:'2030-10-29T08:00:01',end:'2030-10-29T18:00:00'},capacity:5,serviceHours:2,trainingHours:0,travelHours:0,location:'合成地点',work:'合成服务'};
const account={accountId:'synthetic',studentId:'999990001',realName:'合成同学',email:'999990001@smail.nju.edu.cn',emailVerified:true,campus:'鼓楼'};
const config=e=>JSON.parse(e['报名页配置']);
function replaceConfig(event,c){event['报名页配置']=JSON.stringify(c);event['批准摘要']=workflowApprovalHash(event);}

test('group publish and cancellation use the injected clock even before wall time, with inclusive deadline',async()=>{
 let time=Date.parse('2000-10-26T00:00:00+08:00');
 const f=await fixture({options:{now:()=>time},body:{bookingMode:'grouped',window:{start:'2000-10-29T08:00:00',end:'2000-10-29T18:00:00'}}});
 const detail=await f.w.detail(f.event._id);
 await f.w.configurePositions(f.event._id,{token:detail.events[0].positionToken,deadline:'2000-10-28T00:00:00',positions:[{start:'2000-10-29T09:00:00',end:'2000-10-29T10:00:00',name:'合成岗位',location:'合成地点',capacity:5,campus:'鼓楼'}]},'owner');
 await f.w.schedulePublication(f.event._id,'2000-10-27T00:00:13+08:00');
 await f.w.schedulePublication(f.event._id,null);
 assert.ok(f.tables[WF.events].every(e=>e['状态']==='可发布'&&!config(e).publishAt&&workflowEventApproved(e)));
 await f.w.schedulePublication(f.event._id,'2000-10-27T00:00:13+08:00');
 time=Date.parse('2000-10-27T00:00:13+08:00');
 await assert.rejects(f.w.schedulePublication(f.event._id,null),{statusCode:409});
 await f.w.publish(f.event._id,{publishAt:null});
 time=Date.parse('2000-10-28T00:00:00+08:00');const before=structuredClone(f.tables);
 await assert.rejects(f.w.publish(f.event._id,{publishAt:null}),{statusCode:409});assert.deepEqual(f.tables,before);
});
async function fixture({grouped=false,options={},body={}}={}){
 let seq=0,time=Date.parse('2030-10-26T00:00:00+08:00');
 const tables=Object.fromEntries([...Object.values(WF),ORDINARY_GROUP_TABLE].map(t=>[t,[]]));
 const base={async listRows(t,_v,_o,_c,s=0,n=500){return structuredClone((tables[t]||[]).slice(s,s+n));},async getMetadata(){return {tables:[]};},async appendRow(t,row){const r={...row,_id:`row-${++seq}`};tables[t].push(r);return {_id:r._id};},async updateRow(t,id,patch){Object.assign(tables[t].find(r=>r._id===id),patch);}};
 const w=createWorkflow(base,{now:()=>time,...options});
 const event=await w.create({...input,bookingMode:grouped?'grouped':'unified',...body},'owner');
 await w.approve(event._id,'reviewer');
 if(grouped){const detail=await w.detail(event._id);await w.configurePositions(event._id,{token:detail.events[0].positionToken,deadline:'2030-10-28T00:00:00',positions:[{start:'2030-10-29T09:00:01',end:'2030-10-29T10:00:01',name:'合成岗位',location:'合成地点',capacity:5,campus:'鼓楼'}]},'owner');}
 return {w,base,tables,event,setTime:value=>{time=Date.parse(value);}};
}

test('publication notice schedule matches gating when rescheduled, cancelled or released now',async()=>{
 for(const grouped of [false,true]){
  const f=await fixture({grouped});
  await f.w.schedulePublication(f.event._id,'2030-10-27T08:00:13+08:00');
  assert.ok(f.tables[WF.events].every(event=>/8:00:13|08:00:13/.test(event['通知草稿'])&&workflowEventApproved(event)));
  await f.w.schedulePublication(f.event._id,null);
  assert.ok(f.tables[WF.events].every(event=>!event['通知草稿'].includes('【报名开始】')&&workflowEventApproved(event)));
  await f.w.schedulePublication(f.event._id,'2030-10-27T08:00:13+08:00');
  await f.w.publish(f.event._id,{publishAt:null});
  assert.ok(f.tables[WF.events].every(event=>!event['通知草稿'].includes('【报名开始】')&&workflowEventApproved(event)));
 }
});
test('schedule strict seconds and real calendar dates reject before writes',async()=>{
 const f=await fixture(),before=structuredClone(f.tables);
 for(const value of [undefined,'','2030-10-27T08:00+08:00','2030-10-27T00:00:00Z','2030-02-30T08:00:00+08:00','2030-10-26T00:00:00+08:00','2030-10-29T08:00:01+08:00',false]){
  await assert.rejects(f.w.schedulePublication(f.event._id,value),{statusCode:400});assert.deepEqual(f.tables,before);
 }
 await f.w.schedulePublication(f.event._id,'2030-10-29T08:00:00+08:00');
 assert.ok(workflowEventApproved(f.tables[WF.events][0]));
});

test('unified schedule gates registrations across restart; omitted publish retains and null clears',async()=>{
 const f=await fixture(),time='2030-10-27T08:00:13+08:00';
 await f.w.schedulePublication(f.event._id,time);await f.w.publish(f.event._id);
 assert.equal(config(f.tables[WF.events][0]).publishAt,time);
 await assert.rejects(f.w.register(f.event._id,account),{statusCode:409});
 const restarted=createWorkflow(f.base,{now:()=>Date.parse(time)});
 const r=await restarted.register(f.event._id,account);assert.equal(r['报名状态'],'待筛选');assert.equal(r['是否报名成功'],'false');
 await f.w.publish(f.event._id,{publishAt:null});assert.equal(config(f.tables[WF.events][0]).publishAt,undefined);
 assert.ok(workflowEventApproved(f.tables[WF.events][0]));
});

test('cancel only future schedules and preserve approved configuration',async()=>{
 for(const grouped of [false,true]){
  const f=await fixture({grouped});await f.w.schedulePublication(f.event._id,'2030-10-27T08:00:13+08:00');
  await f.w.schedulePublication(f.event._id,null);
  assert.ok(f.tables[WF.events].every(e=>e['状态']==='可发布'&&!config(e).publishAt&&workflowEventApproved(e)));
  await assert.rejects(f.w.schedulePublication(f.event._id,null),{statusCode:409});
  await f.w.schedulePublication(f.event._id,'2030-10-27T08:00:13+08:00');
  await f.w.publish(f.event._id,{publishAt:null});
  assert.ok(f.tables[WF.events].every(e=>e['状态']==='报名中'&&!config(e).publishAt&&workflowEventApproved(e)));
 }
 const f=await fixture();await f.w.schedulePublication(f.event._id,'2030-10-27T08:00:13+08:00');f.setTime('2030-10-27T08:00:13+08:00');
 await assert.rejects(f.w.schedulePublication(f.event._id,null),{statusCode:409});
});

test('group schedule validates deadline, rejects child entry, and dynamically gates child registration',async()=>{
 const f=await fixture({grouped:true}),before=structuredClone(f.tables);
 await assert.rejects(f.w.schedulePublication(f.event._id,'2030-10-28T00:00:00+08:00'),{statusCode:400});assert.deepEqual(f.tables,before);
 const child=f.tables[WF.events][1];await assert.rejects(f.w.schedulePublication(child._id,'2030-10-27T00:00:00+08:00'),{statusCode:409});
 await f.w.schedulePublication(f.event._id,'2030-10-27T00:00:13+08:00');
 await assert.rejects(f.w.register(child._id,account),{statusCode:409});
 f.setTime('2030-10-27T00:00:13+08:00');const r=await f.w.register(child._id,account);
 assert.equal(r['报名状态'],'待筛选');assert.equal(r['是否报名成功'],'false');
});

test('grouped draft without positions cannot schedule or publish through either entry',async()=>{
 const f=await fixture({body:{bookingMode:'grouped'}});
 await assert.rejects(f.w.schedulePublication(f.event._id,'2030-10-27T00:00:00+08:00'),{statusCode:409});
 await assert.rejects(f.w.publish(f.event._id,{publishAt:null}),{statusCode:409});
 await assert.rejects(f.w.publishProject(f.event._id),{statusCode:409});
});

test('prepare accepts nonzero seconds and rejects rolled-over dates',async()=>{
 const f=await fixture({body:{publishAt:'2030-10-27T00:00:13+08:00'}});assert.equal(config(f.tables[WF.events][0]).publishAt,'2030-10-27T00:00:13+08:00');
 await assert.rejects(f.w.create({...input,publishAt:'2030-02-30T00:00:13+08:00'},'owner'),{statusCode:400});
});

test('leave intent hook precedes business updates and failure prevents decision writes',async()=>{
 let failure=true,calls=0;
 const f=await fixture({options:{async prepareLeaveDecision(event,row,decision){calls++;assert.equal(event['活动ID'],row['活动ID']);assert.equal(row['请假状态'],'待审批');assert.deepEqual(decision,{approved:true,reason:'批准'});assert.equal(f.tables[WF.registrations][0]['请假状态'],'待审批');if(failure)throw Error('synthetic durable intent failed');}}});
 await f.w.publish(f.event._id);const r=await f.w.register(f.event._id,account);await f.w.confirm(r._id);await f.w.requestLeave(r['报名ID'],account,'合成冲突');
 await assert.rejects(f.w.decideLeave(r._id,true,''),{statusCode:400});assert.equal(calls,0);
 const before=structuredClone(f.tables[WF.registrations]);await assert.rejects(f.w.decideLeave(r._id,true,' 批准 '),/intent failed/);assert.deepEqual(f.tables[WF.registrations],before);
 failure=false;const result=await f.w.decideLeave(r._id,true,' 批准 ');assert.equal(f.tables[WF.registrations][0]['请假状态'],'已批准');assert.equal(calls,2);
 assert.deepEqual(result,{notificationDecision:{requestAt:before[0]['请假申请时间'],approved:true,reason:'批准'}});
 await assert.rejects(f.w.decideLeave(r._id,true,'批准'),{statusCode:409});assert.equal(calls,2);
});

test('actively open projects cannot acquire future gating, including with registrations',async()=>{
 for(const grouped of [false,true]){
  const f=await fixture({grouped});await f.w.publish(f.event._id,{publishAt:null});
  const beforeEmpty=structuredClone(f.tables);
  await assert.rejects(f.w.schedulePublication(f.event._id,'2030-10-27T01:00:00+08:00'),{statusCode:409});assert.deepEqual(f.tables,beforeEmpty);
  await f.w.register(grouped?f.tables[WF.events][1]._id:f.event._id,account);
  const before=structuredClone(f.tables);
  for(const action of [()=>f.w.schedulePublication(f.event._id,'2030-10-27T01:00:00+08:00'),()=>f.w.publish(f.event._id,{publishAt:'2030-10-27T01:00:00+08:00'}),()=>f.w.publishProject(f.event._id,{publishAt:'2030-10-27T01:00:00+08:00'})]){
   await assert.rejects(action(),{statusCode:409});assert.deepEqual(f.tables,before);
  }
  await f.w.publish(f.event._id,{publishAt:null});assert.ok(f.tables[WF.events].every(workflowEventApproved));
 }
});

test('future schedules can move until their original opening instant, but not at that instant',async()=>{
 for(const grouped of [false,true]){
  const f=await fixture({grouped});await f.w.schedulePublication(f.event._id,'2030-10-27T00:00:00+08:00');
  await f.w.schedulePublication(f.event._id,'2030-10-27T01:00:00+08:00');
  f.setTime('2030-10-27T01:00:00+08:00');const before=structuredClone(f.tables);
  await assert.rejects(f.w.schedulePublication(f.event._id,'2030-10-27T02:00:00+08:00'),{statusCode:409});assert.deepEqual(f.tables,before);
 }
});

test('closed grouped publication barrier permits scheduling recovery and immediate republish',async()=>{
 const f=await fixture({grouped:true});await f.w.publish(f.event._id,{publishAt:null});
 await f.w.register(f.tables[WF.events][1]._id,account);
 Object.assign(f.tables[ORDINARY_GROUP_TABLE][0],{状态:'草稿',报名开关:'关闭'});
 await f.w.schedulePublication(f.event._id,'2030-10-27T01:00:00+08:00');
 assert.ok(f.tables[WF.events].every(e=>config(e).publishAt==='2030-10-27T01:00:00+08:00'&&workflowEventApproved(e)));
 Object.assign(f.tables[ORDINARY_GROUP_TABLE][0],{状态:'草稿',报名开关:'关闭'});
 await f.w.publish(f.event._id,{publishAt:null});assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'开放');
 assert.equal(f.tables[WF.registrations].length,1);
});

test('canceled unified schedules remain editable and require renewed review before scheduling',async()=>{
 const f=await fixture();await f.w.schedulePublication(f.event._id,'2030-10-27T00:00:13+08:00');
 await f.w.schedulePublication(f.event._id,null);await f.w.edit(f.event._id,{...input,name:'修改后的合成活动'},'owner');
 assert.equal(f.tables[WF.events][0]['状态'],'草稿');assert.equal(config(f.tables[WF.events][0]).publishAt,undefined);
 const before=structuredClone(f.tables);
 await assert.rejects(f.w.schedulePublication(f.event._id,'2030-10-27T01:00:13+08:00'),{statusCode:409});assert.deepEqual(f.tables,before);
 await f.w.submit(f.event._id);await f.w.approve(f.event._id,'reviewer');
 await f.w.schedulePublication(f.event._id,'2030-10-27T01:00:13+08:00');assert.ok(workflowEventApproved(f.tables[WF.events][0]));
});

test('unreviewed grouped draft changes cannot change publication or group schedule data',async()=>{
 const f=await fixture({body:{bookingMode:'grouped'}});
 await f.w.edit(f.event._id,{...input,bookingMode:'grouped',publishAt:'2030-10-27T00:00:13+08:00'},'owner');
 await f.w.configurePositions(f.event._id,{token:workflowApprovalHash(f.tables[WF.events][0]),deadline:'2030-10-28T00:00:00',positions:[{start:'2030-10-29T09:00:01',end:'2030-10-29T10:00:01',name:'合成岗位',location:'合成地点',capacity:8,campus:'鼓楼'}]},'owner');
 assert.equal(f.tables[ORDINARY_GROUP_TABLE].length,0);assert.equal(config(f.tables[WF.events][0]).publishAt,'2030-10-27T00:00:13+08:00');
 const before=structuredClone(f.tables);
 for(const publishAt of [null,'2030-10-27T01:00:13+08:00']){
  await assert.rejects(f.w.schedulePublication(f.event._id,publishAt),{statusCode:409});assert.deepEqual(f.tables,before);
 }
 await assert.rejects(f.w.publish(f.event._id),{statusCode:409});assert.deepEqual(f.tables,before);
});

test('publication readiness and time validation both select the draft that publish materializes',async()=>{
 const f=await fixture({grouped:true}),parent=f.tables[WF.events][0],c=config(parent);
 c.positionDraft={positions:c.positionPlan.positions,deadline:'2030-10-26T12:00:00+08:00',actor:'owner'};
 replaceConfig(parent,c);const before=structuredClone(f.tables);
 await assert.rejects(f.w.schedulePublication(f.event._id,'2030-10-27T00:00:00+08:00'),{statusCode:400});assert.deepEqual(f.tables,before);
 c.positionDraft.positions=[];replaceConfig(parent,c);const invalid=structuredClone(f.tables);
 await assert.rejects(f.w.schedulePublication(f.event._id,'2030-10-26T01:00:00+08:00'),{statusCode:409});assert.deepEqual(f.tables,invalid);
 c.positionDraft={positions:c.positionPlan.positions,deadline:'2030-10-27T23:00:00+08:00',actor:'owner'};
 c.positionPlan.deadline='2030-10-26T12:00:00+08:00';
 f.tables[ORDINARY_GROUP_TABLE][0]['报名截止']=c.positionPlan.deadline;
 replaceConfig(parent,c);
 await f.w.schedulePublication(f.event._id,'2030-10-27T00:00:00+08:00');
 assert.equal(config(f.tables[WF.events][0]).positionDraft,undefined);
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名截止'],'2030-10-27T23:00:00+08:00');
});
