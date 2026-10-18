import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createFinalHours} from '../lib/events/final-hours.js';
import {runningSourceDigest} from '../lib/events/running-review.js';
import {workflowApprovalHash,workflowEventApproved} from '../lib/events/workflow.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {createMutationQueue} from '../lib/events/safety.js';
import {FINAL_HOURS_COLUMNS} from '../public/app/shared/activity-final-hours.js';
function fixture(){
 const event={_id:'p',活动ID:'p-code',活动名称:'合成最终表',状态:'进行中',申请版本:'1',批准版本:'1',负责人账号ID:'director',活动地区:'苏州地区',组织类别:'生命中心',地点:'合成苏州场馆',工作内容:'合成服务',报名时段:'09:15—11:45',报名页配置:JSON.stringify({workspaceSubmission:{origin:true},region:'苏州活动',center:'生命中心',approval:{mode:'workspace-regional',region:'suzhou',category:'生命中心',version:'1'}})};event['批准摘要']=workflowApprovalHash(event);
 const data={events:[event],registrations:[{_id:'r',活动ID:'p-code',姓名:'合成甲',学号:'00123456',账号ID:'member',院系:'合成学院',报名日期:'2030-01-01',报名时段:'09:15—11:45',报名状态:'已确认',签到照片ID:'synthetic-photo'}],checkins:[],ledger:[]};
 const c=JSON.parse(event['报名页配置']);c.runningReview={status:'submitted',sourceDigest:runningSourceDigest(data.events,data.registrations,data.checkins,data.ledger),previewToken:'synthetic-proof',entries:[{id:'r',serviceHours:2.5,trainingHours:0.5,travelHours:1,decision:'pass',reason:'',evidenceChecked:true}]};event['报名页配置']=JSON.stringify(c);
 const roster={complete:true,rows:[{accountId:'director',region:'suzhou',role:'director',categories:['生命中心'],active:true,emailVerified:true,email:'director@example.test'},{accountId:'chair',region:'suzhou',role:'presidium',categories:[],active:true},{accountId:'nj-chair',region:'nanjing',role:'presidium',categories:[],active:true},{accountId:'other',region:'suzhou',role:'director',categories:['生命中心'],active:true}]};
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>structuredClone(roster)});let lost=false,writes=0;
 const service=createFinalHours({read:async()=>structuredClone(data),write:createMutationQueue(),update:async(_t,_r,patch)=>{Object.assign(event,patch);writes++;if(lost){lost=false;throw Error('lost response');}},WF:{events:'events'},approved:workflowEventApproved,authorizeRead:routing.assertRegistrar,authorizeReview:routing.assertHoursReviewer,recipient:routing.hoursRecipient,now:()=>12345});
 return {service,data,event,roster,lose:()=>{lost=true;},writes:()=>writes};
}
test('final review uses regional chair authority and locks identities; director is read-only',async()=>{
 const f=fixture(),sheet=await f.service.finalHours('p','director');assert.equal(sheet.canEdit,false);assert.equal(sheet.rows[0].trainingHours,1);
 assert.equal(sheet.rows[0].dates,'2030-01-01 09:15—11:45');
 for(const actor of ['director','nj-chair','other'])await assert.rejects(f.service.saveFinalHours('p',{token:sheet.token,items:[{id:'r',serviceHours:3}]},actor),{statusCode:403});
 await assert.rejects(f.service.saveFinalHours('p',{token:sheet.token,items:[{id:'r',studentId:'different'}]},'chair'),{statusCode:400});
 await f.service.saveFinalHours('p',{token:sheet.token,items:[{id:'r',serviceHours:3,location:'更新的实际地点',work:'更新的实际工作'}]},'chair');
 assert.equal(workflowEventApproved(f.event),true);assert.equal(f.event['状态'],'进行中');assert.equal((await f.service.finalHours('p','director')).rows[0].serviceHours,3);
 await assert.rejects(f.service.exportFinalHours('p',{token:sheet.token},'chair'),{statusCode:409});
});

