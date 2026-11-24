import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createFinalHours,groupFinalHoursRows} from '../lib/events/final-hours.js';
import {runningSourceDigest,supplementRowsOf} from '../lib/events/running-review.js';
import {workflowApprovalHash,workflowEventApproved} from '../lib/events/workflow.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {createMutationQueue} from '../lib/events/safety.js';

/**
 * 补录链路的合成场景：一个已有点位活动，初审处于 `phase` 指定阶段。
 * `addParticipant` 同时写入读取副本与真实数据——真实实现（manual-hours.js）
 * 就是这样把报名行同时推给调用方与表存储的。
 */
function fixture({phase='draft'}={}){
 const event={_id:'p',活动ID:'p-code',活动名称:'合成补录活动',状态:'进行中',申请版本:'1',批准版本:'1',负责人账号ID:'director',
  活动地区:'苏州地区',组织类别:'生命中心',地点:'合成场馆',工作内容:'合成服务',报名日期:'2030-01-01',报名时段:'09:00—12:00',岗位:'现场服务',
  报名页配置:JSON.stringify({workspaceSubmission:{origin:true},region:'苏州活动',center:'生命中心',approval:{mode:'workspace-regional',region:'suzhou',category:'生命中心',version:'1'}})};
 event['批准摘要']=workflowApprovalHash(event);
 const data={events:[event],
  registrations:[{_id:'r',活动ID:'p-code',姓名:'合成甲',学号:'00123456',账号ID:'member',院系:'合成学院',报名日期:'2030-01-01',报名时段:'09:00—12:00',报名状态:'已签到',签到照片ID:'synthetic-photo'}],
  checkins:[],ledger:[]};
 const config=JSON.parse(event['报名页配置']);
 config.runningReview={status:phase,sourceDigest:runningSourceDigest(data.events,data.registrations,data.checkins,data.ledger),
  previewToken:'proof',entries:[{id:'r',serviceHours:3,trainingHours:1,travelHours:0,decision:'pass',reason:'',evidenceChecked:true}]};
 event['报名页配置']=JSON.stringify(config);
 const roster={complete:true,rows:[
  {accountId:'director',region:'suzhou',role:'director',categories:['生命中心'],active:true,emailVerified:true,email:'director@example.test'},
  {accountId:'chair',region:'suzhou',role:'presidium',categories:[],active:true,emailVerified:true,email:'chair@example.test'},
  {accountId:'other',region:'suzhou',role:'director',categories:['生命中心'],active:true,emailVerified:true,email:'other@example.test'},
 ]};
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>structuredClone(roster)});
 let seq=0,writes=0;
 const update=async(table,row,patch)=>{writes++;const target=table==='events'?data.events.find(item=>item._id===row._id)||row:data.ledger.find(item=>item._id===row._id)||row;Object.assign(target,patch);if(target!==row)Object.assign(row,patch);};
 const append=async(table,row)=>{writes++;const saved={...row,_id:`row-${++seq}`};if(table==='ledger')data.ledger.push(saved);return saved;};
 const appendRows=async(table,rows)=>{const saved=rows.map(row=>{writes++;const item={...row,_id:`row-${++seq}`};if(table==='ledger')data.ledger.push(item);return item;});return saved;};
 const updateRows=async(table,rows,patchOf)=>{for(const row of rows){writes++;const patch=patchOf(row),target=data.ledger.find(item=>item._id===row._id)||row;Object.assign(target,patch);Object.assign(row,patch);}};
 const addParticipant=async(ctxData,job,input,actor,participant)=>{
  const id=`reg-${++seq}`,checkinId=`chk-${++seq}`;
  const registration={_id:id,活动ID:job['活动ID'],活动名称:job['活动名称'],岗位:job['岗位'],
   账号ID:participant?.accountId||`manual:${input.studentId}`,姓名:input.name,学号:input.studentId,院系:input.department,
   报名ID:`WMH-${input.requestId}-${'b'.repeat(32)}`,报名日期:job['报名日期'],报名时段:job['报名时段'],
   报名状态:'已签到',是否报名成功:'true',签到行ID:checkinId,处理说明:'时长补录'};
  data.registrations.push(registration);ctxData.registrations.push(registration);
  return {registration,checkin:{_id:checkinId}};
 };
 const service=createFinalHours({read:async()=>structuredClone(data),write:createMutationQueue(),update,append,appendRows,updateRows,
  WF:{events:'events',ledger:'ledger',registrations:'registrations'},approved:workflowEventApproved,
  authorizeRead:routing.assertRegistrar,authorizeReview:routing.assertHoursReviewer,authorizeSupplement:routing.assertHoursRecorder,
  recipient:routing.hoursRecipient,addParticipant,manualEvidence:()=>true,now:()=>1700000000000});
 return {service,data,event,roster,writes:()=>writes};
}
const body=({requestId='11111111-1111-1111-1111-111111111111',...extra}={})=>({
 requestId,eventId:'p',accountId:'member',name:'合成乙',studentId:'00654321',department:'合成学院',
 details:{serviceHours:4,trainingHours:1,travelHours:0,work:'幕后策划',location:'合成场馆',dates:'2030-01-01 09:00—12:00'},
 reason:'负责幕后策划，没有报名也没有到场',evidenceChecked:true,...extra});

