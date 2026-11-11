import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,workflowApprovalHash,workflowEventApproved} from '../lib/events/workflow.js';
import {workspaceWorkflowInput} from '../lib/events/workspace-workflow-bridge.js';
import {ORDINARY_GROUP_TABLE,ordinaryRegistrationOpen} from '../lib/events/ordinary-groups.js';
import {activityProjectKey,projectEvents} from '../public/app/shared/activity-projects.js';
import {registrationOpen} from '../public/app/shared/activity-management.js';
import {scheduleBoardLayout} from '../public/app/shared/schedule-board-layout.js';

async function fixture(){
 let seq=0,clock=Date.parse('2030-12-01T00:00:00+08:00');
 const tables=Object.fromEntries([...Object.values(WF),ORDINARY_GROUP_TABLE].map(name=>[name,[]]));
 const base={async listRows(name,_v,_o,_c,start=0,count=500){return structuredClone((tables[name]||[]).slice(start,start+count));},async getMetadata(){return {tables:[]};},async appendRow(name,row){const saved={...row,_id:`special-row-${++seq}`};tables[name].push(saved);return {_id:saved._id};},async updateRow(name,id,patch){Object.assign(tables[name].find(row=>row._id===id),patch);}};
 const workflow=createWorkflow(base,{now:()=>clock});
 const content={name:'自定义校医院服务',region:'nanjing',category:'排班专项',bookingMode:'grouped',date:'2030-12-09',endDate:'2030-12-20',work:'合成引导服务',qqGroup:'12345678',notice:'合成排班通知',special:{v:1,type:'schedule',dates:['2030-12-09','2030-12-17'],cutoffMinutes:0,places:[{location:'合成地点',periods:[{start:'08:00',end:'12:00',capacity:2,serviceHours:4,trainingHours:0,travelHours:0}]}]}};
 const input=workspaceWorkflowInput(content),parent=await workflow.create(input.body,'owner');
 const config=JSON.parse(parent['报名页配置']);config.special=input.special;
 Object.assign(tables[WF.events][0],{报名页配置:JSON.stringify(config)});
 await workflow.configurePositions(parent._id,{positions:input.positions,deadline:input.deadline,token:workflowApprovalHash(tables[WF.events][0])},'owner');
 await workflow.approve(parent._id,'chair');await workflow.publish(parent._id);
 return {workflow,tables,base,input,parent,children:tables[WF.events].slice(1),time:value=>{clock=Date.parse(value);}};
}
test('native publication retains category, generates only explicit days, and keeps future weeks open',async()=>{
 const f=await fixture(),data=await f.workflow.publicRead();
 assert.equal(f.children.length,2);assert.ok(f.tables[WF.events].every(workflowEventApproved));
 assert.ok(f.children.every(e=>e['组织类别']==='排班专项'));
 assert.notEqual(activityProjectKey(f.children[0]),activityProjectKey(f.children[1]));
 assert.deepEqual(projectEvents(data.events,f.children[0]).map(e=>e._id),[f.children[0]._id]);
 const later=data.events.find(e=>e._id===f.children[1]._id),first=data.events.find(e=>e._id===f.children[0]._id);
 assert.equal(ordinaryRegistrationOpen(first,Date.parse('2030-12-09T08:00:00+08:00')),false);
 assert.equal(ordinaryRegistrationOpen(later,Date.parse('2030-12-10T08:00:00+08:00')),true);
 assert.equal(registrationOpen(later,Date.parse('2030-12-10T08:00:00+08:00')),true);
 assert.deepEqual(scheduleBoardLayout(projectEvents(data.events,first)).days,['2030-12-09','2030-12-10','2030-12-11','2030-12-12','2030-12-13','2030-12-14','2030-12-15']);
 assert.equal(f.children.length,2); // Calendar placeholders never create unselected service dates.
 const detail=await f.workflow.detail(later._id,f.tables[WF.events]);assert.equal(detail.events.length,1);assert.equal(detail.events[0].relationshipError,undefined);
});
test('per-week batch scope rejects another week and no-proof initial review requires explicit attendance verification',async()=>{
 const f=await fixture();
 const account={accountId:'synthetic-member',studentId:'999990001',realName:'合成同学',email:'999990001@smail.nju.edu.cn',emailVerified:true};
 const first=await f.workflow.register(f.children[0]._id,account),second=await f.workflow.register(f.children[1]._id,account);
 await f.workflow.confirm(first._id);await f.workflow.confirm(second._id);
 f.time('2030-12-09T13:00:00+08:00');
 await assert.rejects(f.workflow.attendanceBatch(f.children[0]._id,[{id:second._id,hours:{}}],'owner'),/其他活动/);
 const missing=await f.workflow.attendanceBatch(f.children[0]._id,[{id:first._id,hours:{}}],'owner');assert.equal(missing.succeeded,0);assert.match(missing.results[0].message,/到场核实/);
 const passed=await f.workflow.attendanceBatch(f.children[0]._id,[{id:first._id,hours:{},attendanceConfirmation:{confirmed:true,reason:'合成负责人核对了实际到场'}}],'owner');
 assert.equal(passed.succeeded,1);assert.equal(f.tables[WF.ledger][0]['状态'],'待批准');
 assert.equal(f.tables[WF.events].find(e=>e._id===f.children[1]._id)['状态'],'报名中');
 const preview=await f.workflow.exportDraft(f.children[0]._id).catch(error=>error);assert.match(preview.message,/没有已批准/);
});

test('weekly archive freezes only the completed week and preserves the future signup gate',async()=>{
 const f=await fixture(),event=f.children[0],future=f.children[1];
 const account={accountId:'synthetic-archive',studentId:'999990009',realName:'合成归档同学',email:'999990009@smail.nju.edu.cn',emailVerified:true};
 const row=await f.workflow.register(event._id,account);await f.workflow.confirm(row._id);
 f.time('2030-12-09T10:00:00+08:00');
 await f.workflow.attendanceBatch(event._id,[{id:row._id,hours:{},attendanceConfirmation:{confirmed:true,reason:'合成负责人核实实际到场'}}],'recorder');
 const entry=f.tables[WF.ledger][0];
 const early=await f.workflow.approveBatch(event._id,[{id:entry._id,expectedDigest:entry['核对摘要']}],'reviewer','platform_admin');assert.equal(early.succeeded,0);
 await assert.rejects(f.workflow.close(event._id,{scope:'project',actor:'owner'}),/各自截止时间/);
 f.time('2030-12-09T13:00:00+08:00');
 assert.equal((await f.workflow.approveBatch(event._id,[{id:entry._id,expectedDigest:entry['核对摘要']}],'reviewer','platform_admin')).succeeded,1);
 assert.equal((await f.workflow.archiveBloodWeek(event._id,'reviewer')).archived,true);
 const archived=(await f.workflow.catalog()).events.find(e=>e._id===event._id);
 assert.ok(JSON.parse(archived['报名页配置']).bloodWeekArchive);assert.equal(f.workflow.attendanceOpen(archived,[archived]),false);
 assert.equal((await f.workflow.downloadArchivedBloodWeek(event._id,'reviewer')).rows.length,1);
 const next=await f.workflow.register(future._id,account);assert.equal(next['活动ID'],future['活动ID']);
 assert.equal((await f.workflow.archiveBloodWeek(event._id,'reviewer')).archived,true);
});
