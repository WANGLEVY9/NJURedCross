import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,workflowApprovalHash,workflowEventApproved} from '../lib/events/workflow.js';
import {ORDINARY_GROUP_TABLE} from '../lib/events/ordinary-groups.js';
import {projectWorkflowEvents} from '../lib/events/public-workflow.js';
import {projectPositions,assertProjectPositions} from '../lib/events/project-positions.js';

const config=e=>JSON.parse(e['报名页配置']);
test('optional position hours survive approval, publication and retry; omitted fields inherit',async()=>{
 const f=await fixture();
 Object.assign(f.positions[0],{serviceHours:'3.25',trainingHours:'0',travelHours:0.75});
 const body=f.payload();await f.w.configurePositions(f.parent._id,body,'owner');
 assert.deepEqual(config(f.tables[WF.events][0]).positionDraft.positions.map(p=>[p.serviceHours,p.trainingHours,p.travelHours]),[[3.25,0,0.75],[undefined,undefined,undefined]]);
 await f.w.approve(f.parent._id,'reviewer');await f.w.publish(f.parent._id);
 const children=f.tables[WF.events].filter(e=>config(e).parentActivityId),ids=children.map(e=>e['活动ID']);
 assert.deepEqual(children.map(e=>[e['服务时长'],e['培训时长'],e['交通时长']]),[['3.25','0','0.75'],['2','0','0']]);
 assert.deepEqual(config(children[0]).positionHours,{serviceHours:3.25,trainingHours:0,travelHours:0.75});
 assert.equal(config(children[1]).positionHours,undefined);
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');
 assert.deepEqual(f.tables[WF.events].filter(e=>config(e).parentActivityId).map(e=>e['活动ID']),ids);
 assert.ok(f.tables[WF.events].every(workflowEventApproved));
});
test('each optional hour inherits independently and zero training/travel override nonzero defaults',async()=>{
 const f=await fixture({}, {trainingHours:1.5,travelHours:2});
 Object.assign(f.positions[0],{trainingHours:0});Object.assign(f.positions[1],{travelHours:0});
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');await f.w.approve(f.parent._id,'reviewer');await f.w.publish(f.parent._id);
 assert.deepEqual(f.tables[WF.events].slice(1).map(e=>[e['服务时长'],e['培训时长'],e['交通时长']]),[['2','0','2'],['2','1.5','0']]);
});
test('explicit invalid position hours reject before any persistence',async()=>{
 const f=await fixture(),before=structuredClone(f.tables);
 for(const key of ['serviceHours','trainingHours','travelHours']){
  for(const value of ['', ' ',null,false,true,[],{},-1,'-0.5',NaN,Infinity,'Infinity','not-hours',100001,...(key==='serviceHours'?[0,'0']:[])]){
   await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions:[{...f.positions[0],[key]:value},f.positions[1]]},'owner'),{statusCode:400},`${key}=${String(value)}`);
   assert.deepEqual(f.tables,before);
  }
 }
});
test('position hours participate in registered-position identity and cannot bypass roster protection',async()=>{
 const f=await fixture();Object.assign(f.positions[0],{serviceHours:3,trainingHours:0.5,travelHours:1});
 await f.w.approve(f.parent._id,'reviewer');await f.w.configurePositions(f.parent._id,f.payload(),'owner');await f.w.publish(f.parent._id);
 const child=f.tables[WF.events][1];f.tables[WF.registrations].push({_id:'synthetic-hours-registration',活动ID:child['活动ID']});
 const before=structuredClone(f.tables);
 for(const patch of [{serviceHours:4},{trainingHours:0},{travelHours:0},{serviceHours:undefined}]){
  await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions:[{...f.positions[0],...patch},f.positions[1]]},'owner'),{statusCode:409});
  assert.deepEqual(f.tables,before);
 }
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');assert.deepEqual(f.tables,before);
});
test('interrupted generation with overridden hours recovers stable approved children',async()=>{
 const f=await fixture();Object.assign(f.positions[0],{serviceHours:3,travelHours:0.5});
 await f.w.approve(f.parent._id,'reviewer');const body=f.payload();f.interrupt();
 await assert.rejects(f.w.configurePositions(f.parent._id,body,'owner'),/interrupted/);
 const firstId=f.tables[WF.events][1]['活动ID'];await f.w.configurePositions(f.parent._id,body,'owner');await f.w.configurePositions(f.parent._id,body,'owner');
 assert.equal(f.tables[WF.events].length,3);assert.equal(f.tables[WF.events][1]['活动ID'],firstId);
 assert.equal(f.tables[WF.events][1]['服务时长'],'3');assert.equal(f.tables[WF.events][1]['交通时长'],'0.5');
 assert.ok(f.tables[WF.events].every(workflowEventApproved));assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
});
test('position defaults reach attendance ledger while whole-sheet submission still locks edits',async()=>{
 let clock=Date.parse('2026-10-17T08:00:00+08:00');const f=await fixture({now:()=>clock});
 Object.assign(f.positions[0],{serviceHours:3.25,trainingHours:0.5,travelHours:0});
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');await f.w.approve(f.parent._id,'reviewer');await f.w.publish(f.parent._id);
 const children=f.tables[WF.events].filter(row=>config(row).ordinary),regs=[];
 for(const [i,event]of children.entries()){
  const sid=`99999002${i}`;const row=await f.w.register(event._id,{accountId:`synthetic-hours-${i}`,studentId:sid,realName:`合成岗位时长${i}`,email:`${sid}@smail.nju.edu.cn`,emailVerified:true});await f.w.confirm(row._id);regs.push(row);
 }
 await f.w.close(f.parent._id,{scope:'project'});clock=Date.parse('2030-10-31T08:00:00+08:00');
 const hashes=f.tables[WF.events].map(row=>row.批准摘要);
 await f.w.attendanceBatch(f.parent._id,regs.map(row=>({id:row._id,hours:{}})),'checker');
 assert.deepEqual(f.tables[WF.ledger].map(row=>[row['服务时长'],row['培训时长'],row['交通时长']]),[['3.25','0.5','0'],['2','0','0']]);
 assert.ok(f.tables[WF.ledger].every(row=>row['状态']!=='已入账'));
 await f.w.submitHoursSheet(f.parent._id,0,'owner');
 const entry=f.tables[WF.ledger][0],submitted=structuredClone(f.tables);
 await assert.rejects(f.w.reviewHours(regs[0]._id,'owner',{serviceHours:99,expectedDigest:entry['核对摘要']}),/已提交/);
 assert.deepEqual(f.tables,submitted);
 await f.w.returnHoursSheet(f.parent._id,1,'合成整表核对','reviewer');
 assert.deepEqual(f.tables[WF.events].map(row=>row.批准摘要),hashes);assert.ok(f.tables[WF.events].every(workflowEventApproved));
});
test('whole hours submission and return cover all generated website positions without changing approval hashes',async()=>{
 let clock=Date.parse('2026-10-17T08:00:00+08:00');const f=await fixture({now:()=>clock});
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');await f.w.approve(f.parent._id,'reviewer');await f.w.publish(f.parent._id);
 const children=f.tables[WF.events].filter(row=>config(row).ordinary),regs=[];
 for(const [i,event]of children.entries()){
  const sid=`99999001${i}`;const row=await f.w.register(event._id,{accountId:`synthetic-${i}`,studentId:sid,realName:`合成跨岗同学${i}`,email:`${sid}@smail.nju.edu.cn`,emailVerified:true});await f.w.confirm(row._id);regs.push(row);
 }
 await f.w.close(f.parent._id,{scope:'project'});clock=Date.parse('2030-10-31T08:00:00+08:00');
 const hashes=f.tables[WF.events].map(row=>row.批准摘要);
 await f.w.attendanceBatch(f.parent._id,[{id:regs[0]._id,hours:{serviceHours:2}}],'checker');
 await f.w.markHoursAbsence(children[1]._id,regs[1]._id,'合成未到场',0,'owner');
 await f.w.submitHoursSheet(children[0]._id,1,'owner');
 assert.ok((await f.w.detail(f.parent._id)).events.every(row=>row.hoursSubmission.phase==='submitted'));
 await assert.rejects(f.w.checkin(regs[1]._id,'checker'),/已提交/);
 await f.w.returnHoursSheet(children[1]._id,2,'合成整表退回','reviewer');
 assert.ok((await f.w.detail(f.parent._id)).events.every(row=>row.hoursSubmission.phase==='returned'));
 assert.deepEqual(f.tables[WF.events].map(row=>row.批准摘要),hashes);assert.ok(f.tables[WF.events].every(workflowEventApproved));
});
function directService(f,{beforeUpdate=()=>{}}={}){
 return projectPositions({eventBy:async id=>structuredClone(f.tables[WF.events].find(e=>e._id===id)),rows:async t=>structuredClone(f.tables[t]),
  update:async(t,row,patch)=>{beforeUpdate(t,row,patch);Object.assign(f.tables[t].find(e=>e._id===row._id),patch);},
  approved:workflowEventApproved,approvalHash:workflowApprovalHash,eventsTable:WF.events,registrationsTable:WF.registrations});
}