test('director supplements while the first review is still a draft',async()=>{
 const f=fixture({phase:'draft'});
 // 草稿阶段 `finalHours()` 会因「初审未提交/名单不完整」409，补录必须绕开它。
 await assert.rejects(f.service.finalHours('p','chair'),{statusCode:409});
 const result=await f.service.addSupplement('p',body(),'director',{accountId:'member'});
 assert.equal(result.approval,'pending');
 const list=await f.service.hoursSupplementList('p','director');
 assert.equal(list.items.length,1);
 assert.equal(list.items[0].approval,'pending');
 assert.equal(list.items[0].canRevoke,true);
 assert.equal(list.items[0].name,'合成乙');
});

test('only the project owner may supplement, and unregistered identities are rejected',async()=>{
 const f=fixture({phase:'draft'});
 await assert.rejects(f.service.addSupplement('p',body(),'other',{accountId:'member'}),{statusCode:403});
 // 主席团有终审权，但没有补录权：补录与初审同口径。
 await assert.rejects(f.service.addSupplement('p',body(),'chair',{accountId:'member'}),{statusCode:403});
 await assert.rejects(f.service.addSupplement('p',body(),'director',undefined),{statusCode:400});
 assert.equal(f.data.registrations.length,1);
});

test('a pending supplement blocks export until the presidium confirms it',async()=>{
 const f=fixture({phase:'submitted'});
 const {id}=await f.service.addSupplement('p',body(),'director',{accountId:'member'});
 let sheet=await f.service.finalHours('p','chair');
 const row=sheet.rows.find(item=>item.id===id);
 assert.equal(row.manual,true);
 assert.equal(row.manualApproval,'pending');
 await assert.rejects(f.service.exportFinalHours('p',{token:sheet.token},'chair'),/待主席团确认/);
 assert.equal(f.event['状态'],'进行中');
 const confirmed=await f.service.confirmSupplement('p',{rowId:id},'chair');
 assert.equal(confirmed.approval,'approved');
 assert.equal(confirmed.selfReview,false);
 sheet=await f.service.finalHours('p','chair');
 assert.equal(sheet.rows.find(item=>item.id===id).manualApproval,'approved');
 await f.service.exportFinalHours('p',{token:sheet.token},'chair');
 assert.equal(f.event['状态'],'已结束');
});

test('the director cannot confirm their own supplement unless also presidium, and self-review is flagged',async()=>{
 const f=fixture({phase:'submitted'});
 const {id}=await f.service.addSupplement('p',body(),'director',{accountId:'member'});
 await assert.rejects(f.service.confirmSupplement('p',{rowId:id},'other'),{statusCode:403});
 // 主任本身没有终审资格，即使是他补的也不能自己确认。
 await assert.rejects(f.service.confirmSupplement('p',{rowId:id},'director'),{statusCode:403});
 // 兼任主席团后允许确认，但要留自审标记。
 f.roster.rows.find(item=>item.accountId==='director').role='presidium';
 const result=await f.service.confirmSupplement('p',{rowId:id},'director');
 assert.equal(result.approval,'approved');
 assert.equal(result.selfReview,true);
});

