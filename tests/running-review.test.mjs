import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinalHours} from '../lib/events/final-hours.js';
import {createRunningReview,runningLedgerEntries,isRunningLedgerRow} from '../lib/events/running-review.js';
import {parseRunningFile,matchRunningImport} from '../lib/events/running-import.js';
import {workflowApprovalHash,workflowEventApproved} from '../lib/events/workflow.js';
import {createMutationQueue} from '../lib/events/safety.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {workspaceStage} from '../public/app/shared/activity-workspace.js';
import {createActivityLifecycleStore} from '../lib/events/activity-lifecycle-store.js';
import {readHoursConfig} from '../lib/events/hours-config-state.js';
const config=()=>({workspaceSubmission:{origin:true},region:'苏州活动',center:'生命中心',approval:{mode:'workspace-regional',region:'suzhou',category:'生命中心',version:'1'}});
function fixture(stateStore){
 const event={_id:'parent',活动ID:'parent-code',状态:'进行中',申请版本:'1',批准版本:'1',负责人账号ID:'director',活动地区:'苏州地区',组织类别:'生命中心',报名页配置:JSON.stringify(config())};
 event['批准摘要']=workflowApprovalHash(event);
 const data={events:[event],registrations:[{_id:'one',活动ID:'parent-code',账号ID:'account-one',姓名:'合成甲',学号:'20300001',报名状态:'已确认',签到照片ID:'synthetic-photo'}],checkins:[],ledger:[]};
 const roster={complete:true,rows:[{accountId:'director',role:'director',region:'suzhou',categories:['生命中心'],active:true},{accountId:'other',role:'director',region:'suzhou',categories:['生命中心'],active:true},{accountId:'chair',role:'presidium',region:'suzhou',categories:[],active:true},{accountId:'nj-chair',role:'presidium',region:'nanjing',categories:[],active:true}]};
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>structuredClone(roster)});let writes=0,lost=false,sequence=0;
 const update=async(table,row,patch)=>{writes++;const target=table==='events'?data.events.find(item=>item._id===row._id)||row:data.ledger.find(item=>item._id===row._id)||row;Object.assign(target,patch);if(target!==row)Object.assign(row,patch);if(lost){lost=false;throw Error('lost response');}};
 const append=async(table,row)=>{writes++;const saved={...row,_id:`row-${++sequence}`};if(table==='ledger')data.ledger.push(saved);return saved;};
 const updateRows=async(table,rows,patchOf)=>{for(const row of rows){writes++;const patch=patchOf(row),target=data.ledger.find(item=>item._id===row._id)||row;Object.assign(target,patch);Object.assign(row,patch);}};
 const appendRows=async(table,rows)=>{const saved=rows.map(row=>{writes++;const item={...row,_id:`row-${++sequence}`};if(table==='ledger')data.ledger.push(item);return item;});return saved;};
 const review=createRunningReview({stateStore,read:async()=>structuredClone(data),write:createMutationQueue(),WF:{events:'events',ledger:'ledger'},update,append,appendRows,updateRows,approved:workflowEventApproved,authorize:(row,actor)=>routing.assertHoursRecorder(row,actor),secret:'synthetic-review-secret',now:()=>123456});
 const item={id:'one',serviceHours:2,trainingHours:0,travelHours:0,decision:'pass',reason:'',evidenceChecked:true};
 return {review,data,event,roster,item,storage:{read:async()=>structuredClone(data),write:createMutationQueue(),update,append,appendRows,updateRows,WF:{events:'events',ledger:'ledger'},approved:workflowEventApproved,authorizeRead:routing.assertRegistrar,authorizeReview:routing.assertHoursReviewer,recipient:routing.hoursRecipient},writes:()=>writes,lose:()=>{lost=true;}};
}
test('review state overflows preserve approval, initial reopening, final edits and archive guards',async()=>{
 const store=createActivityLifecycleStore(),f=fixture(store);
 try{
  Object.assign(f.event,{地点:'合成场地',工作内容:'合成服务',报名日期:'2030-01-01',报名时段:'09:00-11:00'});
  Object.assign(f.roster.rows[0],{email:'synthetic@example.test',emailVerified:true});
  const c=JSON.parse(f.event['报名页配置']);c.description='文'.repeat(9680-JSON.stringify(c).length);f.event['报名页配置']=JSON.stringify(c);f.event['批准摘要']=workflowApprovalHash(f.event);
  let state=await f.review.runningReview('parent','director');await f.review.saveRunningReview('parent',{token:state.token,items:[f.item]},'director');state=await f.review.runningReview('parent','director');let proof=await f.review.previewRunningReview('parent',{token:state.token,items:state.entries},'director');await f.review.submitRunningReview('parent',{token:proof.token,items:proof.items,previewToken:proof.previewToken},'director');
  assert.ok(JSON.parse(f.event['报名页配置']).runningReview.stateRef);assert.equal(workflowApprovalHash(f.event),f.event['批准摘要']);
  const submitted=readHoursConfig(f.event,store).runningReview;assert.equal(submitted.sourceDigest.length,64);assert.equal(submitted.previewToken,proof.previewToken);
  await f.review.reopenRunningReview('parent',{reason:'合成纸质名单核对'},'director');state=await f.review.runningReview('parent','director');assert.equal(state.canRecord,true);assert.equal(state.entries[0].decision,'pass');
  proof=await f.review.previewRunningReview('parent',{token:state.token,items:state.entries},'director');await f.review.submitRunningReview('parent',{token:proof.token,items:proof.items,previewToken:proof.previewToken},'director');
  const final=createFinalHours({...f.storage,stateStore:store,now:()=>123456});let sheet=await final.finalHours('parent','chair');await final.saveFinalHours('parent',{token:sheet.token,items:[{id:'one',serviceHours:4,remark:'保留合成终审修改'}]},'chair');
  await f.review.reopenRunningReview('parent',{reason:'核对遗漏岗位'},'director');state=await f.review.runningReview('parent','director');proof=await f.review.previewRunningReview('parent',{token:state.token,items:state.entries},'director');await f.review.submitRunningReview('parent',{token:proof.token,items:proof.items,previewToken:proof.previewToken},'director');
  sheet=await final.finalHours('parent','chair');assert.equal(sheet.rows[0].serviceHours,4);assert.equal(sheet.rows[0].remark,'保留合成终审修改');await final.exportFinalHours('parent',{token:sheet.token},'chair');
  assert.ok(f.event['报名页配置'].length<=10000);assert.equal(JSON.parse(f.event['报名页配置']).description,c.description);assert.equal(workflowApprovalHash(f.event),f.event['批准摘要']);
  await assert.rejects(f.review.reopenRunningReview('parent',{reason:'不能重开已归档'},'director'),{statusCode:409});
  const raw=JSON.parse(f.event['报名页配置']);if(raw.finalHours.stateRef){assert.throws(()=>readHoursConfig({...f.event,_id:'foreign'},store),{statusCode:503});assert.throws(()=>readHoursConfig(f.event),{statusCode:503});}
 }finally{store.close();}
});

