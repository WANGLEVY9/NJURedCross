import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityFeedbackStore} from '../lib/events/activity-feedback.js';
import {createActivityFeedbackManagement} from '../lib/events/activity-feedback-management.js';

const manager=(accountId,region,role,categories)=>({accountId,region,role,categories,active:true,emailVerified:true,status:'启用',email:`${accountId}@example.test`});
const director=manager('director','nanjing','director',['博爱中心']);
const another=manager('another','nanjing','director',['博爱中心']);
const other=manager('other','nanjing','director',['生命中心']);
const chair=manager('chair','suzhou','presidium',['综事中心']);
const unrelated=manager('unrelated','suzhou','director',['博爱中心']);
const global=manager('global','nanjing','global',['博爱中心','生命中心']);
const roster={complete:true,rows:[director,another,other,chair,unrelated,global]};
const member={accountId:'participant'};
const event=(id,center)=>({_id:id,活动ID:id,活动名称:`合成活动 ${id}`,组织类别:center,活动地区:'南京地区',报名页配置:'{}'});
const events=[event('one','博爱中心'),event('two','生命中心')];
const row=id=>({_id:`feedback-${id}`,活动ID:id,学号:'999999999',姓名:'=HYPERLINK("fake")'});
const response={rating:4,answers:['合成反馈全文'],version:0};

function fixture(t){
 let clock=Date.parse('2030-01-01');
 const store=createActivityFeedbackStore(':memory:',{now:()=>clock});t.after(()=>store.close());
 const service=createActivityFeedbackManagement({getStore:async()=>store,getRoster:async()=>roster,getEvents:async()=>events});
 return {store,service,advance:()=>{clock+=60_000;}};
}

test('feedback list, facets, read status and export enforce the same department scope',async t=>{
 const {store,service}=fixture(t);
 await store.write(row('one'),member,'rating',response);
 await store.write(row('two'),member,'rating',{...response,answers:['其他中心全文']});
 const params=new URLSearchParams();
 assert.deepEqual((await service.list(director,params)).items.map(item=>item.eventId),['one']);
 assert.deepEqual((await service.list(director,params)).events.map(item=>item.id),['one']);
 assert.equal((await service.list(chair,params)).items.length,2);
 assert.equal((await service.list(unrelated,params)).items.length,0);
 assert.equal((await service.list(director,new URLSearchParams({event:'two',template:'rating'}))).items.length,0);
 await assert.rejects(service.list({...member,status:'启用',emailVerified:true},params),{statusCode:403});
 await assert.rejects(service.list({...global,role:'super_admin'},params),{statusCode:403});
 await assert.rejects(service.markRead(director,'feedback-two'),{statusCode:404});
 assert.equal((await service.tasks(director)).length,1);
 await service.markRead(director,'feedback-one');
 assert.equal((await service.tasks(director)).length,0);
 assert.equal((await service.tasks(another)).length,1);
 const csv=await service.list(director,params,{exporting:true});
 assert.match(csv,/合成反馈全文/);assert.match(csv,/'=HYPERLINK/);assert.doesNotMatch(csv,/其他中心全文|999999999/);
});

test('new feedback emails every scoped manager and chair, retries the failed recipient, and does not resend edits',async t=>{
 const {store,service,advance}=fixture(t);
 await store.write(row('one'),member,'rating',response);
 const calls=[];
 const run=()=>service.deliver({origin:'https://example.test',send:async message=>{
  assert.doesNotMatch(message.text,/合成反馈全文|HYPERLINK/);
  calls.push(message);
  return {ok:message.to!==another.email||calls.filter(entry=>entry.to===another.email).length>1,transport:'smtp'};
 }});
 await run();
 assert.deepEqual(calls.map(item=>item.to).sort(),[another.email,chair.email,director.email].sort());
 await run();assert.equal(calls.length,3);
 advance();await run();assert.equal(calls.at(-1).to,another.email);assert.equal(calls.length,4);
 assert.equal(calls[3].idempotencyKey,calls.find(item=>item.to===another.email).idempotencyKey);
 await store.write(row('one'),member,'rating',{...response,version:1});
 advance();await run();assert.equal(calls.length,4);
});