test('revoking is limited to the author and to pending rows, and removes them from the list',async()=>{
 const f=fixture({phase:'draft'});
 const {id}=await f.service.addSupplement('p',body(),'director',{accountId:'member'});
 await assert.rejects(f.service.revokeSupplement('p',{rowId:id},'other'),{statusCode:403});
 const result=await f.service.revokeSupplement('p',{rowId:id},'director');
 assert.equal(result.approval,'revoked');
 assert.equal((await f.service.hoursSupplementList('p','director')).items.length,0);
 // 已撤回的不能再撤一次，也不会重新进导出口径。
 await assert.rejects(f.service.revokeSupplement('p',{rowId:id},'director'),{statusCode:409});
 await assert.rejects(f.service.confirmSupplement('p',{rowId:id},'chair'),{statusCode:409});
});

test('supplementing never invalidates an already submitted first review',async()=>{
 const f=fixture({phase:'submitted'});
 const before=JSON.parse(f.event['报名页配置']).runningReview.sourceDigest;
 await f.service.addSupplement('p',body(),'director',{accountId:'member'});
 assert.equal(JSON.parse(f.event['报名页配置']).runningReview.sourceDigest,before);
 const sheet=await f.service.finalHours('p','chair');
 assert.equal(sheet.rows.length,2);
});

test('historic supplement rows without an approval field count as confirmed',async()=>{
 const f=fixture({phase:'submitted'});
 f.data.registrations.push({_id:'old-reg',活动ID:'p-code',姓名:'合成丙',学号:'00999999',账号ID:'member',院系:'合成学院',
  报名日期:'2030-01-01',报名时段:'09:00—12:00',报名状态:'已签到',是否报名成功:'true',签到行ID:'old-chk',
  报名ID:`WMH-22222222-2222-2222-2222-222222222222-${'c'.repeat(32)}`});
 f.data.ledger.push({_id:'old-final',幂等键:'FINAL:old-reg',报名行ID:'old-reg',活动ID:'p-code',学号:'00999999',
  服务时长:2,培训时长:0,交通时长:0,具体工作地点:'合成场馆',正式工作日期:'2030-01-01',工作内容:'历史补录',
  备注:JSON.stringify({v:2,d:'pass',e:true,f:'manual',r:'',m:{requestId:'22222222-2222-2222-2222-222222222222',fingerprint:'x',addedBy:'former'}}),
  状态:'待批准'});
 const sheet=await f.service.finalHours('p','chair');
 assert.equal(sheet.rows.find(item=>item.id==='old-reg').manualApproval,'approved');
 await f.service.exportFinalHours('p',{token:sheet.token},'chair');
 assert.equal(f.event['状态'],'已结束');
});

test('the exported workbook marks supplemented rows in the remark column',async()=>{
 const f=fixture({phase:'submitted'});
 const {id}=await f.service.addSupplement('p',body(),'director',{accountId:'member'});
 await f.service.confirmSupplement('p',{rowId:id},'chair');
 const sheet=await f.service.finalHours('p','chair');
 await f.service.exportFinalHours('p',{token:sheet.token},'chair');
 const file=await f.service.downloadFinalHours('p','director'),book=new ExcelJS.Workbook();
 await book.xlsx.load(file.buffer);
 const s=book.worksheets[0],rows=[];
 for(let index=2;index<=s.rowCount;index+=1)rows.push([s.getCell(`A${index}`).value,s.getCell(`J${index}`).value]);
 assert.ok(rows.some(([name,remark])=>name==='合成乙'&&String(remark).includes('补录')),'补录行应标注');
 assert.ok(rows.some(([name,remark])=>name==='合成甲'&&!String(remark||'').includes('补录')),'普通行不应标注');
});

