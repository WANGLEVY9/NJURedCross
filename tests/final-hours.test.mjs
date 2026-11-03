import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createFinalHours,groupFinalHoursRows,storedFinalHoursRows} from '../lib/events/final-hours.js';
import {runningSourceDigest} from '../lib/events/running-review.js';
import {projectEvents} from '../public/app/shared/activity-projects.js';
import {workflowApprovalHash,workflowEventApproved} from '../lib/events/workflow.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {createMutationQueue} from '../lib/events/safety.js';
import {FINAL_HOURS_COLUMNS} from '../public/app/shared/activity-final-hours.js';
function fixture(){
 const event={_id:'p',活动ID:'p-code',活动名称:'合成最终表',状态:'进行中',申请版本:'1',批准版本:'1',负责人账号ID:'director',活动地区:'苏州地区',组织类别:'生命中心',地点:'合成苏州场馆',工作内容:'合成服务',报名时段:'09:15—11:45',报名页配置:JSON.stringify({workspaceSubmission:{origin:true},region:'苏州活动',center:'生命中心',approval:{mode:'workspace-regional',region:'suzhou',category:'生命中心',version:'1'}})};event['批准摘要']=workflowApprovalHash(event);
 const data={events:[event],registrations:[{_id:'r',活动ID:'p-code',姓名:'合成甲',学号:'00123456',账号ID:'member',院系:'合成学院',报名日期:'2030-01-01',报名时段:'09:15—11:45',报名状态:'已确认',签到照片ID:'synthetic-photo'}],checkins:[],ledger:[]};
 const c=JSON.parse(event['报名页配置']);c.runningReview={status:'submitted',sourceDigest:runningSourceDigest(data.events,data.registrations,data.checkins,data.ledger),previewToken:'synthetic-proof',entries:[{id:'r',serviceHours:2.5,trainingHours:0.5,travelHours:1,decision:'pass',reason:'',evidenceChecked:true}]};event['报名页配置']=JSON.stringify(c);
 const roster={complete:true,rows:[{accountId:'director',region:'suzhou',role:'director',categories:['生命中心'],active:true,emailVerified:true,email:'director@example.test'},{accountId:'chair',region:'suzhou',role:'presidium',categories:[],active:true},{accountId:'nj-chair',region:'nanjing',role:'presidium',categories:[],active:true},{accountId:'other',region:'suzhou',role:'director',categories:['生命中心'],active:true}]};
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>structuredClone(roster)});let lost=false,writes=0,sequence=0;
 const update=async(table,row,patch)=>{writes++;const target=table==='events'?data.events.find(item=>item._id===row._id)||row:data.ledger.find(item=>item._id===row._id)||row;Object.assign(target,patch);if(target!==row)Object.assign(row,patch);if(lost){lost=false;throw Error('lost response');}};
 const append=async(table,row)=>{writes++;const saved={...row,_id:`ledger-${++sequence}`};if(table==='ledger')data.ledger.push(saved);return saved;};
 const appendRows=async(table,rows)=>{const saved=rows.map(row=>{writes++;const item={...row,_id:`ledger-${++sequence}`};if(table==='ledger')data.ledger.push(item);return item;});return saved;};
 const updateRows=async(table,rows,patchOf)=>{for(const row of rows){writes++;const patch=patchOf(row),target=table==='events'?data.events.find(item=>item._id===row._id)||row:data.ledger.find(item=>item._id===row._id)||row;Object.assign(target,patch);Object.assign(row,patch);}};
 const service=createFinalHours({read:async()=>structuredClone(data),write:createMutationQueue(),update,append,appendRows,updateRows,WF:{events:'events',ledger:'ledger'},approved:workflowEventApproved,authorizeRead:routing.assertRegistrar,authorizeReview:routing.assertHoursReviewer,recipient:routing.hoursRecipient,now:()=>12345});
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

