import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,workflowEventApproved} from '../lib/events/workflow.js';
import {ORDINARY_GROUP_TABLE,ordinaryRegistrationOpen} from '../lib/events/ordinary-groups.js';
import {projectWorkflowEvents} from '../lib/events/public-workflow.js';
import {activityProjectKey} from '../public/app/shared/activity-projects.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';

function fixture(options={}){
 let seq=0,clock=Date.parse('2030-12-02T10:00:00+08:00');
 const tables=Object.fromEntries([...Object.values(WF),ORDINARY_GROUP_TABLE].map(name=>[name,[]]));
 const base={async listRows(name,_v,_o,_c,start=0,count=500){return structuredClone((tables[name]||[]).slice(start,start+count));},async getMetadata(){return {tables:[]};},async appendRow(name,row){options.beforeAppend?.(name,row);const saved={...row,_id:'duty-'+(++seq)};tables[name].push(saved);return {_id:saved._id};},async updateRow(name,id,patch){Object.assign(tables[name].find(row=>row._id===id),patch);}};
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>({complete:true,rows:[{accountId:'owner',region:'nanjing',role:'global',active:true,categories:[]}]})});
 return {w:createWorkflow(base,{now:()=>clock,approvalRouting:routing}),tables,time:value=>{clock=Date.parse(value);}};
}
test('recurring duty generates one-seat weekday shifts, same weekly board and native approval, and extends indefinitely',async()=>{
 const {w,tables,time}=fixture();await w.configureRecurringDuty({enabled:true},'owner');
 const events=(await w.read()).events;assert.ok(events.length>=20);assert.ok(events.every(workflowEventApproved));
 assert.ok(events.every(e=>e['组织类别']==='排班专项'&&e['容量']==='1'&&e['服务时长']==='3'&&e['培训时长']==='1'&&e['交通时长']==='1'));
 assert.ok(events.every(e=>![0,6].includes(new Date(e['报名日期']+'T00:00:00Z').getUTCDay())));
 assert.ok(events.every(e=>['09:00-12:00','14:00-17:00'].includes(e['报名时段'])&&!e.relationshipError));
 assert.ok(activityProjectKey(events[0]).startsWith('schedule:PROVINCE-PUBLICITY-DUTY:'));
 const before=tables[WF.events].length;await w.runRecurringDuty();assert.equal(tables[WF.events].length,before);
 const event=events.find(e=>e['报名日期']==='2030-12-09'&&e['报名时段']==='09:00-12:00');
 assert.equal(ordinaryRegistrationOpen(event,Date.parse('2030-12-08T08:59:59+08:00')),true);
 assert.equal(ordinaryRegistrationOpen(event,Date.parse('2030-12-08T09:00:00+08:00')),false);
 const member={accountId:'synthetic-member',studentId:'999990001',realName:'合成同学',email:'999990001@smail.nju.edu.cn',emailVerified:true};
 const registration=await w.register(event._id,member);await w.confirm(registration._id);
 assert.equal(tables[WF.registrations].length,1);
 await w.configureRecurringDuty({enabled:false},'owner');assert.equal(ordinaryRegistrationOpen((await w.read()).events.find(e=>e._id===event._id),Date.parse('2030-12-03T00:00:00+08:00')),false);
 await w.runRecurringDuty();assert.equal(tables[WF.events].length,before);assert.equal(tables[WF.registrations].length,1);
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