test('first review requires current ownership or trusted global authority; final role alone is insufficient',async()=>{
 const f=fixture(),before=await f.review.runningReview('parent','director');assert.equal(before.canRecord,true);
 f.roster.rows.push({accountId:'super',role:'global',region:'suzhou',categories:[],active:true});
 assert.equal((await f.review.runningReview('parent','super')).canRecord,true);
 for(const actor of ['other','chair','nj-chair']){assert.equal((await f.review.runningReview('parent',actor)).canRecord,false);await assert.rejects(f.review.saveRunningReview('parent',{token:before.token,items:[f.item]},actor),{statusCode:403});}
 f.roster.rows[0].active=false;await assert.rejects(f.review.saveRunningReview('parent',{token:before.token,items:[f.item]},'director'),{statusCode:403});assert.equal(f.writes(),0);
});
test('project-wide first review opens when any session is owned, and states the refusal reason',async()=>{
 const f=fixture(),c=JSON.parse(f.event['报名页配置']);
 c.ordinary={groupId:'synthetic-week'};c.bookingMode='grouped';c.positionPlan={groupId:'synthetic-week'};
 f.event['报名页配置']=JSON.stringify(c);f.event['批准摘要']=workflowApprovalHash(f.event);
 // 第二场次换负责人：逐场次取交集会让整份初审无人可交。
 const peer={...f.event,_id:'peer',活动ID:'peer-code',负责人账号ID:'other',报名页配置:JSON.stringify({...c,bookingMode:'unified',parentActivityId:'parent-code'})};
 peer['批准摘要']=workflowApprovalHash(peer);f.data.events.push(peer);
 f.roster.rows.push({accountId:'stranger',role:'director',region:'suzhou',categories:['生命中心'],active:true});
 assert.equal((await f.review.runningReview('parent','director')).canRecord,true);
 assert.equal((await f.review.runningReview('parent','other')).canRecord,true);
 const denied=await f.review.runningReview('parent','stranger');
 assert.equal(denied.canRecord,false);
 assert.match(denied.canRecordReason,/负责人或超级管理员/);
 f.data.registrations[0]['活动ID']='peer-code';delete f.data.registrations[0]['签到照片ID'];
 for(const actor of ['chair','stranger'])await assert.rejects(f.review.previewRunningReview('parent',{token:denied.token,items:[f.item]},actor),{statusCode:403});
 const state=await f.review.runningReview('parent','other');
 await f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,evidenceChecked:false}]},'other');
 const saved=await f.review.runningReview('parent','other'),proof=await f.review.previewRunningReview('parent',{token:saved.token,items:saved.entries},'other');
 const submission={token:proof.token,items:proof.items,previewToken:proof.previewToken};
 await f.review.submitRunningReview('parent',submission,'other');
 f.data.ledger.reverse();
 assert.deepEqual(await f.review.submitRunningReview('parent',submission,'other'),{submitted:true});
 f.roster.rows.find(row=>row.accountId==='other').active=false;
 await assert.rejects(f.review.submitRunningReview('parent',submission,'other'),{statusCode:403});
 assert.equal(f.data.checkins.length,0);

 await assert.rejects(f.review.saveRunningReview('parent',{token:denied.token,items:[f.item]},'stranger'),{statusCode:403});
});
test('draft lands on isolated ledger rows instead of the 10000-char activity config',async()=>{
 const f=fixture(),before=await f.review.runningReview('parent','director');await f.review.saveRunningReview('parent',{token:before.token,items:[{...f.item,decision:'fail',reason:'未按要求完成',evidenceChecked:false}]},'director');
 const state=await f.review.runningReview('parent','director');assert.equal(state.entries[0].decision,'fail');assert.equal(f.data.checkins.length,0);
 const rows=f.data.ledger.filter(isRunningLedgerRow);
 assert.equal(rows.length,1);assert.equal(rows[0]['状态'],'草稿');assert.equal(rows[0]['幂等键'],'RUNNING:one');
 // 配置里不再保存逐人明细，只留流程状态，因此不会再撞上文本列上限。
 assert.equal(JSON.parse(f.event['报名页配置']).runningReview.entries,undefined);
 assert.equal(JSON.parse(f.event['报名页配置']).runningReview.entryCount,1);
 assert.equal(workflowEventApproved(f.event),true);assert.equal(workspaceStage(f.event),'进行中');
 await assert.rejects(f.review.saveRunningReview('parent',{token:before.token,items:[f.item]},'director'),{statusCode:409});
});
test('all records and fresh preview are mandatory; changes invalidate preview and submission is retry-safe',async()=>{
 const f=fixture(),state=await f.review.runningReview('parent','director'),body={token:state.token,items:[f.item]};
 await assert.rejects(f.review.submitRunningReview('parent',body,'director'),{statusCode:409});
 await assert.rejects(f.review.previewRunningReview('parent',{...body,items:[{...f.item,decision:''}]},'director'),{statusCode:409});
 const proof=await f.review.previewRunningReview('parent',body,'director');f.data.registrations[0]['签到提交时间']='changed';
 await assert.rejects(f.review.submitRunningReview('parent',{...body,previewToken:proof.previewToken},'director'),{statusCode:409});
 const fresh=await f.review.runningReview('parent','director'),next=await f.review.previewRunningReview('parent',{...body,token:fresh.token},'director'),submit={token:next.token,items:next.items,previewToken:next.previewToken};f.lose();
 await assert.rejects(f.review.submitRunningReview('parent',submit,'director'),/lost response/);assert.deepEqual(await f.review.submitRunningReview('parent',submit,'director'),{submitted:true});
 assert.equal(workspaceStage(f.event),'时长审核');assert.equal(workflowEventApproved(f.event),true);
 // 提交后明细行转入「待批准」，供终审环节读取；不会进入已批准汇总。
 assert.equal(f.data.ledger.filter(isRunningLedgerRow).length,1);
 assert.equal(f.data.ledger.find(isRunningLedgerRow)['状态'],'待批准');
 await assert.rejects(f.review.saveRunningReview('parent',{token:fresh.token,items:[f.item]},'director'),{statusCode:409});
});
test('attendance is optional while reasons, identities and complete review remain enforced',async()=>{
 const f=fixture();delete f.data.registrations[0]['签到照片ID'];let state=await f.review.runningReview('parent','director');
 const preview=await f.review.previewRunningReview('parent',{token:state.token,items:[{...f.item,evidenceChecked:false}]},'director');assert.equal(preview.items[0].decision,'pass');assert.equal(f.data.checkins.length,0);
 await assert.rejects(f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,decision:'fail',reason:''}]},'director'),{statusCode:400});
 await assert.rejects(f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,id:'foreign'}]},'director'),{statusCode:409});
 f.data.registrations.push({...f.data.registrations[0],_id:'two'});state=await f.review.runningReview('parent','director');await assert.rejects(f.review.previewRunningReview('parent',{token:state.token,items:[{...f.item,decision:'fail',reason:'未参加'}]},'director'),{statusCode:409});
});
test('attendance changes clear saved decisions and no empty submission is accepted',async()=>{
 const f=fixture(),state=await f.review.runningReview('parent','director');await f.review.saveRunningReview('parent',{token:state.token,items:[f.item]},'director');
 assert.equal((await f.review.runningReview('parent','director')).entries[0].decision,'pass');f.data.registrations[0]['签到照片ID']='different-photo';
 const changed=await f.review.runningReview('parent','director');assert.equal(changed.entries[0].decision,'');assert.equal(changed.entries[0].evidenceChecked,false);assert.equal(changed.entries[0].sourceDigest,undefined);
 f.data.registrations=[];const empty=await f.review.runningReview('parent','director');await assert.rejects(f.review.previewRunningReview('parent',{token:empty.token,items:[]},'director'),/没有可提交/);
});