test('optional attendance does not prevent final review or fabricate a check-in',async()=>{
 const f=fixture();delete f.data.registrations[0]['签到照片ID'];const config=JSON.parse(f.event['报名页配置']);config.runningReview.entries[0].evidenceChecked=false;config.runningReview.sourceDigest=runningSourceDigest(f.data.events,f.data.registrations,f.data.checkins,f.data.ledger);f.event['报名页配置']=JSON.stringify(config);
 const sheet=await f.service.finalHours('p','chair');await f.service.exportFinalHours('p',{token:sheet.token},'chair');assert.equal(f.event['状态'],'已结束');assert.equal(f.data.checkins.length,0);
});
test('export freezes exact 11-column template, preserves text IDs and supports lost-response retry and owner download',async()=>{
 const f=fixture(),sheet=await f.service.finalHours('p','chair');f.lose();await assert.rejects(f.service.exportFinalHours('p',{token:sheet.token},'chair'),/lost response/);
 assert.equal(f.event['状态'],'已结束');
 // 首次导出写了台账行与配置各一次；丢响应重试只读已完成的归档，不再写入。
 const settled=f.writes();assert.deepEqual(await f.service.exportFinalHours('p',{token:sheet.token},'chair'),{exported:true});assert.equal(f.writes(),settled);
 const file=await f.service.downloadFinalHours('p','director'),repeat=await f.service.downloadFinalHours('p','chair');
 // 归档文件按已存行数据现场重建，xlsx 的 zip 头不是字节级确定的；冻结的是内容与行数据。
 const load=async buffer=>{const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);return book.worksheets[0];};
 const sheetOnce=await load(file.buffer);assert.deepEqual(sheetOnce.getSheetValues(),(await load(repeat.buffer)).getSheetValues());
 const s=sheetOnce;assert.deepEqual(s.model.merges,['A1:K1']);assert.deepEqual(s.getRow(2).values.slice(1),FINAL_HOURS_COLUMNS.map(([,label])=>label));assert.equal(s.getCell('D4').value,'00123456');assert.equal(s.getCell('G4').value,1);assert.equal(s.getCell('I4').value,2.5);assert.equal(s.getCell('A3').value,'填写说明');
 await assert.rejects(f.service.saveFinalHours('p',{token:sheet.token,items:[{id:'r',serviceHours:8}]},'chair'),{statusCode:409});
 await assert.rejects(f.service.downloadFinalHours('p','other'),{statusCode:403});
 let sent=0;const send=async message=>{sent++;assert.equal(message.to,'director@example.test');assert.deepEqual((await load(message.attachments[0].content)).getSheetValues(),s.getSheetValues());assert.match(message.text,/录入时长/);return {ok:true,transport:'smtp'};};
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

test('archived workbook is rebuilt from rows instead of stored inside the config cell',async()=>{
 const f=fixture(),sheet=await f.service.finalHours('p','chair');
 await f.service.exportFinalHours('p',{token:sheet.token},'chair');
 const stored=JSON.parse(f.event['报名页配置']).finalHours;
 assert.equal(stored.fileBase64,undefined);
 assert.equal(stored.rows,undefined);
 assert.ok(f.event['报名页配置'].length<10000,`配置长度 ${f.event['报名页配置'].length}`);
 const file=await f.service.downloadFinalHours('p','director'),book=new ExcelJS.Workbook();await book.xlsx.load(file.buffer);
 assert.equal(book.worksheets[0].getCell('B4').value,'合成甲');
 assert.equal(book.worksheets[0].getCell('F4').value,'2030-01-01 09:15—11:45');
});

test('a 16-session blood week with 384 people reviews and exports without touching the config ceiling',async()=>{
 // 现场规模：16 个场次 × 每场 24 人 = 384 条。旧实现把整份 rows 写进「报名页配置」，
 // 一条终审行约 324 字符，三十余行就会撞上 10000 字符上限。
 const event={_id:'p',活动ID:'p-code',活动名称:'合成献血周',状态:'进行中',申请版本:'1',批准版本:'1',负责人账号ID:'director',活动地区:'苏州地区',组织类别:'生命中心',地点:'合成苏州场馆',工作内容:'合成服务',报名时段:'09:15—11:45',
  报名页配置:JSON.stringify({workspaceSubmission:{origin:true},region:'苏州活动',center:'生命中心',bookingMode:'grouped',ordinary:{groupId:'blood-week'},positionPlan:{groupId:'blood-week'},approval:{mode:'workspace-regional',region:'suzhou',category:'生命中心',version:'1'}})};
 event['批准摘要']=workflowApprovalHash(event);
 const data={events:[event],registrations:[],checkins:[],ledger:[]};
 const base=JSON.parse(event['报名页配置']);
 for(let session=0;session<16;session+=1){
  const code=`session-${session}`,child={...event,_id:`child-${session}`,活动ID:code,报名页配置:JSON.stringify({...base,bookingMode:'unified',parentActivityId:'p-code',positionPlan:undefined})};
  child['批准摘要']=workflowApprovalHash(child);data.events.push(child);
  for(let index=0;index<24;index+=1){
   const id=`reg-${session}-${index}`;
   data.registrations.push({_id:id,活动ID:code,姓名:`合成${session}-${index}`,学号:`0012${String(session).padStart(2,'0')}${String(index).padStart(2,'0')}`,账号ID:`member-${session}-${index}`,院系:'合成学院',报名日期:'2030-01-01',报名时段:'09:15—11:45',报名状态:'已确认',签到照片ID:'synthetic-photo'});
   data.ledger.push({_id:`running-${id}`,'幂等键':`RUNNING:${id}`,报名行ID:id,活动ID:code,学号:`0012${String(session).padStart(2,'0')}${String(index).padStart(2,'0')}`,姓名:`合成${session}-${index}`,服务时长:2,培训时长:1,交通时长:1,状态:'待批准',备注:JSON.stringify({v:2,d:'pass',e:true})});
  }
 }
 const c=JSON.parse(event['报名页配置']);
 const jobs=projectEvents(data.events,event).filter(row=>JSON.parse(row['报名页配置']).bookingMode!=='grouped'),jobIds=new Set(jobs.map(row=>row['活动ID']));
 c.runningReview={status:'submitted',sourceDigest:runningSourceDigest(projectEvents(data.events,event),data.registrations.filter(row=>jobIds.has(row['活动ID'])),data.checkins,data.ledger),previewToken:'synthetic-proof',entryCount:384};
 event['报名页配置']=JSON.stringify(c);
 const roster={complete:true,rows:[{accountId:'director',region:'suzhou',role:'director',categories:['生命中心'],active:true,emailVerified:true,email:'director@example.test'},{accountId:'chair',region:'suzhou',role:'presidium',categories:[],active:true}]};
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>structuredClone(roster)});let sequence=0;
 const update=async(table,row,patch)=>{const target=table==='events'?data.events.find(item=>item._id===row._id)||row:data.ledger.find(item=>item._id===row._id)||row;Object.assign(target,patch);if(target!==row)Object.assign(row,patch);};
 const appendRows=async(table,rows)=>{const saved=rows.map(row=>{const item={...row,_id:`ledger-${++sequence}`};if(table==='ledger')data.ledger.push(item);return item;});return saved;};
 const updateRows=async(table,rows,patchOf)=>{for(const row of rows){const patch=patchOf(row),target=table==='events'?data.events.find(item=>item._id===row._id)||row:data.ledger.find(item=>item._id===row._id)||row;Object.assign(target,patch);Object.assign(row,patch);}};
 const service=createFinalHours({read:async()=>structuredClone(data),write:createMutationQueue(),update,append:async()=>{},appendRows,updateRows,WF:{events:'events',ledger:'ledger'},approved:workflowEventApproved,authorizeRead:routing.assertRegistrar,authorizeReview:routing.assertHoursReviewer,recipient:routing.hoursRecipient,now:()=>12345});
 const sheet=await service.finalHours('p','chair');
 assert.equal(sheet.rows.length,384);
 await service.saveFinalHours('p',{token:sheet.token,items:[{id:'reg-0-0',remark:'合成备注',location:'合成实际地点'}]},'chair');
 // 逐行明细在台账里，配置体积不随人数增长。
 assert.ok(event['报名页配置'].length<10000,`配置长度 ${event['报名页配置'].length}`);
 const saved=await service.finalHours('p','chair');
 assert.equal(saved.rows.length,384);assert.equal(saved.rows[0].remark,'合成备注');
 await service.exportFinalHours('p',{token:saved.token},'chair');
 assert.equal(event['状态'],'已结束');
 assert.ok(event['报名页配置'].length<10000,`导出后配置长度 ${event['报名页配置'].length}`);
 const file=await service.downloadFinalHours('p','director'),book=new ExcelJS.Workbook();
 await book.xlsx.load(file.buffer);
 const worksheet=book.worksheets[0];
 assert.equal(worksheet.getCell('B4').value,'合成0-0');
 assert.ok(worksheet.rowCount>=387,`导出仅 ${worksheet.rowCount} 行`);
 const finals=data.ledger.filter(row=>String(row['幂等键']||'').startsWith('FINAL:'));
 assert.equal(finals.length,384);assert.ok(finals.every(row=>row['状态']==='已批准'));
});


