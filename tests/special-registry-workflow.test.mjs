import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createWorkflow,WF,workflowEventApproved} from '../lib/events/workflow.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {registryMetadata} from '../lib/events/special-registry.js';
import {projectWorkflowEvents} from '../lib/events/public-workflow.js';
const person=id=>({accountId:'synthetic-'+id,studentId:String(id),realName:'合成同学'+id,email:id+'@smail.nju.edu.cn',emailVerified:true,department:'合成学院',campus:'仙林',division:'志愿者'});
function fixture(options={}){
 let seq=0,time=Date.parse('2030-12-10T10:00:00+08:00');const tables=Object.fromEntries(Object.values(WF).map(name=>[name,[]]));
 const base={async listRows(name,_v,_o,_c,start=0,count=500){return structuredClone((tables[name]||[]).slice(start,start+count));},async getMetadata(){return {tables:[]};},async appendRow(name,row){const saved={...row,_id:'registry-row-'+(++seq)};tables[name].push(saved);return {_id:saved._id};},async updateRow(name,id,patch){Object.assign(tables[name].find(row=>row._id===id),patch);}};
 return {tables,w:createWorkflow(base,{...options,now:()=>time}),time:value=>{time=Date.parse(value);}};
}
test('long-term projects retain the existing category without fake end dates and enable idempotently',async()=>{
 const {w,tables,time}=fixture(),one=await w.enableRegistry({v:1,type:'province-service',dailyCapacity:1},'owner');
 assert.deepEqual(await w.enableRegistry({v:1,type:'province-service',dailyCapacity:9},'owner'),{id:one.id,created:false});assert.equal(tables[WF.events].length,1);
 const row=tables[WF.events][0],c=JSON.parse(row['报名页配置']);assert.equal(row['状态'],'报名中');assert.equal(row['组织类别'],'排班专项');assert.equal(c.window,undefined);assert.equal(c.endDate,undefined);assert.equal(c.special.dailyCapacity,1);assert.equal(workflowEventApproved(row),true);
 time('2040-01-01T10:00:00+08:00');const listed=projectWorkflowEvents((await w.publicRead()).events,[]);assert.equal(listed[0].status,'报名中');assert.equal(listed[0].registryType,'province-service');
 await w.endRegistry(one.id,'owner','合成项目结束');await assert.rejects(w.registryRegister(one.id,{requestId:randomUUID(),date:'2040-01-01'},person(999990001)),/已结束/);assert.equal(tables[WF.events].length,1);assert.equal(workflowEventApproved(tables[WF.events][0]),true);
});
test('completed service requires proof and writes time and position through existing typed registrations with quota and idempotency',async()=>{
 const {w,tables}=fixture(),{id}=await w.enableRegistry({v:1,type:'province-service',dailyCapacity:1},'owner'),input={requestId:randomUUID(),date:'2030-12-09',start:'09:00',end:'12:00',location:'鼓楼广场献血车',photoId:randomUUID()};
 const result=await Promise.allSettled([w.registryRegister(id,input,person(999990001)),w.registryRegister(id,{...input,requestId:randomUUID()},person(999990002))]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.match(result.find(r=>r.status==='rejected').reason.message,/名额已满/);
 const row=tables[WF.registrations][0];assert.equal(row['报名时段'],'09:00-12:00');assert.equal(row['岗位'],'鼓楼广场献血车');assert.equal(row['地点'],'鼓楼广场献血车');assert.equal(row['学号'],'999990001');assert.equal(row['报名状态'],'待筛选');assert.equal(tables[WF.ledger].length,0);
 assert.equal((await w.registryRegister(id,input,person(999990001)))._id,row._id);assert.equal(tables[WF.registrations].length,1);
 await assert.rejects(w.registryRegister(id,{...input,requestId:randomUUID(),accountId:'other'},person(999990001)),/字段|日期/);
 assert.equal((await w.registryList(id,person(999990002))).rows.length,0);
});
test('completed donation requires a certificate; verification creates only pending hours and retries never duplicate',async()=>{
 const {w,tables}=fixture(),{id}=await w.enableRegistry({v:1,type:'component-donation'},'owner'),input={requestId:randomUUID(),date:'2030-12-09',duration:1.5,quantity:2,photoId:randomUUID()};
 await assert.rejects(w.registryRegister(id,{...input,photoId:''},person(999990001)),/献血证/);
 const row=await w.registryRegister(id,input,person(999990001));assert.equal(tables[WF.checkins].length,0);assert.equal(tables[WF.ledger].length,0);
 assert.equal((await w.registryRegister(id,{...input,photoId:randomUUID()},person(999990001)))._id,row._id);assert.equal(registryMetadata(tables[WF.registrations][0]).photoId,input.photoId);
 await w.registryDecide(id,[{id:row._id,revision:1}],'verify','合成管理员核对了献血证与实际时长','owner');
 assert.equal(tables[WF.checkins].length,1);assert.equal(tables[WF.ledger].length,1);assert.equal(tables[WF.ledger][0]['状态'],'待批准');assert.equal(Number(tables[WF.ledger][0]['服务时长']),4);assert.equal(Number(tables[WF.ledger][0]['交通时长']),1);assert.equal(tables[WF.profiles].length,0);
 await assert.rejects(w.registryDecide(id,[{id:row._id,revision:1}],'verify','旧请求重试','owner'),/已变化/);assert.equal(tables[WF.ledger].length,1);
 await assert.rejects(w.checkin(row._id,'owner','跳过献血证'),/献血证核验/);
 await w.endRegistry(id,'owner','合成结束');assert.equal((await w.registryList(id,person(999990001))).rows.length,1);assert.equal(tables[WF.checkins].length,1);
});


test('fresh departmental roles allow certificate verification but reserve final approval for the chair',async()=>{
 let rows=[{accountId:'global',region:'nanjing',role:'global',active:true,categories:[]},{accountId:'director',region:'nanjing',role:'director',active:true,categories:['排班专项']},{accountId:'chair',region:'nanjing',role:'presidium',active:true,categories:['排班专项']},{accountId:'other',region:'nanjing',role:'director',active:true,categories:['生命中心']}];
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>({complete:true,rows})}),f=fixture({approvalRouting:routing}),{id}=await f.w.enableRegistry({v:1,type:'component-donation'},'global');
 const row=await f.w.registryRegister(id,{requestId:randomUUID(),date:'2030-12-09',duration:1.5,quantity:2,photoId:randomUUID()},person(999990003));
 const item={id:row._id,revision:1};await assert.rejects(f.w.registryDecide(id,[item],'verify','合成核验','other'),{statusCode:403});
 await f.w.registryDecide(id,[item],'verify','合成凭证已核对','director');const entry=f.tables[WF.ledger][0];
 const denied=await f.w.approveBatch(id,[{id:entry._id,expectedDigest:entry['核对摘要']}],'director','platform_admin');assert.equal(denied.succeeded,0);
 assert.equal((await f.w.approveBatch(id,[{id:entry._id,expectedDigest:entry['核对摘要']}],'chair','platform_admin')).succeeded,1);
 rows=rows.filter(r=>r.accountId!=='director');await assert.rejects(f.w.endRegistry(id,'director','已结束'),{statusCode:403});
 assert.equal(f.tables[WF.events][0]['状态'],'报名中');
});

