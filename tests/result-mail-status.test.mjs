import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mailDeliveryStatuses} from '../lib/mailer.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {MAIL_TABLE} from '../lib/mailer.js';

test('mail evidence is paginated, matches exact result keys and excludes console-only output',async()=>{
 const log=(key,status,transport='smtp')=>({幂等键:key,状态:status,类型:'workflow-result',通道:transport,发送时间:'2026-10-07T02:00:00Z',收件人:'private@example.test',错误:'private error'});
 const records=Array.from({length:1000},(_,i)=>log('unrelated-'+i,'已发送'));
 records.push(log('yes','失败'),log('yes','已发送'),log('yes','失败'),log('no','失败'),log('dev','已发送','console'));
 const offsets=[];const client={listRows:async(_t,_v,_o,_c,start,n)=>{offsets.push(start);return records.slice(start,start+n);},appendRow:()=>assert.fail('read only'),updateRow:()=>assert.fail('read only')};
 const result=await mailDeliveryStatuses(client,['yes','no','dev','missing']);
 assert.deepEqual(offsets,[0,1000]);assert.deepEqual(result.yes,{status:'sent',sentAt:'2026-10-07T02:00:00Z'});assert.equal(result.no.status,'failed');assert.equal(result.dev.status,'not_sent');assert.equal(result.missing.status,'not_sent');assert.ok(!JSON.stringify(result).includes('private'));
 await assert.rejects(mailDeliveryStatuses(null,['yes']));
});

test('mail status route is private, read only, scoped to current event and current registration result',async()=>{
 let allowed=true,calls=0;
 const data={events:[{_id:'event',活动ID:'e'}],registrations:[{_id:'a',活动ID:'e',报名ID:'A',报名状态:'已确认'},{_id:'b',活动ID:'e',报名ID:'B',报名状态:'未入选'},{_id:'c',活动ID:'e',报名ID:'C',报名状态:'待筛选'},{_id:'d',活动ID:'other',报名ID:'D',报名状态:'已确认'}]};
 const ctx={requireConsoleAccess:()=>allowed?{}:null,getWorkflow:async()=>({mailStatusData:async()=>data,overview:()=>assert.fail("no full overview")}),getResultMailStatus:async keys=>{calls++;assert.deepEqual(keys,['WF-RESULT:A:yes','WF-RESULT:B:no']);return {'WF-RESULT:A:yes':{status:'sent',sentAt:'2026-10-07T02:00:00Z'},'WF-RESULT:B:no':{status:'failed'}};},json:(_r,status,body)=>({status,body}),sendResultMail:()=>assert.fail('reading status cannot send email')};
 const call=()=>workflowRoutes({method:'GET',headers:{}},null,new URL('http://localhost/api/volunteer/workflow/events/event/mail-status'),ctx);
 allowed=false;await call();assert.equal(calls,0);allowed=true;
 assert.deepEqual((await call()).body.items,[{id:'a',status:'sent',sentAt:'2026-10-07T02:00:00Z'},{id:'b',status:'failed',sentAt:''}]);
 // Another request uses durable evidence, without relying on the first response.
 assert.equal((await call()).body.items[0].status,'sent');
 ctx.getResultMailStatus=async()=>{throw Error('records unavailable');};assert.ok((await call()).body.items.every(item=>item.status==='unknown'));
 });