test('bulk final review changes selected decisions only and preserves legacy edits during migration',async()=>{
 const f=fixture(),c=JSON.parse(f.event['报名页配置']);
 for(const id of ['two','three']){f.data.registrations.push({...f.data.registrations[0],_id:id,学号:id==='two'?'00000002':'00000003'});c.runningReview.entries.push({...c.runningReview.entries[0],id});}
 c.runningReview.sourceDigest=runningSourceDigest(f.data.events,f.data.registrations,f.data.checkins,f.data.ledger);f.event['报名页配置']=JSON.stringify(c);
 let sheet=await f.service.finalHours('p','chair');
 c.finalHours={status:'review',rows:sheet.rows.map(row=>({...row,serviceHours:row.id==='three'?7:row.serviceHours,remark:row.id==='three'?'历史终审已核对':''}))};f.event['报名页配置']=JSON.stringify(c);sheet=await f.service.finalHours('p','chair');
 await assert.rejects(f.service.saveFinalHours('p',{token:sheet.token,items:[{id:'r',decision:'fail',reason:''},{id:'two',decision:'fail',reason:''}]},'chair'),{statusCode:400});
 await f.service.saveFinalHours('p',{token:sheet.token,items:[{id:'r',decision:'fail',reason:'纸质名单未参加'},{id:'two',decision:'fail',reason:'纸质名单未参加'}]},'chair');
 const saved=await f.service.finalHours('p','chair');assert.equal(saved.rows.find(row=>row.id==='three').serviceHours,7);assert.equal(saved.rows.find(row=>row.id==='three').remark,'历史终审已核对');assert.equal(saved.rows.filter(row=>row.decision==='fail').length,2);
 await assert.rejects(f.service.saveFinalHours('p',{token:sheet.token,items:[{id:'three',decision:'fail',reason:'旧版本'}]},'chair'),{statusCode:409});
 await f.service.exportFinalHours('p',{token:saved.token},'chair');
 const file=await f.service.downloadFinalHours('p','director'),book=new ExcelJS.Workbook();await book.xlsx.load(file.buffer);assert.equal(book.worksheets[0].getCell('D4').value,'00000003');
});