test('optional attendance links retain safe web addresses and reject executable or credential-bearing links',async()=>{
 const f=fixture(),state=await f.review.runningReview('parent','director');
 for(const attendanceUrl of ['javascript:alert(1)','data:text/html,test','https://user:secret@example.test/photo'])await assert.rejects(f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,attendanceUrl}]},'director'),{statusCode:400});
 await f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,attendanceUrl:'https://example.test/attendance',evidenceChecked:false}]},'director');
 assert.equal((await f.review.runningReview('parent','director')).entries[0].attendanceUrl,'https://example.test/attendance');
});

test('running grouped projects keep detail and review available after contact updates without reapproval',async()=>{
 const f=fixture(),c=JSON.parse(f.event['报名页配置']);
 c.ordinary={groupId:'synthetic-running-project'};c.bookingMode='grouped';c.positionPlan={groupId:'synthetic-running-project'};
 f.event['报名页配置']=JSON.stringify(c);f.event['批准摘要']=workflowApprovalHash(f.event);
 const child={...f.event,_id:'child',活动ID:'child-code',报名页配置:JSON.stringify({...c,bookingMode:'unified',parentActivityId:'parent-code',positionPlan:undefined})};
 child['批准摘要']=workflowApprovalHash(child);f.data.events.push(child);f.data.registrations[0]['活动ID']='child-code';
 for(const row of f.data.events)row['报名页配置']=JSON.stringify({...JSON.parse(row['报名页配置']),registrationContact:{qqGroup:'123456789',notes:'合成联系人变更'}});
 const state=await f.review.runningReview('parent','director');assert.equal(state.canRecord,true);
 await f.review.saveRunningReview('parent',{token:state.token,items:[f.item]},'director');
 assert.equal((await f.review.runningReview('parent','director')).entries[0].decision,'pass');
 child['状态']='报名中';await assert.rejects(f.review.runningReview('parent','director'),{statusCode:409});
 child['状态']='进行中';child['容量']='999';await assert.rejects(f.review.runningReview('parent','director'),{statusCode:409});
});