test('capacity expansion is saved with draft/plan, signed and repeatable after interruption',async()=>{
 for(const approved of [false,true]){
  const f=await fixture();if(approved)await f.w.approve(f.parent._id,'reviewer');
  f.positions[1].capacity=40;const body=f.payload();
  if(approved){f.interrupt();await assert.rejects(f.w.configurePositions(f.parent._id,body,'owner'),/interrupted/);}
  const result=await f.w.configurePositions(f.parent._id,body,'owner');
  assert.equal(result.capacityAdjusted,true);assert.equal(result.previousCapacity,30);assert.equal(result.capacity,50);
  const parent=f.tables[WF.events][0],c=config(parent);
  assert.equal(parent['容量'],'50');assert.equal(c.capacity,50);assert.equal(c.registrationLimit,50);
  assert.equal(result.registrationLimitAdjusted,true);assert.equal(result.previousRegistrationLimit,30);assert.equal(result.noticeUpdated,true);
  assert.match(parent['通知草稿'],/【录取名额】：50 人/);
  assert.equal((approved?c.positionPlan:c.positionDraft).positions.reduce((n,p)=>n+p.capacity,0),50);
  assert.equal(workflowEventApproved(parent),approved);
  const repeated=await f.w.configurePositions(f.parent._id,body,'owner');assert.equal(repeated.capacity,50);
  if(!approved){await f.w.approve(f.parent._id,'reviewer');await f.w.publish(f.parent._id);}
  assert.ok(f.tables[WF.events].every(workflowEventApproved));assert.equal(f.tables[WF.events].length,3);
 }
});

