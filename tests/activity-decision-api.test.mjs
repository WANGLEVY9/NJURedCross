import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowRoutes} from '../lib/events/workflow-api.js';

function fixture(){
 const events=[{_id:'e',活动ID:'E',报名页配置:'{}'}],registrations=['a','b'].map(id=>({_id:id,活动ID:'E'})),calls=[];
 const w={read:async()=>({events,registrations}),overview:async()=>({events,registrations}),confirm:async id=>{calls.push(['confirm',id]);if(id==='b')throw Object.assign(Error('synthetic conflict'),{statusCode:409});},reject:async(id,reason)=>calls.push(['reject',id,reason]),decideLeave:async(id,approved,reason)=>{calls.push(['leave',id,approved]);return {notificationDecision:{approved,reason,requestAt:'2030-10-01T00:00:00Z'}};}};
 const ctx={getWorkflow:async()=>w,requireConsoleAccess:()=>({role:'super_admin'}),requireCsrf:()=>true,readJson:async req=>req.body,actor:()=> 'synthetic-reviewer',audit:async()=>{},json:(_r,status,body)=>({status,body}),notifyRegistrationDecisions:items=>{calls.push(['notify',items]);return true;}};
 const call=(path,body={})=>workflowRoutes({method:'POST',body,headers:{}},null,new URL(`http://localhost/api/volunteer/workflow/${path}`),ctx);
 return {ctx,calls,call};
}
test('committed single approval and rejection wake delivery even with durable-table hook absent',async()=>{
 for(const action of ['confirm','reject']){
  const f=fixture(),out=await f.call(`registrations/a/${action}`,{reason:'合成拒绝原因'});
  assert.equal(out.status,200);assert.equal(out.body.result.mailPending,true);
  assert.deepEqual(f.calls.at(-1),['notify',[{kind:action,id:'a',...(action==='reject'?{reason:'合成拒绝原因'}:{})}]]);
 }
});
test('partial batch only queues successful decisions and does not await transport',async()=>{
 const f=fixture(),out=await f.call('registrations/batch',{ids:['a','b'],action:'confirm'});
 assert.equal(out.status,200);assert.equal(out.body.mailPending,true);
 assert.deepEqual(f.calls.at(-1),['notify',[{kind:'confirm',id:'a'}]]);
 assert.deepEqual(out.body.results.map(row=>row.ok),[true,false]);
});
test('leave hook receives committed frozen reason and request identity',async()=>{
 const f=fixture(),out=await f.call('registrations/a/leave-reject',{reason:'合成请假说明'});
 assert.equal(out.body.result.mailPending,true);
 assert.deepEqual(f.calls.at(-1),['notify',[{kind:'leave',id:'a',approved:false,reason:'合成请假说明',requestAt:'2030-10-01T00:00:00Z'}]]);
});
test('batch leave decisions require reason and persist each committed notification identity',async()=>{
 const f=fixture();
 assert.equal((await f.call('registrations/batch',{ids:['a','b'],action:'leave-approve'})).status,400);
 assert.equal(f.calls.length,0);
 const out=await f.call('registrations/batch',{ids:['a','b'],action:'leave-approve',reason:'合成统一说明'});
 assert.equal(out.status,200);assert.equal(out.body.mailPending,true);
 assert.deepEqual(f.calls.at(-1),['notify',['a','b'].map(id=>({kind:'leave',id,approved:true,reason:'合成统一说明',requestAt:'2030-10-01T00:00:00Z'}))]);
});
test('denied or failed decisions do not enqueue, queue failure does not undo business decision',async()=>{
 const f=fixture();f.ctx.requireCsrf=()=>false;
 assert.equal(await f.call('registrations/a/confirm'),undefined);assert.equal(f.calls.length,0);
 f.ctx.requireCsrf=()=>true;
 await assert.rejects(f.call('registrations/b/confirm'),/synthetic conflict/);
 assert.equal(f.calls.some(([kind])=>kind==='notify'),false);
 f.ctx.notifyRegistrationDecisions=()=>{throw Error('synthetic queue failure');};
 const out=await f.call('registrations/a/confirm');assert.equal(out.status,200);assert.equal(out.body.result,null);
});