test('the supplement view carries the position and all three hour fields',async()=>{
 // 进行中页与终审页共用这一个视图。曾经各写一份，其中一份漏了时长字段，
 // 界面就只剩「服务 undefined · 培训 undefined · 交通 undefined」。
 const finalRows=new Map([
  ['reg-1',{id:'reg-1',studentId:'00654321',serviceHours:4,trainingHours:1,travelHours:0,manual:true,manualApproval:'pending',addedBy:'director'}],
  ['reg-2',{id:'reg-2',studentId:'00777777',serviceHours:2,trainingHours:0,travelHours:1,manual:true,manualApproval:'revoked',addedBy:'director'}],
 ]);
 const registrations=[
  {_id:'reg-1',姓名:'合成乙',学号:'00654321',院系:'合成学院',岗位:'第二打卡点',活动ID:'p-code-2',报名状态:'已签到'},
  {_id:'reg-2',姓名:'合成丁',学号:'00777777',院系:'合成学院',岗位:'第一打卡点',活动ID:'p-code',报名状态:'已撤回'},
 ];
 // 两个岗位共用同一个地点，只有「岗位」能区分。
 const jobs=[{活动ID:'p-code',岗位:'第一打卡点',地点:'南京大学仙林校区'},{活动ID:'p-code-2',岗位:'第二打卡点',地点:'南京大学仙林校区'}];
 const rows=supplementRowsOf(finalRows,registrations,jobs,'director');
 assert.equal(rows.length,1,'已撤回的行不进补录列表');
 assert.equal(rows[0].position,'第二打卡点','岗位取报名行自己记录的那一个，不是项目第一个岗位');
 assert.equal(rows[0].serviceHours,4);
 assert.equal(rows[0].trainingHours,1);
 assert.equal(rows[0].travelHours,0);
 assert.equal(rows[0].canRevoke,true);
 // 其他人不能撤回：撤回只限补录人本人。
 assert.equal(supplementRowsOf(finalRows,registrations,jobs,'someone-else')[0].canRevoke,false);
});

test('confirming a supplement works when its row is merged with a normal registration',async()=>{
 const f=fixture({phase:'submitted'});
 const {id}=await f.service.addSupplement('p',body(),'director',{accountId:'member'});
 // 同一人另一场次的普通报名行：合并后前端只拿到组内排序第一行的 id。
 f.data.registrations.push({_id:'r2',活动ID:'p-code',姓名:'合成乙',学号:'00654321',账号ID:'member',院系:'合成学院',
  报名日期:'2030-01-02',报名时段:'13:00—16:00',报名状态:'已签到',签到照片ID:'photo-2'});
 const config=JSON.parse(f.event['报名页配置']);
 config.runningReview.entries.push({id:'r2',serviceHours:2,trainingHours:0,travelHours:0,decision:'pass',reason:'',evidenceChecked:true});
 config.runningReview.sourceDigest=runningSourceDigest(f.data.events,f.data.registrations,f.data.checkins,f.data.ledger);
 f.event['报名页配置']=JSON.stringify(config);
 const sheet=await f.service.finalHours('p','chair');
 const merged=sheet.rows.find(item=>item.studentId==='00654321');
 assert.equal(merged.manual,true);
 assert.notEqual(merged.id,id,'合并行 id 不等于补录行 id，正是报「补录记录不存在」的前提');
 // 前端传的是合并行 id：必须回查到同组的补录行，而不是 404。
 const confirmed=await f.service.confirmSupplement('p',{rowId:merged.id},'chair');
 assert.equal(confirmed.approval,'approved');
 const after=await f.service.finalHours('p','chair');
 assert.equal(after.rows.find(item=>item.studentId==='00654321').manualApproval,'approved');
});