test('returned completion can be corrected without duplicating the record or accepting a stale review',async()=>{
 const {w,tables}=fixture(),{id}=await w.enableRegistry({v:1,type:'component-donation'},'owner'),account=person(999990004);
 const input={requestId:randomUUID(),date:'2030-12-09',duration:1,quantity:1,photoId:randomUUID()},row=await w.registryRegister(id,input,account);
 await w.registryDecide(id,[{id:row._id,revision:1}],'return','合成凭证需更正','recorder');
 const corrected=await w.registryRegister(id,{...input,requestId:randomUUID(),duration:1.5,photoId:randomUUID()},account);
 assert.equal(corrected._id,row._id);assert.equal(tables[WF.registrations].length,1);assert.equal(registryMetadata(corrected).revision,3);
 await assert.rejects(w.registryDecide(id,[{id:row._id,revision:1}],'verify','旧核验请求','recorder'),/已变化/);
 assert.equal(tables[WF.ledger].length,0);
 await w.registryDecide(id,[{id:row._id,revision:3}],'verify','更正后已核验','recorder');assert.equal(tables[WF.ledger][0]['服务时长'],'4');
});


test('province proof verification records actual service location and time with editable 2-2-4 defaults',async()=>{
 const {w,tables}=fixture(),{id}=await w.enableRegistry({v:1,type:'province-service',dailyCapacity:4},'owner');
 const row=await w.registryRegister(id,{requestId:randomUUID(),date:'2030-12-09',start:'09:30',end:'14:30',location:'浮桥献血车',photoId:randomUUID()},person(999990006));
 const info=await w.adminInformation(id);
 assert.equal(info.values.serviceHours,'4');assert.equal(info.values.trainingHours,'2');assert.equal(info.values.travelHours,'2');
 await w.adminInformation(id,{token:info.token,values:{...info.values,serviceHours:'5'}});
 await w.registryDecide(id,[{id:row._id,revision:1}],'verify','签到凭证及岗位时间已核实','owner');
 const entry=tables[WF.ledger][0];assert.equal(entry['服务时长'],'5');assert.equal(entry['交通时长'],'2');assert.equal(entry['培训时长'],'2');assert.equal(entry['具体工作地点'],'浮桥献血车');assert.equal(entry['正式工作日期'],'2030-12-09 09:30–14:30');assert.equal(entry['状态'],'待批准');
 assert.equal(tables[WF.registrations][0]['签到照片ID'],registryMetadata(row).photoId);
 assert.equal((await w.approveBatch(id,[{id:entry._id,expectedDigest:entry['核对摘要']}],'chair','super_admin')).succeeded,1);
 assert.equal(tables[WF.profiles].length,0);
});