test('distinct recommended capacity and registration upper expand independently and never decrease',async()=>{
 for(const approved of [false,true]){
  const f=await fixture(),parent=f.tables[WF.events][0],c=config(parent);c.registrationLimit=45;parent['报名页配置']=JSON.stringify(c);
  if(approved)await f.w.approve(f.parent._id,'reviewer');
  f.positions[1].capacity=30;
  const within=await f.w.configurePositions(f.parent._id,f.payload(),'owner');
  assert.equal(within.capacity,40);assert.equal(within.registrationLimit,45);assert.equal(within.registrationLimitAdjusted,false);
  f.positions[1].capacity=40;
  const over=await f.w.configurePositions(f.parent._id,f.payload(),'owner');
  assert.equal(over.previousCapacity,40);assert.equal(over.capacity,50);assert.equal(over.previousRegistrationLimit,45);assert.equal(over.registrationLimit,50);assert.equal(over.registrationLimitAdjusted,true);
  f.positions[1].capacity=5;
  const reduced=await f.w.configurePositions(f.parent._id,f.payload(),'owner');assert.equal(reduced.capacity,50);assert.equal(reduced.registrationLimit,50);
  assert.equal(config(parent).capacity,50);assert.equal(config(parent).registrationLimit,50);assert.equal(workflowEventApproved(parent),approved);
 }
});

