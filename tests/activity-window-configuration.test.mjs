import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionWindows} from '../lib/events/ordinary-groups.js';
import {createWorkflow,WF,workflowApprovalHash} from '../lib/events/workflow.js';

const row=config=>({'报名页配置':JSON.stringify(config)});

test('session windows cover ordinary, blood, grouped jobs and special schedule periods',()=>{
 const ordinary={ordinary:{start:'2030-01-01T09:00:00+08:00',end:'2030-01-01T11:00:00+08:00'}};
 assert.deepEqual(sessionWindows(row(ordinary)),[ordinary.ordinary]);
 const blood={blood:{start:'2030-01-01T09:00:00+08:00',end:'2030-01-01T11:00:00+08:00'}};
 assert.deepEqual(sessionWindows(row(blood)),[blood.blood]);
 const grouped={window:{start:'2030-01-01T00:00:00+08:00',end:'2030-01-01T23:59:00+08:00'},positionPlan:{positions:[
  {start:'2030-01-01T09:00:00+08:00',end:'2030-01-01T11:00:00+08:00'},
  {start:'2030-01-01T14:00:00+08:00',end:'2030-01-01T16:00:00+08:00'},
 ]}};
 assert.deepEqual(sessionWindows(row(grouped)),grouped.positionPlan.positions);
 const special={special:{v:1,type:'schedule',dates:['2030-01-01'],places:[{location:'甲',periods:[{start:'09:00',end:'11:00'}]}]}};
 assert.deepEqual(sessionWindows(row(special)),[{start:'2030-01-01T09:00:00+08:00',end:'2030-01-01T11:00:00+08:00'}]);
 assert.deepEqual(sessionWindows(row({})),[]);
});

test('unified workspace activity with a full-day window blocks an overlapping second registration',async()=>{
 let seq=0;
 const tables=Object.fromEntries(Object.values(WF).map(name=>[name,[]]));
 const base={async listRows(table,_view,_order,_columns,start=0,count=500){return structuredClone(tables[table].slice(start,start+count));},async appendRow(table,row){const saved={...row,_id:`row-${++seq}`};tables[table].push(saved);return {_id:saved._id};},async updateRow(table,id,patch){Object.assign(tables[table].find(row=>row._id===id),patch);}};
 const w=createWorkflow(base,{now:()=>Date.parse('2030-01-01T08:00:00+08:00')});
 const session={name:'合成项目',region:'南京活动',center:'生命中心',date:'2030-02-01',slot:'09:00-11:00',location:'合成场地',capacity:10,serviceHours:2,trainingHours:0,travelHours:0,work:'合成服务'};
 const first=await w.create({...session,window:{start:'2030-02-01T09:00:00+08:00',end:'2030-02-01T11:00:00+08:00'}},'owner');
 await w.approve(first._id,'reviewer');await w.publish(first._id);
 const second=await w.create({...session,name:'合成重叠项目',window:{start:'2030-02-01T10:00:00+08:00',end:'2030-02-01T12:00:00+08:00'}},'owner');
 await w.approve(second._id,'reviewer');await w.publish(second._id);
 const account={accountId:'student',studentId:'999990001',realName:'合成同学',email:'999990001@smail.nju.edu.cn',emailVerified:true,campus:'鼓楼'};
 await w.register(first._id,account);
 // A workspace-created unified event has no ordinary/blood config. Its
 // registration still has to compare the real c.window against booked events.
 const config=JSON.parse(second['报名页配置']);
 config.ordinary={groupId:'PROJECT-'+second['活动ID'],start:config.window.start,end:config.window.end,campus:'鼓楼',hoursPending:false};
 second['报名页配置']=JSON.stringify(config);second['批准摘要']=workflowApprovalHash(second);
 await assert.rejects(w.register(second._id,account),{code:'registration_schedule_conflict'});
});