test('a 16-session blood week keeps 384 participants reviewable without any 200-record ceiling',async()=>{
 // 现场规模：献血周按周一归周，16 个场次、每场 24 人 = 384 条参与记录。
 // 旧实现把明细整包写进「报名页配置」，48 条就会超出 10000 字符并被静默截断。
 const f=fixture(),base=JSON.parse(f.event['报名页配置']);
 base.ordinary={groupId:'blood-week'};base.bookingMode='grouped';base.positionPlan={groupId:'blood-week'};
 f.event['报名页配置']=JSON.stringify(base);f.event['批准摘要']=workflowApprovalHash(f.event);
 f.data.registrations=[];f.data.events=[f.event];
 for(let session=0;session<16;session+=1){
  const code=`session-${session}`,child={...f.event,_id:`child-${session}`,活动ID:code,报名页配置:JSON.stringify({...base,bookingMode:'unified',parentActivityId:'parent-code',positionPlan:undefined})};
  child['批准摘要']=workflowApprovalHash(child);f.data.events.push(child);
  for(let index=0;index<24;index+=1)f.data.registrations.push({_id:`reg-${session}-${index}`,活动ID:code,账号ID:`account-${session}-${index}`,姓名:`合成${session}-${index}`,学号:`2030${String(session).padStart(2,'0')}${String(index).padStart(2,'0')}`,报名状态:'已确认',签到照片ID:'synthetic-photo'});
 }
 assert.equal(f.data.registrations.length,384);
 const state=await f.review.runningReview('parent','director');
 assert.equal(state.canRecord,true);
 // 初次打开时没有已保存明细，前端按参与名单渲染 384 行待填。
 assert.equal(state.entries.length,0);
 const items=f.data.registrations.map(row=>({id:row._id,serviceHours:2,trainingHours:1,travelHours:1,decision:'pass',reason:'',evidenceChecked:true}));
 await f.review.saveRunningReview('parent',{token:state.token,items},'director');
 // 配置体积不随人数增长：明细在台账行里，一人一行。
 assert.ok(JSON.stringify(JSON.parse(f.event['报名页配置'])).length<2000);
 assert.equal(f.data.ledger.filter(isRunningLedgerRow).length,384);
 const saved=await f.review.runningReview('parent','director');
 assert.equal(saved.entries.length,384);assert.ok(saved.entries.every(entry=>entry.decision==='pass'));
 const proof=await f.review.previewRunningReview('parent',{token:saved.token,items},'director');
 await f.review.submitRunningReview('parent',{token:saved.token,items:proof.items,previewToken:proof.previewToken},'director');
 assert.equal(f.data.ledger.filter(isRunningLedgerRow).every(row=>row['状态']==='待批准'),true);
 f.data.ledger.reverse();assert.deepEqual(await f.review.submitRunningReview('parent',{token:saved.token,items:proof.items,previewToken:proof.previewToken},'director'),{submitted:true});
 const rolled=runningLedgerEntries(f.data,new Set(f.data.events.map(row=>row['活动ID'])));
 assert.equal(rolled.length,384);assert.equal(rolled[0].serviceHours,2);
});


