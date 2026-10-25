import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mailDeliveryStatuses} from '../lib/mailer.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';

test('mail evidence is paginated, matches exact result keys and excludes console-only output',async()=>{
 const log=(key,status,transport='smtp')=>({幂等键:key,状态:status,类型:'workflow-result',通道:transport,发送时间:'2026-10-07T02:00:00Z',收件人:'private@example.test',错误:'private error'});
 const records=Array.from({length:500},(_,i)=>log('unrelated-'+i,'已发送'));
 records.push(log('yes','失败'),log('yes','已发送'),log('yes','失败'),log('no','失败'),log('dev','已发送','console'));
 const offsets=[];const client={listRows:async(_t,_v,_o,_c,start,n)=>{offsets.push(start);return records.slice(start,start+n);},appendRow:()=>assert.fail('read only'),updateRow:()=>assert.fail('read only')};
 const result=await mailDeliveryStatuses(client,['yes','no','dev','missing']);
 assert.deepEqual(offsets,[0,500]);assert.deepEqual(result.yes,{status:'sent',sentAt:'2026-10-07T02:00:00Z'});assert.equal(result.no.status,'failed');assert.equal(result.dev.status,'not_sent');assert.equal(result.missing.status,'not_sent');assert.ok(!JSON.stringify(result).includes('private'));
 await assert.rejects(mailDeliveryStatuses(null,['yes']));
});

test('mail status route is private, read only, scoped to current event and current registration result',async()=>{
 let allowed=true,calls=0;
 const data={events:[{_id:'event',活动ID:'e'}],registrations:[{_id:'a',活动ID:'e',报名ID:'A',报名状态:'已确认'},{_id:'b',活动ID:'e',报名ID:'B',报名状态:'未入选'},{_id:'c',活动ID:'e',报名ID:'C',报名状态:'待筛选'},{_id:'d',活动ID:'other',报名ID:'D',报名状态:'已确认'}]};
 const ctx={requireConsoleAccess:()=>allowed?{}:null,getWorkflow:async()=>({overview:async()=>data}),getResultMailStatus:async keys=>{calls++;assert.deepEqual(keys,['WF-RESULT:A:yes','WF-RESULT:B:no']);return {'WF-RESULT:A:yes':{status:'sent',sentAt:'2026-10-07T02:00:00Z'},'WF-RESULT:B:no':{status:'failed'}};},json:(_r,status,body)=>({status,body}),sendResultMail:()=>assert.fail('reading status cannot send email')};
 const call=()=>workflowRoutes({method:'GET',headers:{}},null,new URL('http://localhost/api/volunteer/workflow/events/event/mail-status'),ctx);
 allowed=false;await call();assert.equal(calls,0);allowed=true;
 assert.deepEqual((await call()).body.items,[{id:'a',status:'sent',sentAt:'2026-10-07T02:00:00Z'},{id:'b',status:'failed',sentAt:''}]);
 // Another request uses durable evidence, without relying on the first response.
 assert.equal((await call()).body.items[0].status,'sent');
 ctx.getResultMailStatus=async()=>{throw Error('records unavailable');};assert.ok((await call()).body.items.every(item=>item.status==='unknown'));
});