test('capacity expansion preserves both marked and legacy manual quota notices and requests review',async()=>{
 for(const marked of [false,true]){
  const f=await fixture(),parent=f.tables[WF.events][0],c=config(parent),text='合成手工通知\n【录取名额】：30 人\n手工集合安排不改写';
  parent['通知草稿']=text;if(marked)c.noticeCustomized=true;parent['报名页配置']=JSON.stringify(c);
  f.positions[1].capacity=40;const changed=await f.w.configurePositions(f.parent._id,f.payload(),'owner');
  assert.equal(parent['通知草稿'],text);assert.equal(changed.noticeUpdated,false);assert.equal(changed.noticeReviewRequired,true);assert.equal(config(parent).noticeCustomized,true);
  await f.w.edit(f.parent._id,{...config(parent),name:'修改后的合成项目',capacity:1,registrationLimit:1,serviceHours:2,trainingHours:0,travelHours:0},'owner');
  assert.equal(parent['通知草稿'],text);assert.equal(config(parent).capacity,50);assert.equal(config(parent).registrationLimit,50);
 }
});

test('position aggregate limit rejects before any durable write',async()=>{
 const f=await fixture(),before=structuredClone(f.tables);
 await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions:[{...f.positions[0],capacity:100000},{...f.positions[1],capacity:1}]},'owner'),{statusCode:400});assert.deepEqual(f.tables,before);
});

test('position work projects into child content and protects registered arrangements',async()=>{
 const f=await fixture();await f.w.approve(f.parent._id,'reviewer');
 f.positions[0].work='  引导参与者，说明签到流程  ';
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');
 const child=f.tables[WF.events][1];
 assert.equal(child['工作内容'],'引导参与者，说明签到流程');assert.equal(config(child).content,child['工作内容']);
 assert.equal(f.tables[WF.events][2]['工作内容'],'合成服务');
 f.tables[WF.registrations].push({_id:'synthetic',活动ID:child['活动ID']});
 await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions:[{...f.positions[0],work:'改写'},f.positions[1]]},'owner'),{statusCode:409});
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');assert.equal(f.tables[WF.events].length,3);
});

test('work aliases and bounds validate before any writes',async()=>{
 const f=await fixture(),before=structuredClone(f.tables);
 for(const extra of [{work:'x'.repeat(501)},{work:123},{content:null},{capacity:true},{capacity:Number.MAX_SAFE_INTEGER},{work:'a',content:'b'}]){
  await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions:[{...f.positions[0],...extra}]},'owner'),{statusCode:400});
  assert.deepEqual(f.tables,before);
 }
 await f.w.configurePositions(f.parent._id,{...f.payload(),positions:[{...f.positions[0],content:'岗位内容'}]},'owner');
 assert.equal(config(f.tables[WF.events][0]).positionDraft.positions[0].work,'岗位内容');
});

test('empty or malformed signed plans never open the publication barrier',async()=>{
 const f=await fixture();await f.w.approve(f.parent._id,'reviewer');await f.w.configurePositions(f.parent._id,f.payload(),'owner');
 const parent=f.tables[WF.events][0],original=config(parent);
 for(const positions of [[],null,[{...original.positionPlan.positions[0],capacity:0}]]){
  const c=structuredClone(original);c.positionPlan.positions=positions;c.positionPlan.eventIds=[];
  parent['报名页配置']=JSON.stringify(c);parent['批准摘要']=workflowApprovalHash(parent);
  assert.throws(()=>assertProjectPositions(parent),{statusCode:409});
  await assert.rejects(directService(f).publish(parent._id),{statusCode:409});
  assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
 }
});

