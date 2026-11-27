import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,workflowEventApproved,workflowApprovalHash} from '../lib/events/workflow.js';
import {ORDINARY_GROUP_TABLE,ordinaryRegistrationOpen} from '../lib/events/ordinary-groups.js';
import {projectWorkflowEvents} from '../lib/events/public-workflow.js';
import {activityProjectKey} from '../public/app/shared/activity-projects.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {createActivityLifecycleStore} from '../lib/events/activity-lifecycle-store.js';
import {noticeTemplate} from '../public/app/shared/activity-management.js';

function fixture(options={}){
 let seq=0,clock=Date.parse('2030-12-02T10:00:00+08:00');
 const tables=Object.fromEntries([...Object.values(WF),ORDINARY_GROUP_TABLE].map(name=>[name,[]]));
 const base={async listRows(name,_v,_o,_c,start=0,count=500){options.beforeRead?.(name);return structuredClone((tables[name]||[]).slice(start,start+count));},async getMetadata(){return {tables:[]};},async appendRow(name,row){options.beforeAppend?.(name,row);const saved={...row,_id:'duty-'+(++seq)};tables[name].push(saved);return {_id:saved._id};},async updateRow(name,id,patch){Object.assign(tables[name].find(row=>row._id===id),patch);}};
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>({complete:true,rows:[{accountId:'owner',region:'nanjing',role:'global',active:true,categories:[]}]})});
 const store=createActivityLifecycleStore();
 return {w:createWorkflow(base,{now:()=>clock,approvalRouting:routing,activityLifecycleStore:store}),tables,store,time:value=>{clock=Date.parse(value);}};
}
test('recurring duty generates two-seat weekday shifts, same weekly board and native approval, and extends indefinitely',async()=>{
 const {w,tables,time}=fixture();await w.configureRecurringDuty({enabled:true},'owner');
 const events=(await w.read()).events;assert.ok(events.length>=20);assert.ok(events.every(workflowEventApproved));
 assert.ok(events.every(e=>e['组织类别']==='排班专项'&&e['容量']==='2'&&e['服务时长']==='3'&&e['培训时长']==='1'&&e['交通时长']==='1'));
 assert.ok(events.every(e=>![0,6].includes(new Date(e['报名日期']+'T00:00:00Z').getUTCDay())));
 assert.ok(events.every(e=>['09:00-12:00','14:00-17:00'].includes(e['报名时段'])&&!e.relationshipError));
 assert.ok(activityProjectKey(events[0]).startsWith('schedule:PROVINCE-PUBLICITY-DUTY:'));
 const before=tables[WF.events].length;await w.runRecurringDuty();assert.equal(tables[WF.events].length,before);
 const event=events.find(e=>e['报名日期']==='2030-12-09'&&e['报名时段']==='09:00-12:00');
 assert.equal(ordinaryRegistrationOpen(event,Date.parse('2030-12-08T08:59:59+08:00')),true);
 assert.equal(ordinaryRegistrationOpen(event,Date.parse('2030-12-08T09:00:00+08:00')),false);
 const member={accountId:'synthetic-member',studentId:'999990001',realName:'合成同学',email:'999990001@smail.nju.edu.cn',emailVerified:true};
 const registration=await w.register(event._id,member);await w.confirm(registration._id);
 const second=await w.register(event._id,{...member,accountId:'member-two',studentId:'999990002',email:'999990002@smail.nju.edu.cn'});await w.confirm(second._id);
 await assert.rejects(w.register(event._id,{...member,accountId:'member-three',studentId:'999990003',email:'999990003@smail.nju.edu.cn'}),/名额已满/);
 assert.equal(tables[WF.registrations].length,2);
 await w.configureRecurringDuty({enabled:false},'owner');assert.equal(ordinaryRegistrationOpen((await w.read()).events.find(e=>e._id===event._id),Date.parse('2030-12-03T00:00:00+08:00')),false);
 await w.runRecurringDuty();assert.equal(tables[WF.events].length,before);assert.equal(tables[WF.registrations].length,2);
 await w.configureRecurringDuty({enabled:true},'owner');assert.equal(tables[WF.events].length,before);
 time('2031-01-06T10:00:00+08:00');await w.runRecurringDuty();assert.ok(tables[WF.events].length>before);
 assert.ok(projectWorkflowEvents((await w.read()).events,tables[WF.registrations],Date.parse('2031-01-06T10:00:00+08:00')).some(e=>e.name==='省红会组宣部值班'));
 assert.equal(tables[WF.profiles].length,0);
});