test('reviewed actual dates survive refresh and export without being replaced by the planned slot',async()=>{
 const f=fixture(),sheet=await f.service.finalHours('p','chair'),dates='2030-01-01 08:45—12:15（含已核对交通时间）';
 await f.service.saveFinalHours('p',{token:sheet.token,items:[{id:'r',dates}]},'chair');
 const saved=await f.service.finalHours('p','director');assert.equal(saved.rows[0].dates,dates);
 await f.service.exportFinalHours('p',{token:saved.token},'chair');const file=await f.service.downloadFinalHours('p','director'),book=new ExcelJS.Workbook();await book.xlsx.load(file.buffer);assert.equal(book.worksheets[0].getCell('F4').value,dates);
});
test('export freezes exact 11-column template, preserves text IDs and supports lost-response retry and owner download',async()=>{
 const f=fixture(),sheet=await f.service.finalHours('p','chair');f.lose();await assert.rejects(f.service.exportFinalHours('p',{token:sheet.token},'chair'),/lost response/);
 assert.equal(f.event['状态'],'已结束');assert.deepEqual(await f.service.exportFinalHours('p',{token:sheet.token},'chair'),{exported:true});assert.equal(f.writes(),1);
 const file=await f.service.downloadFinalHours('p','director'),repeat=await f.service.downloadFinalHours('p','chair');assert.deepEqual(file.buffer,repeat.buffer);
 const book=new ExcelJS.Workbook();await book.xlsx.load(file.buffer);const s=book.worksheets[0];assert.deepEqual(s.model.merges,['A1:K1']);assert.deepEqual(s.getRow(2).values.slice(1),FINAL_HOURS_COLUMNS.map(([,label])=>label));assert.equal(s.getCell('D4').value,'00123456');assert.equal(s.getCell('G4').value,1);assert.equal(s.getCell('I4').value,2.5);assert.equal(s.getCell('A3').value,'填写说明');
 await assert.rejects(f.service.saveFinalHours('p',{token:sheet.token,items:[{id:'r',serviceHours:8}]},'chair'),{statusCode:409});
 await assert.rejects(f.service.downloadFinalHours('p','other'),{statusCode:403});
 let sent=0;const send=async message=>{sent++;assert.equal(message.to,'director@example.test');assert.deepEqual(message.attachments[0].content,file.buffer);assert.match(message.text,/录入时长/);return {ok:true,transport:'smtp'};};
 await f.service.deliverFinalHours('p','chair',send);await f.service.deliverFinalHours('p','director',send);assert.equal(sent,1);assert.equal((await f.service.finalHours('p','director')).mailStatus,'sent');
});
test('changed participation, unverified owner address and all-failed hours cannot finish an event',async()=>{
 const changed=fixture();changed.data.registrations[0]['姓名']='changed';await assert.rejects(changed.service.finalHours('p','chair'),{statusCode:409});
 const f=fixture(),sheet=await f.service.finalHours('p','chair');f.roster.rows[0].emailVerified=false;await assert.rejects(f.service.exportFinalHours('p',{token:sheet.token},'chair'),{statusCode:503});assert.equal(f.event['状态'],'进行中');
 await f.service.saveFinalHours('p',{token:sheet.token,items:[{id:'r',decision:'fail',reason:'未完成活动'}]},'chair');const failed=await f.service.finalHours('p','chair');await assert.rejects(f.service.exportFinalHours('p',{token:failed.token},'chair'),/没有审核通过/);assert.equal(f.event['状态'],'进行中');
});
test('failed email preserves the frozen download and persistent outbox can retry',async()=>{
 const f=fixture(),sheet=await f.service.finalHours('p','chair');await f.service.exportFinalHours('p',{token:sheet.token},'chair');await f.service.deliverFinalHours('p','chair',async()=>({ok:false,transport:'none'}));assert.equal((await f.service.finalHours('p','director')).mailStatus,'failed');assert.ok((await f.service.downloadFinalHours('p','director')).buffer.length);
 await f.service.deliverPendingFinalHours(async()=>({ok:true,transport:'smtp'}));assert.equal((await f.service.finalHours('p','director')).mailStatus,'sent');
});
test('archived recipient changes never redirect the frozen attachment to another email',async()=>{
 const f=fixture(),sheet=await f.service.finalHours('p','chair');await f.service.exportFinalHours('p',{token:sheet.token},'chair');f.roster.rows[0].email='different@example.test';let sent=0;
 await assert.rejects(f.service.deliverFinalHours('p','chair',async()=>{sent++;return {ok:true,transport:'smtp'};}),{statusCode:409});assert.equal(sent,0);assert.ok((await f.service.downloadFinalHours('p','director')).buffer.length);
});