test('group schedule synchronizes signed gating; immediate publish clears it; cancellation retains plan',async()=>{
 const f=await fixture();await f.w.approve(f.parent._id,'reviewer');await f.w.configurePositions(f.parent._id,f.payload(),'owner');
 const service=directService(f,{beforeUpdate(table,_row,patch){
  if(table===WF.events)assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
  if(table===ORDINARY_GROUP_TABLE&&patch['报名开关']==='开放'){
   assert.ok(f.tables[WF.events].every(workflowEventApproved));
   assert.equal(new Set(f.tables[WF.events].map(e=>config(e).publishAt)).size,1);
  }
 }}),publishAt='2030-10-27T08:00:00+08:00';
 const before=structuredClone(f.tables);
 for(const invalid of ['2030-10-28T00:00:00+08:00','2030-10-30T08:00:00+08:00','2020-01-01T00:00:00+08:00','2030-10-27T00:00:00Z']){
  await assert.rejects(service.publish(f.parent._id,{publishAt:invalid}),{statusCode:400});assert.deepEqual(f.tables,before);
 }
 await service.publish(f.parent._id,{publishAt});
 assert.ok(f.tables[WF.events].every(e=>workflowEventApproved(e)&&config(e).publishAt===publishAt));
 await service.publish(f.parent._id);assert.equal(config(f.tables[WF.events][0]).publishAt,publishAt);
 const plan=config(f.tables[WF.events][0]).positionPlan;
 await service.cancelSchedule(f.parent._id);
 assert.ok(f.tables[WF.events].every(e=>workflowEventApproved(e)&&e['状态']==='可发布'&&!config(e).publishAt));
 assert.deepEqual(config(f.tables[WF.events][0]).positionPlan,plan);assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
 await service.publish(f.parent._id,{publishAt});await service.publish(f.parent._id,{publishAt:null});
 assert.ok(f.tables[WF.events].every(e=>workflowEventApproved(e)&&e['状态']==='报名中'&&!config(e).publishAt));
 await assert.rejects(service.cancelSchedule(f.parent._id),{statusCode:409});
});

test('interrupted schedule and cancellation leave group closed and resume safely',async()=>{
 const f=await fixture();await f.w.approve(f.parent._id,'reviewer');await f.w.configurePositions(f.parent._id,f.payload(),'owner');
 let remaining=2;
 const service=directService(f,{beforeUpdate(t){if(t===WF.events&&--remaining===0)throw Error('synthetic interrupted update');}});
 const publishAt='2030-10-27T08:00:00+08:00';
 await assert.rejects(service.publish(f.parent._id,{publishAt}),/interrupted/);
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
 await service.publish(f.parent._id,{publishAt});
 remaining=2;await assert.rejects(service.cancelSchedule(f.parent._id),/interrupted/);
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
 await service.cancelSchedule(f.parent._id);
 assert.ok(f.tables[WF.events].every(e=>workflowEventApproved(e)&&e['状态']==='可发布'&&!config(e).publishAt));
});