test('bulk initial review preserves unselected records, refuses missing rejection reasons and revoked co-owners',async()=>{
 const f=fixture();delete f.data.registrations[0]['签到照片ID'];
 f.data.registrations.push({...f.data.registrations[0],_id:'two',学号:'00000002'});
 const c=JSON.parse(f.event['报名页配置']);c.coOwners=['other'];f.event['报名页配置']=JSON.stringify(c);f.event['批准摘要']=workflowApprovalHash(f.event);
 let state=await f.review.runningReview('parent','other');assert.equal(state.canRecord,true);
 await assert.rejects(f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,decision:'fail',reason:''},{...f.item,id:'two'}]},'other'),{statusCode:400});assert.equal(f.writes(),0);
 await f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,evidenceChecked:false}]},'other');
 state=await f.review.runningReview('parent','other');assert.deepEqual(state.entries.map(row=>row.id),['one']);
 await assert.rejects(f.review.previewRunningReview('parent',{token:state.token,items:state.entries},'other'),{statusCode:409});
 const before=state.token;
 await f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,id:'two',decision:'fail',reason:'纸质名单核对未参加',evidenceChecked:false}]},'other');
 await assert.rejects(f.review.saveRunningReview('parent',{token:before,items:[f.item]},'other'),{statusCode:409});
 state=await f.review.runningReview('parent','other');assert.equal(state.entries.find(row=>row.id==='one').serviceHours,2);assert.equal(state.entries.find(row=>row.id==='two').decision,'fail');
 assert.equal(f.data.checkins.length,0);assert.equal(f.data.ledger.some(row=>row['状态']==='已批准'),false);
 f.roster.rows.find(row=>row.accountId==='other').active=false;await assert.rejects(f.review.saveRunningReview('parent',{token:state.token,items:state.entries},'other'),{statusCode:403});
});


