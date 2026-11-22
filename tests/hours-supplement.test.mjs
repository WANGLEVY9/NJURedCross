import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createFinalHours} from '../lib/events/final-hours.js';
import {runningSourceDigest} from '../lib/events/running-review.js';
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