test('interrupted generation resumes behind the unpublished group barrier without duplicate shifts',async()=>{
 let calls=0,interrupt=true;
 const {w,tables}=fixture({beforeAppend:(name)=>{if(name===WF.events&&interrupt&&++calls===2)throw Error('synthetic interrupted write');}});
 await assert.rejects(w.configureRecurringDuty({enabled:true},'owner'),/interrupted/);
 assert.equal(tables[WF.events].length,1);
 assert.equal(tables[ORDINARY_GROUP_TABLE][0]['状态'],'草稿');
 assert.equal(tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
 interrupt=false;await w.runRecurringDuty();
 assert.ok(tables[WF.events].length>20);
 assert.equal(new Set(tables[WF.events].map(e=>e['活动ID'])).size,tables[WF.events].length);
 assert.ok(tables[ORDINARY_GROUP_TABLE].every(g=>g['状态']==='已发布'));
 const first=tables[WF.events].filter(e=>e['报名日期']==='2030-12-03');
 assert.equal(first.length,2);assert.deepEqual(first.map(e=>e['报名时段']).sort(),['09:00-12:00','14:00-17:00']);
});


test('midweek enable retains all five days, expired shifts stay closed, and all weeks have one public entry',async()=>{
 const {w,tables,time}=fixture();time('2030-12-04T16:00:00+08:00');
 await w.configureRecurringDuty({enabled:true},'owner');
 let data=await w.publicRead();
 const current=data.events.filter(e=>JSON.parse(e['报名页配置']).special.week==='2030-12-02');
 assert.equal(current.length,10);assert.equal(new Set(current.map(e=>e['报名日期'])).size,5);
 assert.equal(ordinaryRegistrationOpen(current.find(e=>e['报名日期']==='2030-12-02'),Date.parse('2030-12-04T16:00:00+08:00')),false);
 assert.equal(ordinaryRegistrationOpen(current.find(e=>e['报名日期']==='2030-12-06'),Date.parse('2030-12-04T16:00:00+08:00')),true);
 assert.equal(projectWorkflowEvents(data.events,[],Date.parse('2030-12-04T16:00:00+08:00')).filter(e=>e.name==='省红会组宣部值班').length,1);
 // Simulate a previously published partial week. Backfill missing shifts without replacing existing rows.
 const retained=tables[WF.events].find(e=>e['报名日期']==='2030-12-06');
 tables[WF.events]=tables[WF.events].filter(e=>JSON.parse(e['报名页配置']).special.week!=='2030-12-02'||e._id===retained._id);
 await w.runRecurringDuty();data=await w.publicRead();
 assert.equal(data.events.filter(e=>JSON.parse(e['报名页配置']).special.week==='2030-12-02').length,10);
 assert.ok(data.events.some(e=>e._id===retained._id));
});


test('disabled duty creates no activity or placeholder until the administrator enables it',async()=>{
 const {w,tables}=fixture();assert.equal((await w.recurringDutyStatus()).enabled,false);
 await w.runRecurringDuty();assert.equal(tables[WF.events].length,0);assert.equal(tables[ORDINARY_GROUP_TABLE].length,0);
 await w.configureRecurringDuty({enabled:true},'owner');assert.ok(tables[WF.events].length>0);
 assert.ok(tables[WF.events].every(e=>e['状态']==='报名中'));
});

function legacySeat(row){
 const c={...JSON.parse(row['报名页配置']),capacity:1,registrationLimit:1};
 Object.assign(row,{容量:'1',报名页配置:JSON.stringify(c),通知草稿:noticeTemplate(c)});
 row['批准摘要']=workflowApprovalHash(row);return row;
}

test('legacy settings and already-booked open shifts gain a second seat in place without changing registrations',async()=>{
 const {w,tables,store}=fixture();await w.configureRecurringDuty({enabled:true},'owner');
 const row=legacySeat(tables[WF.events].find(e=>e['报名日期']==='2030-12-09'));
 const before={...row},member={accountId:'legacy-member',studentId:'999990011',realName:'合成同学',email:'999990011@smail.nju.edu.cn',emailVerified:true};
 const first=await w.register(row._id,member);await w.confirm(first._id);
 const registrations=structuredClone(tables[WF.registrations]),count=tables[WF.events].length;
 const key='recurring:province-publicity-duty';store.setInformation(key,{...store.information(key),capacity:1});
 assert.equal(w.recurringDutyStatus().capacity,2);
 await w.runRecurringDuty();
 assert.equal(row['容量'],'2');assert.equal(JSON.parse(row['报名页配置']).registrationLimit,2);
 assert.equal(JSON.parse(row['报名页配置']).capacity,2);assert.equal(workflowEventApproved(row),true);
 assert.match(row['通知草稿'],/【录取名额】：2 人/);
 for(const field of Object.keys(before).filter(k=>!['容量','报名页配置','批准摘要','通知草稿'].includes(k)))assert.deepEqual(row[field],before[field]);
 assert.deepEqual(tables[WF.registrations],registrations);assert.equal(tables[WF.events].length,count);
 const once=structuredClone(row);await w.runRecurringDuty();assert.deepEqual(row,once);
 const second=await w.register(row._id,{...member,accountId:'legacy-two',studentId:'999990012',email:'999990012@smail.nju.edu.cn'});await w.confirm(second._id);
 await assert.rejects(w.register(row._id,{...member,accountId:'legacy-three',studentId:'999990013',email:'999990013@smail.nju.edu.cn'}),/名额已满/);
});

test('capacity upgrade preserves cutoff, archived weeks, hours evidence, custom sizes and invalid approvals',async()=>{
 const {w,tables,store}=fixture();await w.configureRecurringDuty({enabled:true},'owner');
 const retained=[];
 for(const [index,kind] of ['cutoff','archive','checkin','ledger','tampered','custom','unmanaged'].entries()){
  const date=kind==='cutoff'?'2030-12-03':kind==='archive'?'2030-12-16':'2030-12-09';
  const row=legacySeat(tables[WF.events].find(e=>e['报名日期']===date&&e['报名时段']===(index%2?'14:00-17:00':'09:00-12:00')&&!retained.some(r=>r.id===e._id))||tables[WF.events].find(e=>e['报名日期']>'2030-12-03'&&e['报名日期']<'2030-12-16'&&!retained.some(r=>r.id===e._id)));
  if(kind==='archive')store.save('schedule:PROVINCE-PUBLICITY-DUTY:2030-12-16:hours-archive',{archived:true});
  if(kind==='checkin'||kind==='ledger')tables[kind==='checkin'?WF.checkins:WF.ledger].push({_id:kind,活动ID:row['活动ID']});
  if(kind==='tampered')row['工作内容']='unapproved change';
  if(kind==='custom'||kind==='unmanaged'){
   const c=JSON.parse(row['报名页配置']);if(kind==='custom'){row['容量']='3';c.capacity=3;c.registrationLimit=3;}else c.recurringDuty=false;
   row['报名页配置']=JSON.stringify(c);row['批准摘要']=workflowApprovalHash(row);
  }
  retained.push({id:row._id,row:structuredClone(row),kind});
 }
 await w.runRecurringDuty();
 for(const {id,row,kind} of retained)assert.deepEqual(tables[WF.events].find(e=>e._id===id),row,kind);
});

test('disabled legacy duty stays paused until enabled and preserves a custom notice during upgrade',async()=>{
 const {w,tables}=fixture();await w.configureRecurringDuty({enabled:true},'owner');
 const row=legacySeat(tables[WF.events].find(e=>e['报名日期']==='2030-12-09'));
 row['通知草稿']='自定义通知保持不变';row['批准摘要']=workflowApprovalHash(row);
 await w.configureRecurringDuty({enabled:false},'owner');await w.runRecurringDuty();assert.equal(row['容量'],'1');
 await w.configureRecurringDuty({enabled:true},'owner');assert.equal(row['容量'],'2');assert.equal(row['通知草稿'],'自定义通知保持不变');
 assert.equal(workflowEventApproved(row),true);
});


test('legacy migration fails closed when historical evidence cannot be read',async()=>{
 let readFailure=false;
 const {w,tables}=fixture({beforeRead:name=>{if(readFailure&&name===WF.ledger)throw Object.assign(Error('synthetic evidence timeout'),{code:'request_timeout'});}});
 await w.configureRecurringDuty({enabled:true},'owner');
 const row=legacySeat(tables[WF.events].find(e=>e['报名日期']==='2030-12-09')),before=structuredClone(row);
 readFailure=true;await assert.rejects(w.runRecurringDuty(),{statusCode:503,code:'paged_read_unavailable'});
 assert.deepEqual(row,before);
 readFailure=false;await w.runRecurringDuty();assert.equal(row['容量'],'2');
});

test('manual weeks survive timer runs, preserve records and can return to rolling three weeks',async()=>{
 const {w,tables,time}=fixture();await w.configureRecurringDuty({enabled:true},'owner');
 const count=tables[WF.events].length;
 await w.configureRecurringDuty({enabled:true,mode:'manual',weeks:['2030-12-09','2030-12-30']},'owner');
 const groups=()=>tables[ORDINARY_GROUP_TABLE].filter(g=>g['报名开关']==='开放').map(g=>g['活动组ID']).sort();
 assert.deepEqual(groups(),['DUTY-2030-12-09','DUTY-2030-12-30']);
 assert.equal(tables[WF.events].length,count+10);
 await w.runRecurringDuty();assert.deepEqual(groups(),['DUTY-2030-12-09','DUTY-2030-12-30']);
 time('2030-12-09T10:00:00+08:00');await w.runRecurringDuty();
 assert.equal(tables[WF.events].length,count+10);
 await w.configureRecurringDuty({enabled:false},'owner');assert.deepEqual(groups(),[]);
 await w.configureRecurringDuty({enabled:true},'owner');assert.deepEqual(groups(),['DUTY-2030-12-09','DUTY-2030-12-30']);
 await w.configureRecurringDuty({enabled:true,mode:'rolling'},'owner');
 assert.deepEqual(groups(),['DUTY-2030-12-09','DUTY-2030-12-16','DUTY-2030-12-23']);
});

test('week settings reject invalid inputs before persisting and export rejects foreign weeks',async()=>{
 const {w,tables}=fixture();await w.configureRecurringDuty({enabled:true},'owner');
 for(const weeks of [['2030-12-03'],['2030-02-30'],['2030-12-09','2030-12-09']])await assert.rejects(w.configureRecurringDuty({enabled:true,mode:'manual',weeks},'owner'),{statusCode:400});
 assert.equal(w.recurringDutyStatus().mode,'rolling');
 const event=tables[WF.events][0];
 assert.ok((await w.registrationTemplate(event._id,'owner',undefined,['2030-12-02','2030-12-09'])).buffer.length);
 await assert.rejects(w.registrationTemplate(event._id,'owner',undefined,[]),{statusCode:400});
 await assert.rejects(w.registrationTemplate(event._id,'owner',undefined,['2031-01-06']),{statusCode:400});
 await assert.rejects(w.registrationTemplate(event._id,'owner',[event],['2030-12-09']),{statusCode:403});
});

test('selected-week workbook includes every chosen week and excludes other weeks',async()=>{
 const {w,tables}=fixture();await w.configureRecurringDuty({enabled:true},'owner');
 const events=['2030-12-02','2030-12-09','2030-12-16'].map(week=>tables[WF.events].find(e=>JSON.parse(e['报名页配置']).special.week===week));
 tables[WF.registrations].push(...events.map((event,i)=>({_id:'export-'+i,活动ID:event['活动ID'],报名ID:'WR-'+i,姓名:'合成同学'+i,学号:'000'+i,邮箱:'synthetic-'+i+'@example.invalid',报名状态:'待筛选',报名日期:event['报名日期'],报名时段:event['报名时段']})));
 const {default:ExcelJS}=await import('exceljs');
 const book=new ExcelJS.Workbook();await book.xlsx.load((await w.registrationTemplate(events[0]._id,'owner',undefined,['2030-12-02','2030-12-16'])).buffer);
 const sheet=book.getWorksheet('报名信息表');
 assert.equal(sheet.rowCount,3);
 assert.deepEqual([sheet.getCell('B2').value,sheet.getCell('B3').value],['0000','0002']);
 assert.deepEqual([sheet.getCell('H2').value,sheet.getCell('H3').value],['WR-0','WR-2']);
});