test('legacy first review keeps every other record when a subset migrates to ledger storage',async()=>{
 const f=fixture();f.data.registrations.push({...f.data.registrations[0],_id:'two'});
 const c=JSON.parse(f.event['报名页配置']);c.runningReview={status:'draft',entries:[{...f.item,sourceDigest:'legacy'},{...f.item,id:'two',serviceHours:7,sourceDigest:'legacy'}]};f.event['报名页配置']=JSON.stringify(c);
 const state=await f.review.runningReview('parent','director');
 await f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,serviceHours:3}]},'director');
 const saved=await f.review.runningReview('parent','director');assert.equal(saved.entries.length,2);assert.equal(saved.entries.find(row=>row.id==='two').serviceHours,7);assert.equal(f.data.ledger.filter(isRunningLedgerRow).length,2);
});

test('a concurrent ledger edit invalidates the token even with an unchanged timestamp',async()=>{
 const f=fixture(),before=await f.review.runningReview('parent','director');await f.review.saveRunningReview('parent',{token:before.token,items:[f.item]},'director');
 const state=await f.review.runningReview('parent','director');f.data.ledger.find(isRunningLedgerRow)['服务时长']=9;
 await assert.rejects(f.review.saveRunningReview('parent',{token:state.token,items:[f.item]},'director'),{statusCode:409});
});

for(const actor of ['director','super'])test(`paper attendance ${actor}: initial confirmation, separate final authorization, and locked export`,async()=>{
 const f=fixture();Object.assign(f.event,{地点:'合成场地',工作内容:'合成服务',报名日期:'2030-01-01',报名时段:'09:00-11:00'});f.event['批准摘要']=workflowApprovalHash(f.event);
 delete f.data.registrations[0]['签到照片ID'];Object.assign(f.roster.rows[0],{email:'director@example.test',emailVerified:true});
 f.roster.rows.push({accountId:'super',role:'global',region:'suzhou',categories:[],active:true});
 let state=await f.review.runningReview('parent',actor);
 const items=[{...f.item,evidenceChecked:false}];await f.review.saveRunningReview('parent',{token:state.token,items},actor);
 state=await f.review.runningReview('parent',actor);const proof=await f.review.previewRunningReview('parent',{token:state.token,items:state.entries},actor);
 await f.review.submitRunningReview('parent',{token:proof.token,items:proof.items,previewToken:proof.previewToken},actor);
 const final=createFinalHours({...f.storage,now:()=>123456}),sheet=await final.finalHours('parent','chair');assert.equal(sheet.canEdit,true);
 await assert.rejects(final.exportFinalHours('parent',{token:sheet.token},'director'),{statusCode:403});
 await final.saveFinalHours('parent',{token:sheet.token,items:[{id:'one',decision:'pass',reason:''}]},'chair');
 const saved=await final.finalHours('parent','chair');await final.exportFinalHours('parent',{token:saved.token},'chair');
 assert.equal(f.event['状态'],'已结束');assert.equal(f.data.checkins.length,0);assert.equal(f.data.registrations[0]['报名状态'],'已确认');
 assert.ok((await final.downloadFinalHours('parent','director')).buffer.length>0);
 await assert.rejects(final.saveFinalHours('parent',{token:saved.token,items:[{id:'one',decision:'pass'}]},'chair'),{statusCode:409});
});
test('template download carries the roster identity, disambiguation columns and preset hours; refused without review authority',async()=>{
 const f=fixture(),reg=f.data.registrations[0];
 reg['报名日期']='2026-10-26';reg['报名时段']='上午';reg['岗位']='引导岗';
 const settings=JSON.parse(f.event['报名页配置']);settings.positionHours={serviceHours:4,trainingHours:0,travelHours:1};
 f.event['报名页配置']=JSON.stringify(settings);f.event['批准摘要']=workflowApprovalHash(f.event);
 const file=await f.review.runningTemplate('parent','director');
 assert.match(file.filename,/时长初审名单\.xlsx$/);
 // 回读走的是与上传完全相同的解析器：列名一旦分叉，这里就会先炸。
 const rows=await parseRunningFile({name:'template.xlsx',bytes:file.buffer.toString('base64')});
 assert.deepEqual(Object.keys(rows[0]).sort(),['姓名','学号','岗位','日期','时段','报名ID','服务时长','培训时长','交通时长'].sort());
 assert.equal(rows[0]['姓名'],'合成甲');assert.equal(rows[0]['学号'],'20300001');
 assert.equal(rows[0]['岗位'],'引导岗');assert.equal(rows[0]['日期'],'2026-10-26');assert.equal(rows[0]['时段'],'上午');
 assert.equal(rows[0]['报名ID'],'one');
 // 模板必须是可上传的：同一份数据能唯一匹配回这条报名记录。
 assert.equal(matchRunningImport(rows,[reg],[{活动ID:'parent-code',岗位:'引导岗'}])[0].id,'one');
 for(const actor of ['other','chair'])await assert.rejects(f.review.runningTemplate('parent',actor),{statusCode:403});
});
test('submitted review can be reopened to include a missed session without losing ledger rows',async()=>{
 const f=fixture(),state=await f.review.runningReview('parent','director');
 await f.review.saveRunningReview('parent',{token:state.token,items:[f.item]},'director');
 const saved=await f.review.runningReview('parent','director'),proof=await f.review.previewRunningReview('parent',{token:saved.token,items:saved.entries},'director');
 await f.review.submitRunningReview('parent',{token:proof.token,items:proof.items,previewToken:proof.previewToken},'director');
 const ledgerBefore=f.data.ledger.length;
 await assert.rejects(f.review.reopenRunningReview('parent',{},'director'),{statusCode:400});
 await f.review.reopenRunningReview('parent',{reason:'上午场遗漏'},'director');
 const reopened=JSON.parse(f.event['报名页配置']).runningReview;
 assert.equal(reopened.status,'draft');
 assert.equal(reopened.reopenReason,'上午场遗漏');
 assert.equal(f.data.ledger.length,ledgerBefore);
 assert.equal((await f.review.runningReview('parent','director')).canRecord,true);
});