test('one student with several sessions merges into a single final-hours row',async()=>{
 const f=fixture(),config=JSON.parse(f.event['报名页配置']);
 config.ordinary={groupId:'merge-demo'};f.event['报名页配置']=JSON.stringify(config);f.event['批准摘要']=workflowApprovalHash(f.event);
 const second={...f.event,_id:'p2',活动ID:'p-code-2',报名日期:'2030-01-02',报名时段:'13:00—15:30'};second['批准摘要']=workflowApprovalHash(second);
 f.data.events.push(second);
 f.data.registrations.push({...f.data.registrations[0],_id:'r2',活动ID:'p-code-2',报名日期:'2030-01-02',报名时段:'13:00—15:30'});
 const c=JSON.parse(f.event['报名页配置']);
 c.runningReview.entries.push({...c.runningReview.entries[0],id:'r2'});
 c.runningReview.sourceDigest=runningSourceDigest(projectEvents(f.data.events,f.event),f.data.registrations,f.data.checkins,f.data.ledger);
 f.event['报名页配置']=JSON.stringify(c);
 const sheet=await f.service.finalHours('p','chair');
 assert.equal(sheet.rows.length,1,'同一学号的两个场次应合并成一行');
 assert.equal(sheet.rows[0].serviceHours,5);assert.equal(sheet.rows[0].trainingHours,2);assert.equal(sheet.rows[0].travelHours,2);
 assert.match(sheet.rows[0].dates,/2030-01-01[\s\S]*2030-01-02/);
 // 修改合并后的合计：主行吸收新值，其余场次清零，入账按行累加不会重复计时。
 await f.service.saveFinalHours('p',{token:sheet.token,items:[{id:sheet.rows[0].id,serviceHours:6}]},'chair');
 const saved=await f.service.finalHours('p','chair');
 assert.equal(saved.rows.length,1);assert.equal(saved.rows[0].serviceHours,6);
 const finals=()=>f.data.ledger.filter(row=>String(row['幂等键']||'').startsWith('FINAL:'));
 assert.equal(finals().length,2);
 assert.equal(finals().reduce((total,row)=>total+Number(row['服务时长']),0),6);
 await f.service.exportFinalHours('p',{token:saved.token},'chair');
 const file=await f.service.downloadFinalHours('p','director'),book=new ExcelJS.Workbook();await book.xlsx.load(file.buffer);
 const worksheet=book.worksheets[0];
 assert.equal(worksheet.rowCount,4,'导出应只有一位参与人');
 assert.equal(worksheet.getCell('D4').value,'00123456');assert.equal(worksheet.getCell('I4').value,6);
});

