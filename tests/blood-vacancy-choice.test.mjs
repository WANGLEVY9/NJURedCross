import test from 'node:test';
import assert from 'node:assert/strict';
import {syncBloodBooking} from '../lib/events/blood-booking.js';
import {generatedBloodEvents} from '../lib/events/blood-source.js';
const event={报名日期:'2030-10-23',地点:'新街口中央',报名时段:'上午 11~15点'};
const registration={报名ID:'synthetic-booking',账号ID:'synthetic-account',学号:'999990001',姓名:'模拟同学',邮箱:'999990001@smail.nju.edu.cn'};
function fixture(){
 const rows=[{_id:'one',日期:'2030-10-23',点位:event['地点'],活动时间:event['报名时段'],周次:43,网站报名ID:registration['报名ID'],网站账号ID:registration['账号ID'],学号:registration['学号'],报名结果:'待审核'},{_id:'two',日期:'2030-10-23',点位:event['地点'],活动时间:event['报名时段'],周次:43,报名结果:'可报名'}];
 let queries=0;const base={query:async sql=>{queries++;return structuredClone(sql.includes('`网站报名ID` =')?rows.filter(r=>r['网站报名ID']===registration['报名ID']):rows);},getRow:async(_t,id)=>structuredClone(rows.find(r=>r._id===id)),updateRow:async(_t,id,p)=>Object.assign(rows.find(r=>r._id===id),p),listRows:async()=>{throw Error('must not scan table');}};return {rows,base,queries:()=>queries};
}
test('closing a rejected source vacancy affects only its owned position and can reconcile retry',async()=>{
 const f=fixture();await syncBloodBooking(f.base,'source',event,registration,'停点');assert.equal(f.rows[0]['报名结果'],'停点');assert.equal(f.rows[1]['报名结果'],'可报名');
 assert.equal(generatedBloodEvents(f.rows,0)[0]['容量'],1);await syncBloodBooking(f.base,'source',event,registration,'停点');assert.equal(f.queries(),4);
});
test('releasing a rejected or approved-leave position keeps it available and clears ownership',async()=>{
 const f=fixture();await syncBloodBooking(f.base,'source',event,registration,'可报名');assert.equal(f.rows[0]['报名结果'],'可报名');assert.equal(f.rows[0]['网站报名ID'],'');assert.equal(f.rows[1]['报名结果'],'可报名');
});
test('another participant ownership is never closed',async()=>{
 const f=fixture();f.rows[0]['网站账号ID']='other';await assert.rejects(syncBloodBooking(f.base,'source',event,registration,'停点'),{statusCode:409});assert.equal(f.rows[0]['报名结果'],'待审核');
});
import {workflowRoutes} from '../lib/events/workflow-api.js';
test('single rejection API passes vacancy choice and rejects invalid choice before a write',async()=>{
 let calls=[];const event={_id:'event',活动ID:'event',报名页配置:JSON.stringify({source:{kind:'generated_blood'}})},row={_id:'registration',活动ID:'event'};
 const ctx={requireConsoleAccess:()=>({username:'synthetic-super',role:'super_admin'}),requireCsrf:()=>true,actor:()=> 'synthetic-super',getWorkflow:async()=>({read:async()=>({events:[event],registrations:[row]}),reject:async(...args)=>{calls.push(args);return {};}}),readJson:async req=>req.body,audit:async()=>{},json:(_res,status,body)=>({status,body})};
 const url=new URL('http://fixture.test/api/volunteer/workflow/registrations/registration/reject');
 const req=body=>({method:'POST',headers:{host:'fixture.test'},body});
 assert.equal((await workflowRoutes(req({reason:'合成原因',reopen:false}),null,url,ctx)).status,200);assert.deepEqual(calls[0],['registration','合成原因',{reopen:false}]);
 assert.equal((await workflowRoutes(req({reason:'合成原因',reopen:'false'}),null,url,ctx)).status,400);assert.equal(calls.length,1);
});