test('explicit reopen recovers a changed enrollment without discarding other saved final edits',async()=>{
 const f=fixture();Object.assign(f.event,{地点:'合成场地',工作内容:'合成服务',报名日期:'2030-01-01',报名时段:'09:00-11:00'});f.event['批准摘要']=workflowApprovalHash(f.event);
 const rejected={_id:'rejected',活动ID:'parent-code',账号ID:'late-member',姓名:'合成补确认',学号:'20300002',报名状态:'未入选',报名日期:'2030-01-01',报名时段:'09:00-11:00'};f.data.registrations.push(rejected);
 let state=await f.review.runningReview('parent','director');await f.review.saveRunningReview('parent',{token:state.token,items:[f.item]},'director');state=await f.review.runningReview('parent','director');let proof=await f.review.previewRunningReview('parent',{token:state.token,items:state.entries},'director');await f.review.submitRunningReview('parent',{token:proof.token,items:proof.items,previewToken:proof.previewToken},'director');
 const final=createFinalHours({...f.storage,now:()=>123456});let sheet=await final.finalHours('parent','chair');await final.saveFinalHours('parent',{token:sheet.token,items:[{id:'one',serviceHours:3,remark:'其他有效终审修改'}]},'chair');
 rejected['报名状态']='已确认';await assert.rejects(final.finalHours('parent','chair'),/参与或签到依据已改变/);
 await assert.rejects(f.review.reopenRunningReview('parent',{reason:'核对原报名变化'},'other'),{statusCode:403});
 await f.review.reopenRunningReview('parent',{reason:'负责人核对新增实际参加人员'},'director');state=await f.review.runningReview('parent','director');assert.equal(state.entries.find(row=>row.id==='one').decision,'pass');
 await f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,id:'rejected',evidenceChecked:false}]},'director');state=await f.review.runningReview('parent','director');proof=await f.review.previewRunningReview('parent',{token:state.token,items:state.entries},'director');await f.review.submitRunningReview('parent',{token:proof.token,items:proof.items,previewToken:proof.previewToken},'director');
 sheet=await final.finalHours('parent','chair');assert.equal(sheet.rows.length,2);assert.equal(sheet.rows.find(row=>row.id==='one').serviceHours,3);assert.equal(sheet.rows.find(row=>row.id==='one').remark,'其他有效终审修改');
});