test('new province registrations reject future services, invalid positions and missing proof; old date-only records remain reviewable',async()=>{
 const {w,tables}=fixture(),{id}=await w.enableRegistry({v:1,type:'province-service',dailyCapacity:4},'owner'),account=person(999990007);
 const input={requestId:randomUUID(),date:'2030-12-09',start:'09:00',end:'12:00',location:'大洋百货献血车',photoId:randomUUID()};
 for(const patch of [{date:'2030-12-11'},{start:'13:00'},{location:'未知'},{photoId:''}])await assert.rejects(w.registryRegister(id,{...input,...patch},account));
 const row=await w.registryRegister(id,input,account);
 const saved=tables[WF.registrations][0],meta=registryMetadata(saved);delete meta.photoId;delete meta.start;delete meta.end;delete meta.location;saved['备注2']=JSON.stringify(meta);saved['报名时段']='';saved['岗位']='';
 await w.registryDecide(id,[{id:row._id,revision:1}],'verify','历史登记已核实','owner');
 assert.equal(saved['报名状态'],'已确认');assert.equal(tables[WF.ledger].length,0);
});


test('legacy running registries display as signup, keep accepting proof, and preserve records when ended',async()=>{
 const {w,tables}=fixture(),{id}=await w.enableRegistry({v:1,type:'province-service',dailyCapacity:4},'owner');
 const event=tables[WF.events][0];event['状态']='进行中';
 const {workspaceStage}=await import('../public/app/shared/activity-workspace.js');
 const {activityStage}=await import('../public/app/shared/activity-stage.js');
 assert.equal(workspaceStage(event),'报名中');assert.equal(activityStage(event),'registering');
 assert.equal(projectWorkflowEvents((await w.publicRead()).events,[])[0].status,'报名中');
 assert.equal(event['状态'],'进行中');assert.equal(workflowEventApproved(event),true);
 const row=await w.registryRegister(id,{requestId:randomUUID(),date:'2030-12-09',start:'09:00',end:'12:00',location:'鼓楼广场献血车',photoId:randomUUID()},person(999990011));
 await w.registryDecide(id,[{id:row._id,revision:1}],'verify','历史项目凭证已核实','owner');
 assert.equal(tables[WF.ledger].length,1);assert.equal(tables[WF.ledger][0]['状态'],'待批准');
 await w.endRegistry(id,'owner','已完成登记');
 assert.equal(event['状态'],'已结束');assert.equal((await w.registryList(id)).rows.length,1);
 assert.equal(projectWorkflowEvents((await w.publicRead()).events,[])[0].status,'已结束');
});