test('the same slot written in two formats is not listed twice',async()=>{
 // 岗位行配置 `14:00:00-16:00:00`，报名页写 `14:00—16:00`：同一场，日期列只能出现一次。
 const [group]=groupFinalHoursRows([
  {id:'a',studentId:'001',dates:'2030-01-01 14:00—16:00',serviceHours:1,trainingHours:1,travelHours:1,decision:'pass',position:'第一打卡点'},
  {id:'b',studentId:'001',dates:'2030-01-01 14:00:00-16:00:00',serviceHours:1,trainingHours:1,travelHours:1,decision:'pass',position:'第一打卡点'},
 ]);
 assert.equal(group.merged.dates,'2030-01-01 14:00—16:00');
 assert.equal(group.merged.serviceHours,2);
});

test('merged rows inherit the pending approval instead of hiding it behind a normal row',async()=>{
 const f=fixture({phase:'submitted'});
 const {id}=await f.service.addSupplement('p',body(),'director',{accountId:'member'});
 // 同一人在另一场次还有一条普通报名行，合并后必须仍是「待确认」。
 f.data.registrations.push({_id:'r2',活动ID:'p-code',姓名:'合成乙',学号:'00654321',账号ID:'member',院系:'合成学院',
  报名日期:'2030-01-02',报名时段:'13:00—16:00',报名状态:'已签到',签到照片ID:'photo-2'});
 const config=JSON.parse(f.event['报名页配置']);
 config.runningReview.entries.push({id:'r2',serviceHours:2,trainingHours:0,travelHours:0,decision:'pass',reason:'',evidenceChecked:true});
 config.runningReview.sourceDigest=runningSourceDigest(f.data.events,f.data.registrations,f.data.checkins,f.data.ledger);
 f.event['报名页配置']=JSON.stringify(config);
 const sheet=await f.service.finalHours('p','chair');
 const merged=sheet.rows.find(item=>item.studentId==='00654321');
 assert.equal(merged.memberIds.length,2);
 assert.equal(merged.manual,true);
 assert.equal(merged.manualApproval,'pending');
 await assert.rejects(f.service.exportFinalHours('p',{token:sheet.token},'chair'),/待主席团确认/);
});

test('a supplement records the position chosen at entry, not the project default',async()=>{
 const f=fixture({phase:'submitted'});
 // 两个岗位必须挂在同一个项目下才算同一次活动：项目键认 `ordinary.groupId`。
 const config=JSON.parse(f.event['报名页配置']);
 config.ordinary={groupId:'synthetic-project'};
 f.event['报名页配置']=JSON.stringify(config);
 // 第二岗位与第一岗位共用同一个地点和时段——只靠「岗位」区分，正是现场最容易记错的情形。
 const second={...f.event,_id:'p2',活动ID:'p-code-2',岗位:'第二打卡点'};
 f.data.events.push(second);
 delete f.event['批准摘要'];delete second['批准摘要'];
 f.event['批准摘要']=workflowApprovalHash(f.event);
 second['批准摘要']=workflowApprovalHash(second);
 // 来源摘要覆盖项目内全部岗位行，新增行后必须按两行重算，否则终审会报「依据已改变」。
 config.runningReview.sourceDigest=runningSourceDigest(f.data.events,f.data.registrations,f.data.checkins,f.data.ledger);
 f.event['报名页配置']=JSON.stringify(config);
 const {id}=await f.service.addSupplement('p',body({eventId:'p2'}),'director',{accountId:'member'});
 const list=await f.service.hoursSupplementList('p','director');
 const row=list.items.find(item=>item.id===id);
 assert.equal(row.position,'第二打卡点','补录行必须记在所选的岗位上');
 // 三项时长是补录台账的真实字段：漏带会让人数核对时只看到 undefined。
 assert.equal(row.serviceHours,4);
 assert.equal(row.trainingHours,1);
 assert.equal(row.travelHours,0);
 // 同一份字段也要出现在终审视图里，两处界面口径一致。
 const sheet=await f.service.finalHours('p','chair');
 const finalRow=sheet.rows.find(item=>item.id===id);
 assert.equal(finalRow.position,'第二打卡点');
 assert.equal(finalRow.serviceHours,4);
});