async function fixture(options={},parentHours={}){
 let seq=0,failAt=0;
 const tables=Object.fromEntries([...Object.values(WF),ORDINARY_GROUP_TABLE].map(t=>[t,[]]));
 const base={async listRows(t,_v,_o,_c,s=0,n=500){return structuredClone(tables[t].slice(s,s+n));},async getMetadata(){return {tables:[]};},async appendRow(t,row){if(t===WF.events&&failAt&&--failAt===0)throw Error('synthetic interrupted write');const r={...row,_id:`row-${++seq}`};tables[t].push(r);return {_id:r._id};},async updateRow(t,id,patch){Object.assign(tables[t].find(r=>r._id===id),patch);}};
 const w=createWorkflow(base,options);
 const parent=await w.create({name:'合成跨日项目',center:'生命中心',bookingMode:'grouped',window:{start:'2030-10-29T08:00:00',end:'2030-10-30T18:00:00'},capacity:30,serviceHours:2,trainingHours:0,travelHours:0,...parentHours,location:'合成校区',work:'合成服务'},'owner');
 const positions=[{start:'2030-10-29T08:30:01',end:'2030-10-29T10:30:01',location:'合成地点甲',name:'引导',capacity:10,campus:'鼓楼'},{start:'2030-10-30T10:00:00',end:'2030-10-30T12:00:00',location:'合成地点乙',name:'登记',capacity:20,campus:'仙林'}];
 const payload=()=>({token:workflowApprovalHash(tables[WF.events][0]),positions,deadline:'2030-10-28T00:00:00'});
 return {tables,w,parent,positions,payload,interrupt:()=>{failAt=2;}};
}
test('background seat batches yield to approval and refresh authoritative evidence',async()=>{
 const started=Promise.withResolvers(),release=Promise.withResolvers();let batches=0;
 const f=await fixture({places:{async reconcile(events,_registrations,options){
  assert.equal(options.maxChanges,8);batches++;
  if(batches===1){started.resolve();await release.promise;return {changed:8,remaining:1};}
  assert.equal(events[0]['状态'],'可发布');return {changed:1,remaining:0};
 }}});
 const background=f.w.reconcilePlaces();await started.promise;
 const approval=f.w.approve(f.parent._id,'reviewer');release.resolve();
 await approval;assert.equal((await background).changed,9);assert.equal(batches,2);
});
test('ordinary detail reuses fresh authority rows without reading blood source',async()=>{
 const f=await fixture(),reads=[];
 const base={async listRows(table){reads.push(table);if(table==='blood-source')throw Error('unrelated dependency unavailable');return structuredClone(f.tables[table]||[]);}};
 const w=createWorkflow(base,{bloodSourceTable:'blood-source'});
 const data=await w.detail(f.parent._id,f.tables[WF.events]);
 assert.equal(data.events[0]._id,f.parent._id);
 assert.equal(reads.includes('blood-source'),false);
 assert.equal(reads.includes(WF.events),false);
});
test('grouped project requires approval then positions and publishes only complete children',async()=>{
 const f=await fixture();
 await f.w.approve(f.parent._id,'reviewer');
 await assert.rejects(f.w.publish(f.parent._id),{statusCode:409});
 await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions:[{...f.positions[0],capacity:100001}]},'owner'),{statusCode:400});
 await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions:[{...f.positions[0],end:'2030-10-31T01:00:00'}]},'owner'),{statusCode:400});
 const result=await f.w.configurePositions(f.parent._id,f.payload(),'owner');assert.equal(result.events.length,2);
 assert.ok(result.events.every(workflowEventApproved));
 assert.deepEqual(projectWorkflowEvents((await f.w.publicRead()).events,[]),[]);
 await assert.rejects(f.w.publish(result.events[0]._id),{statusCode:409});
 await f.w.publish(f.parent._id);
 const catalog=projectWorkflowEvents((await f.w.publicRead()).events,[]);assert.equal(catalog.length,1);assert.equal(catalog[0].sessions.length,2);assert.equal(catalog[0].capacity,30);
 await assert.rejects(f.w.register(f.parent._id,{}),{statusCode:409});
 const owners=await f.w.getOwners(f.parent._id);
 await f.w.setOwners(f.parent._id,{primary:'new-owner',coOwners:['second-owner'],token:owners.token},'reviewer');
 assert.ok(f.tables[WF.events].every(e=>e['负责人账号ID']==='new-owner'&&workflowEventApproved(e)));
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['负责人账号ID'],'new-owner');
 await f.w.close(f.parent._id);
 assert.ok(f.tables[WF.events].every(e=>e['状态']==='进行中'));
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
 await f.w.finish(f.parent._id);
 assert.ok(f.tables[WF.events].every(e=>e['状态']==='已结束'));
});
test('pending project saves editable positions without public rows; approval then publish materializes them',async()=>{
 const f=await fixture(),body=f.payload();
 body.positions[0].campus='浦口';
 assert.equal((await f.w.configurePositions(f.parent._id,body,'owner')).draft,true);
 assert.equal(f.tables[WF.events].length,1);assert.equal(f.tables[ORDINARY_GROUP_TABLE].length,0);
 assert.equal(f.tables[WF.events][0]['状态'],'待审核');
 await assert.rejects(f.w.publish(f.parent._id),{statusCode:409});
 await assert.rejects(f.w.configurePositions(f.parent._id,{...body,positions:[body.positions[0]]},'owner'),{statusCode:409});
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');
 const detail=await f.w.detail(f.parent._id);assert.equal(detail.events[0].positionToken,workflowApprovalHash(f.tables[WF.events][0]));
 await f.w.approve(f.parent._id,'reviewer');await f.w.publish(f.parent._id);
 assert.equal(f.tables[WF.events].length,3);assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'开放');
 assert.equal(JSON.parse(f.tables[WF.events][1]['报名页配置']).ordinary.campus,'浦口');
 assert.ok(f.tables[WF.events].every(workflowEventApproved));
});
test('approved adjustments preserve registered positions and close publication until republished',async()=>{
 const f=await fixture();await f.w.approve(f.parent._id,'reviewer');
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');await f.w.publish(f.parent._id);
 const first=f.tables[WF.events][1];f.tables[WF.registrations].push({_id:'synthetic-registration',活动ID:first['活动ID']});
 const unchanged=f.payload();await f.w.configurePositions(f.parent._id,unchanged,'owner');
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'开放');
 await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions:[{...f.positions[0],name:'changed'},f.positions[1]]},'owner'),{statusCode:409});
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'开放');
 await f.w.configurePositions(f.parent._id,{...f.payload(),positions:[f.positions[0],{...f.positions[1],name:'调整后的登记',campus:'浦口'}]},'owner');
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
 assert.equal(f.tables[WF.events][1]._id,first._id);
 assert.equal(f.tables[WF.registrations][0]['活动ID'],first['活动ID']);
 await f.w.publish(f.parent._id);
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'开放');
 assert.equal(projectWorkflowEvents((await f.w.publicRead()).events,[])[0].sessions.length,2);
});
test('duplicate, out-of-range and unknown campus positions reject before writing',async()=>{
 const f=await fixture();
 for(const positions of [[f.positions[0],f.positions[0]],[{...f.positions[0],campus:'未知'}],[{...f.positions[0],start:'2030-10-28T01:00:00'}]])await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions},'owner'),{statusCode:400});
 assert.equal(f.tables[WF.events].length,1);assert.equal(JSON.parse(f.tables[WF.events][0]['报名页配置']).positionDraft,undefined);
});
test('editing parent preserves the position draft and rejects a conflicting range',async()=>{
 const f=await fixture();await f.w.configurePositions(f.parent._id,f.payload(),'owner');
 const input={name:'修改合成项目',center:'生命中心',bookingMode:'grouped',window:{start:'2030-10-29T08:00:00',end:'2030-10-30T18:00:00'},capacity:30,serviceHours:2,trainingHours:0,travelHours:0,location:'合成校区',work:'合成服务'};
 await f.w.edit(f.parent._id,input,'owner');
 assert.equal(JSON.parse(f.tables[WF.events][0]['报名页配置']).positionDraft.positions.length,2);
 await f.w.edit(f.parent._id,{...input,capacity:1,registrationLimit:1},'owner');
 assert.equal(Number(f.tables[WF.events][0]['容量']),30);
 assert.equal(config(f.tables[WF.events][0]).registrationLimit,30);
 assert.match(f.tables[WF.events][0]['通知草稿'],/【录取名额】：30 人/);
 const before=structuredClone(f.tables);
 for(const conflicting of [{bookingMode:'unified'},{window:{start:'2030-10-29T09:00:00',end:'2030-10-30T18:00:00'}},{window:{start:'2030-10-27T08:00:00',end:'2030-10-30T18:00:00'}}]){
  await assert.rejects(f.w.edit(f.parent._id,{...input,...conflicting},'owner'),{statusCode:409});assert.deepEqual(f.tables,before);
 }
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');
 assert.equal(f.tables[WF.events][0]['状态'],'草稿');
 await assert.rejects(f.w.publish(f.parent._id),{statusCode:409});
});
test('interrupted position generation resumes without duplicate rows or opening registration',async()=>{
 const f=await fixture();await f.w.approve(f.parent._id,'reviewer');const body=f.payload();f.interrupt();
 await assert.rejects(f.w.configurePositions(f.parent._id,body,'owner'),/interrupted/);
 await assert.rejects(f.w.publish(f.parent._id),{statusCode:409});
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
 await f.w.configurePositions(f.parent._id,body,'owner');
 await f.w.configurePositions(f.parent._id,body,'owner');
 assert.equal(f.tables[WF.events].length,3);assert.equal(f.tables[ORDINARY_GROUP_TABLE].length,1);
 await assert.rejects(f.w.edit(f.parent._id,{},'owner'),{statusCode:409});
 await assert.rejects(f.w.configurePositions(f.parent._id,{...body,positions:[f.positions[0]]},'owner'),{statusCode:409});
});
