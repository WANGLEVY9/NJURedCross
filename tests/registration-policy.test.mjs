import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF} from '../lib/events/workflow.js';
const account={accountId:'synthetic',studentId:'999990001',realName:'合成同学',email:'999990001@smail.nju.edu.cn',emailVerified:true};
function fixture(location='新街口中央'){
 const tables=Object.fromEntries(Object.values(WF).map(name=>[name,[]]));let seq=0;
 tables.source=[{_id:'source',日期:'2026-12-01',点位:location,活动时间:'上午 11~15点',周次:53,报名结果:'可报名'}];
 const base={async listRows(table,_v,_o,_c,start=0,limit=500){return structuredClone(tables[table].slice(start,start+limit));},async getRow(table,id){return structuredClone(tables[table].find(row=>row._id===id));},async appendRow(table,row){const added={...row,_id:`synthetic-${++seq}`};tables[table].push(added);return {_id:added._id};},async updateRow(table,id,patch){Object.assign(tables[table].find(row=>row._id===id),patch);}};
 return {tables,w:createWorkflow(base,{mode:'production',bloodSourceTable:'source',now:()=>Date.parse('2026-11-30T00:00:00+08:00')})};
}
test('pending signup cancels immediately, releases the position and allows re-registration',async()=>{
 const {w,tables}=fixture(),event=(await w.publicRead()).events[0],registration=await w.register(event._id,account);
 assert.equal(registration.报名状态,'待筛选');
 await assert.rejects(w.requestLeave(registration.报名ID,account,'合成原因'),{statusCode:409});
 await assert.rejects(w.cancel(registration.报名ID,{...account,accountId:'other'}),{statusCode:404});
 await w.cancel(registration.报名ID,account);await w.cancel(registration.报名ID,account);
 assert.equal(tables.source[0].报名结果,'可报名');assert.equal(tables[WF.registrations][0].报名状态,'已取消');
 const second=await w.register(event._id,account);assert.notEqual(second.报名ID,registration.报名ID);
 await w.confirm(second._id);await assert.rejects(w.cancel(second.报名ID,account),{statusCode:409});
 await w.requestLeave(second.报名ID,account,'确认后请假');assert.equal(tables[WF.registrations][1].请假状态,'待审批');
});
test('Pukou Hongyang blood shift immediately succeeds and only permits leave after signup',async()=>{
 const {w,tables}=fixture('浦口弘阳广场'),event=(await w.publicRead()).events[0],registration=await w.register(event._id,account);
 assert.equal(registration.报名状态,'已确认');assert.equal(registration.是否报名成功,'true');assert.equal(tables.source[0].报名结果,'成功');
 await assert.rejects(w.cancel(registration.报名ID,account),{statusCode:409});
 await w.requestLeave(registration.报名ID,account,'合成请假');await w.decideLeave(registration._id,true,'合成批准');assert.equal(tables.source[0].报名结果,'可报名');
});
test('ordinary events at Hongyang still require confirmation',async()=>{
 const {w}=fixture();const event=await w.create({name:'普通公益活动',date:'2026-12-01',slot:'下午',position:'宣传',capacity:2,serviceHours:2,location:'浦口弘阳广场',work:'合成服务'},'owner');
 await w.approve(event._id,'reviewer');await w.publish(event._id);
 assert.equal((await w.register(event._id,account)).报名状态,'待筛选');
});
