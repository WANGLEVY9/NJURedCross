import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,workflowApprovalHash,workflowEventApproved} from '../lib/events/workflow.js';
import {ORDINARY_GROUP_TABLE} from '../lib/events/ordinary-groups.js';
import {projectWorkflowEvents} from '../lib/events/public-workflow.js';

async function fixture(){
 let seq=0,failAt=0;
 const tables=Object.fromEntries([...Object.values(WF),ORDINARY_GROUP_TABLE].map(t=>[t,[]]));
 const base={async listRows(t,_v,_o,_c,s=0,n=500){return structuredClone(tables[t].slice(s,s+n));},async getMetadata(){return {tables:[]};},async appendRow(t,row){if(t===WF.events&&failAt&&--failAt===0)throw Error('synthetic interrupted write');const r={...row,_id:`row-${++seq}`};tables[t].push(r);return {_id:r._id};},async updateRow(t,id,patch){Object.assign(tables[t].find(r=>r._id===id),patch);}};
 const w=createWorkflow(base);
 const parent=await w.create({name:'合成跨日项目',center:'生命中心',bookingMode:'grouped',window:{start:'2030-10-29T08:00:00',end:'2030-10-30T18:00:00'},capacity:30,serviceHours:2,trainingHours:0,travelHours:0,location:'合成校区',work:'合成服务'},'owner');
 const positions=[{start:'2030-10-29T08:30:01',end:'2030-10-29T10:30:01',location:'合成地点甲',name:'引导',capacity:10,campus:'鼓楼'},{start:'2030-10-30T10:00:00',end:'2030-10-30T12:00:00',location:'合成地点乙',name:'登记',capacity:20,campus:'仙林'}];
 const payload=()=>({token:workflowApprovalHash(tables[WF.events][0]),positions,deadline:'2030-10-28T00:00:00'});
 return {tables,w,parent,positions,payload,interrupt:()=>{failAt=2;}};
}
test('grouped project requires approval then positions and publishes only complete children',async()=>{
 const f=await fixture();
 await f.w.approve(f.parent._id,'reviewer');
 await assert.rejects(f.w.publish(f.parent._id),{statusCode:409});
 await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions:[{...f.positions[0],capacity:31}]},'owner'),{statusCode:400});
 await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions:[{...f.positions[0],end:'2030-10-31T01:00:00'}]},'owner'),{statusCode:400});
 const result=await f.w.configurePositions(f.parent._id,f.payload(),'owner');assert.equal(result.events.length,2);
 assert.ok(result.events.every(workflowEventApproved));
 assert.deepEqual(projectWorkflowEvents((await f.w.publicRead()).events,[]),[]);
 await assert.rejects(f.w.publish(result.events[0]._id),{statusCode:409});
 await f.w.publish(f.parent._id);
 const catalog=projectWorkflowEvents((await f.w.publicRead()).events,[]);assert.equal(catalog.length,1);assert.equal(catalog[0].sessions.length,2);assert.equal(catalog[0].capacity,30);
 await assert.rejects(f.w.register(f.parent._id,{}),{statusCode:409});
 const owners=await f.w.getOwners(f.parent._id);
 await f.w.setOwners(f.parent._id,{primary:'new-owner',coOwners:['second-owner'],token:owners.token},'reviewer');
 assert.ok(f.tables[WF.events].every(e=>e['负责人账号ID']==='new-owner'&&workflowEventApproved(e)));
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['负责人账号ID'],'new-owner');
 await f.w.close(f.parent._id);
 assert.ok(f.tables[WF.events].every(e=>e['状态']==='已结束'));
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
});
test('pending project saves editable positions without public rows; approval then publish materializes them',async()=>{
 const f=await fixture(),body=f.payload();
 body.positions[0].campus='浦口';
 assert.equal((await f.w.configurePositions(f.parent._id,body,'owner')).draft,true);
 assert.equal(f.tables[WF.events].length,1);assert.equal(f.tables[ORDINARY_GROUP_TABLE].length,0);
 assert.equal(f.tables[WF.events][0]['状态'],'待审核');
 await assert.rejects(f.w.publish(f.parent._id),{statusCode:409});
 await assert.rejects(f.w.configurePositions(f.parent._id,{...body,positions:[body.positions[0]]},'owner'),{statusCode:409});
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');
 const detail=await f.w.detail(f.parent._id);assert.equal(detail.events[0].positionToken,workflowApprovalHash(f.tables[WF.events][0]));
 await f.w.approve(f.parent._id,'reviewer');await f.w.publish(f.parent._id);
 assert.equal(f.tables[WF.events].length,3);assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'开放');
 assert.equal(JSON.parse(f.tables[WF.events][1]['报名页配置']).ordinary.campus,'浦口');
 assert.ok(f.tables[WF.events].every(workflowEventApproved));
});
test('approved adjustments preserve registered positions and close publication until republished',async()=>{
 const f=await fixture();await f.w.approve(f.parent._id,'reviewer');
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');await f.w.publish(f.parent._id);
 const first=f.tables[WF.events][1];f.tables[WF.registrations].push({_id:'synthetic-registration',活动ID:first['活动ID']});
 const unchanged=f.payload();await f.w.configurePositions(f.parent._id,unchanged,'owner');
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'开放');
 await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions:[{...f.positions[0],name:'changed'},f.positions[1]]},'owner'),{statusCode:409});
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'开放');
 await f.w.configurePositions(f.parent._id,{...f.payload(),positions:[f.positions[0],{...f.positions[1],name:'调整后的登记',campus:'浦口'}]},'owner');
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
 assert.equal(f.tables[WF.events][1]._id,first._id);
 assert.equal(f.tables[WF.registrations][0]['活动ID'],first['活动ID']);
 await f.w.publish(f.parent._id);
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'开放');
 assert.equal(projectWorkflowEvents((await f.w.publicRead()).events,[])[0].sessions.length,2);
});
test('duplicate, out-of-range and unknown campus positions reject before writing',async()=>{
 const f=await fixture();
 for(const positions of [[f.positions[0],f.positions[0]],[{...f.positions[0],campus:'未知'}],[{...f.positions[0],start:'2030-10-28T01:00:00'}]])await assert.rejects(f.w.configurePositions(f.parent._id,{...f.payload(),positions},'owner'),{statusCode:400});
 assert.equal(f.tables[WF.events].length,1);assert.equal(JSON.parse(f.tables[WF.events][0]['报名页配置']).positionDraft,undefined);
});
test('editing parent preserves the position draft and rejects a conflicting range',async()=>{
 const f=await fixture();await f.w.configurePositions(f.parent._id,f.payload(),'owner');
 const input={name:'修改合成项目',center:'生命中心',bookingMode:'grouped',window:{start:'2030-10-29T08:00:00',end:'2030-10-30T18:00:00'},capacity:30,serviceHours:2,trainingHours:0,travelHours:0,location:'合成校区',work:'合成服务'};
 await f.w.edit(f.parent._id,input,'owner');
 assert.equal(JSON.parse(f.tables[WF.events][0]['报名页配置']).positionDraft.positions.length,2);
 await assert.rejects(f.w.edit(f.parent._id,{...input,capacity:1},'owner'),{statusCode:409});
 assert.equal(Number(f.tables[WF.events][0]['容量']),30);
 await f.w.configurePositions(f.parent._id,f.payload(),'owner');
 assert.equal(f.tables[WF.events][0]['状态'],'草稿');
 await assert.rejects(f.w.publish(f.parent._id),{statusCode:409});
});
test('interrupted position generation resumes without duplicate rows or opening registration',async()=>{
 const f=await fixture();await f.w.approve(f.parent._id,'reviewer');const body=f.payload();f.interrupt();
 await assert.rejects(f.w.configurePositions(f.parent._id,body,'owner'),/interrupted/);
 await assert.rejects(f.w.publish(f.parent._id),{statusCode:409});
 assert.equal(f.tables[ORDINARY_GROUP_TABLE][0]['报名开关'],'关闭');
 await f.w.configurePositions(f.parent._id,body,'owner');
 await f.w.configurePositions(f.parent._id,body,'owner');
 assert.equal(f.tables[WF.events].length,3);assert.equal(f.tables[ORDINARY_GROUP_TABLE].length,1);
 await assert.rejects(f.w.edit(f.parent._id,{},'owner'),{statusCode:409});
 await assert.rejects(f.w.configurePositions(f.parent._id,{...body,positions:[f.positions[0]]},'owner'),{statusCode:409});
});