test('mail status reads only requested event registrations and exact mail keys, without private columns',async()=>{
 const sqls=[];
 const base={listRows:()=>assert.fail('SQL adapters must not list entire tables'),query:async sql=>{
  sqls.push(sql);
  if(sql.includes(WF.registrations))return [{_id:'r',活动ID:'one',报名ID:"a'b",报名状态:'已确认'}];
  assert.ok(sql.includes(MAIL_TABLE));
  return [{幂等键:"WF-RESULT:a'b:yes",类型:'workflow-result',通道:'smtp',状态:'已发送',发送时间:'2026-10-23T00:00:00Z'}];
 }};
 const events=['one','other'].map(id=>({_id:id,活动ID:id}));
 const ctx={getEventAuthority:async()=>({canEnter:true,events,assertEvent:id=>assert.equal(id,'one'),filter:data=>data}),requirePortalSession:()=>({}),getWorkflow:async()=>createWorkflow(base),getResultMailStatus:keys=>mailDeliveryStatuses(base,keys),json:(_r,status,body)=>({status,body})};
 const result=await workflowRoutes({method:'GET'},null,new URL('http://localhost/api/volunteer/workflow/events/one/mail-status'),ctx);
 assert.equal(result.status,200);assert.equal(result.body.items[0].status,'sent');
 assert.equal(sqls.length,2);
 assert.match(sqls[0],/WHERE `活动ID` IN \('one'\)/);
 assert.match(sqls[1],/WHERE `幂等键` IN \('WF-RESULT:a''b:yes'\)/);
 assert.ok(!sqls[1].includes('SELECT *'));assert.ok(!sqls[1].includes('收件人'));
});

test('mail evidence SQL chunks keys, paginates matches and never falls back on incomplete reads',async()=>{
 const sqls=[];let first=true;
 const client={listRows:()=>assert.fail('no SQL failure fallback'),query:async sql=>{sqls.push(sql);if(first){first=false;return Array.from({length:1000},()=>({}));}return [];}};
 await mailDeliveryStatuses(client,Array.from({length:101},(_,i)=>`key-${i}`));
 assert.equal(sqls.length,3);assert.match(sqls[1],/OFFSET 1000/);assert.match(sqls[2],/IN \('key-100'\)/);
 client.query=async()=>{throw Error('query unavailable');};
 await assert.rejects(mailDeliveryStatuses(client,['key']));
 client.query=async()=>Object.assign([],{readMeta:{truncated:true}});
 await assert.rejects(mailDeliveryStatuses(client,['key']));
});

 test('batched mail status uses one scoped read for all requested sessions',async()=>{
 let overviews=0,lookups=0,allowed=true;
 const data={events:[{_id:'a',活动ID:'A'},{_id:'b',活动ID:'B'},{_id:'c',活动ID:'C'}],registrations:[{_id:'r1',活动ID:'A',报名ID:'1',报名状态:'已确认'},{_id:'r2',活动ID:'B',报名ID:'2',报名状态:'未入选'},{_id:'r3',活动ID:'C',报名ID:'3',报名状态:'待筛选'}]};
 const ctx={requireConsoleAccess:()=>allowed?{}:null,getWorkflow:async()=>({mailStatusData:async ids=>{overviews++;assert.ok(ids.includes("a"));return data;},overview:()=>assert.fail("no full overview")}),getResultMailStatus:async keys=>{lookups++;assert.deepEqual(keys,['WF-RESULT:1:yes','WF-RESULT:2:no']);return {'WF-RESULT:1:yes':{status:'sent',sentAt:'2026-10-07T02:00:00Z'},'WF-RESULT:2:no':{status:'failed'}};},json:(_r,status,body)=>({status,body})};
 const call=query=>workflowRoutes({method:'GET',headers:{}},null,new URL('http://localhost/api/volunteer/workflow/mail-status'+query),ctx);
 allowed=false;await call('?ids=a,b');assert.equal(overviews,0);allowed=true;
 assert.equal((await call('')).status,400);
 assert.equal((await call('?ids=')).status,400);
 const {body}=await call('?ids=a,b');
 assert.deepEqual(body.items,[{id:'r1',status:'sent',sentAt:'2026-10-07T02:00:00Z'},{id:'r2',status:'failed',sentAt:''}]);
 assert.deepEqual(body.missing,[]);
 // One scoped read and one mail lookup for two sessions: no per-session round trip.
 assert.equal(overviews,1);assert.equal(lookups,1);
 const unknown=await call('?ids=a,b,missing-event');
 assert.deepEqual(unknown.body.missing,['missing-event']);
 });