test('a repeated signup in the same session counts once and is zeroed before export',async()=>{
 const f=fixture();
 f.data.registrations.push({...f.data.registrations[0],_id:'r-dup'});
 const c=JSON.parse(f.event['报名页配置']);
 c.runningReview.entries.push({...c.runningReview.entries[0],id:'r-dup'});
 c.runningReview.sourceDigest=runningSourceDigest(f.data.events,f.data.registrations,f.data.checkins,f.data.ledger);
 f.event['报名页配置']=JSON.stringify(c);
 const sheet=await f.service.finalHours('p','chair');
 assert.equal(sheet.rows.length,1);assert.equal(sheet.rows[0].serviceHours,2.5,'同一场次的重复报名只计一次');
 await f.service.exportFinalHours('p',{token:sheet.token},'chair');
 const finals=f.data.ledger.filter(row=>String(row['幂等键']||'').startsWith('FINAL:'));
 assert.equal(finals.length,2);
 assert.equal(finals.reduce((total,row)=>total+Number(row['服务时长']),0),2.5);
});

test('merged rows keep every session in the ledger and only rewrite edited fields',async()=>{
 const members=[
  {id:'a',studentId:'1001',eventId:'e1',regDate:'2030-01-01',slot:'09:00',serviceHours:2,trainingHours:1,travelHours:1,decision:'pass',reason:'',evidenceChecked:true,location:'甲地',dates:'1月1日',work:'引导',remark:''},
  {id:'b',studentId:'1001',eventId:'e2',regDate:'2030-01-02',slot:'13:00',serviceHours:3,trainingHours:1,travelHours:1,decision:'pass',reason:'',evidenceChecked:true,location:'乙地',dates:'1月2日',work:'登记',remark:''},
 ];
 const [group]=groupFinalHoursRows(members);
 assert.equal(group.merged.serviceHours,5);assert.match(group.merged.dates,/1月1日[\s\S]*1月2日/);
 // 未编辑：两行原样写回，台账不被改写，入账累加仍是 5。
 const plain=storedFinalHoursRows([group.merged],[group]);
 assert.deepEqual(plain.map(row=>row.serviceHours),[2,3]);
 assert.deepEqual(plain.map(row=>row.work),['引导','登记']);
 // 改了合计：主行吸收新值，另一场次清零，累加仍是新合计。
 const edited=storedFinalHoursRows([{...group.merged,serviceHours:8}],[group]);
 assert.equal(edited.reduce((total,row)=>total+row.serviceHours,0),8);
 // 改了工作内容：两行统一成新值，下次合并去重后不会重复拼接。
 const text=storedFinalHoursRows([{...group.merged,work:'统一内容'}],[group]);
 assert.deepEqual(text.map(row=>row.work),['统一内容','统一内容']);
});
