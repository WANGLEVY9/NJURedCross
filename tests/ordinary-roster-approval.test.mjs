import test from 'node:test';
import assert from 'node:assert/strict';
import {createRosterReview,rosterToken} from '../lib/events/roster-review.js';
import {managementRoutes} from '../lib/events/management-api.js';
import {rosterReview} from '../public/app/shared/roster-review.js';

function fixture(){
 const event={_id:'e',活动ID:'event',活动名称:'合成活动',状态:'报名中',容量:'2',报名页配置:JSON.stringify({ordinary:{groupId:'fixture'}})};
 const registrations=['a','b'].map(id=>({_id:id,活动ID:'event',报名ID:`WR-${id}`,报名状态:'待筛选',是否报名成功:'false',邮箱:`${id}@fixture.invalid`}));
 const data={events:[event],registrations,checkins:[],ledger:[]};
 const w=createRosterReview({read:async()=>structuredClone(data),write:fn=>fn(),WF:{events:'events',registrations:'registrations'},approved:()=>true,update:async(table,row,patch)=>Object.assign(data[table].find(r=>r._id===row._id),patch)});
 const token=()=>rosterToken(event,registrations);
 return {event,registrations,w,token};
}

test('ordinary individual approval commits only the selected row and deduplicates success delivery',async()=>{
 const f=fixture(),sent=[];
 await f.w.stageRoster('e',['a'],'confirm','',f.token(),{immediate:true});
 assert.equal(f.registrations[0].报名状态,'已确认');assert.equal(f.registrations[1].报名状态,'待筛选');
 const send=async m=>{sent.push(m);return {ok:true,transport:'synthetic'};};
 await f.w.deliverRoster('e',{send});await f.w.deliverRoster('e',{send});
 assert.equal(sent.length,1);assert.equal(rosterReview(f.event).phase,'draft');
});

test('ordinary reviews retain stale-token, capacity and pending-leave guards',async()=>{
 const f=fixture(),old=f.token();f.registrations[1].请假状态='待审批';
 await assert.rejects(f.w.stageRoster('e',['a'],'confirm','',old,{immediate:true}),/名单已变化/);
 await assert.rejects(f.w.stageRoster('e',['b'],'confirm','',f.token(),{immediate:true}),/不能调整/);
 f.registrations[1].请假状态='';f.event.容量='1';
 await assert.rejects(f.w.stageRoster('e',['a','b'],'confirm','',f.token(),{immediate:true}),/上限/);
 assert.ok(f.registrations.every(r=>r.报名状态==='待筛选'));
});

test('ordinary review preserves historical approved data and generated source guard',async()=>{
 const f=fixture();Object.assign(f.registrations[0],{报名状态:'已确认',是否报名成功:'true',处理说明:'历史决定'});
 const old=structuredClone(f.registrations[0]);
 await f.w.stageRoster('e',['b'],'confirm','',f.token(),{immediate:true});
 assert.deepEqual(f.registrations[0],old);
 f.event.报名页配置=JSON.stringify({source:{kind:'generated_blood'}});
 await assert.rejects(f.w.stageRoster('e',['b'],'confirm','',f.token(),{immediate:true}),/源表排班/);
});

async function route(f,body,send=async()=>({ok:true,transport:'synthetic'}),hooks={}){
 return managementRoutes({method:'POST'},null,new URL('https://fixture.invalid/api/volunteer/workflow/events/e/batch-decide'),{actor:()=> 'trusted-director',readJson:async()=>body,json:(_r,status,payload)=>({status,...payload}),audit:async()=>{},sendResultMail:send,...hooks},f.w,{});
}

test('immediate approval wakes background only after commit without requesting SMTP',async()=>{
 for(const ids of [['a'],['a','b']]){
  const f=fixture();let wakes=0,sends=0,deliveries=0,committedAtWake=false;
  f.w.deliverRoster=async()=>{deliveries++;return {};};
  const response=await route(f,{ids,decision:'confirm',token:f.token()},async()=>{sends++;return {ok:true};},{queueRegistrationNotifications:()=>{
   wakes++;committedAtWake=ids.every(id=>f.registrations.find(r=>r._id===id).报名状态==='已确认');
  }});
  assert.equal(response.status,200);assert.equal(response.result.mailPending,true);assert.equal(response.result.mail,undefined);
  assert.equal(wakes,1);assert.equal(committedAtWake,true);assert.equal(deliveries,0);assert.equal(sends,0);
 }
});

test('draft changes and rejected approval validation never wake notifications',async()=>{
 const f=fixture();let wakes=0;
 const hooks={queueRegistrationNotifications:()=>{wakes++;}};
 await route(f,{ids:['a'],decision:'confirm',immediate:false,token:f.token()},undefined,hooks);
 await route(f,{ids:['b'],decision:'reject',reason:'合成原因',token:f.token()},undefined,hooks);
 await assert.rejects(route(f,{ids:['a'],decision:'confirm',token:'stale'},undefined,hooks),/名单已变化/);
 assert.equal(wakes,0);
});

test('wake failure keeps committed approval pending without falling back to SMTP',async()=>{
 const f=fixture();let sends=0;
 const response=await route(f,{ids:['a'],decision:'confirm',token:f.token()},async()=>{sends++;return {ok:true};},{queueRegistrationNotifications:()=>{throw Error('synthetic wake failure');}});
 assert.equal(response.status,200);assert.equal(response.result.mailPending,true);assert.equal(f.registrations[0].报名状态,'已确认');assert.equal(sends,0);
});

test('management confirm defaults to immediate approval for single and batch callers',async()=>{
 for(const ids of [['a'],['a','b']]){
  const f=fixture(),sent=[];
  const response=await route(f,{ids,decision:'confirm',token:f.token()},async m=>{sent.push(m);return {ok:true,transport:'synthetic'};});
  assert.equal(response.status,200);assert.equal(response.result.mail.delivered,ids.length);assert.equal(sent.length,ids.length);
  assert.equal(f.registrations.filter(r=>r.报名状态==='已确认').length,ids.length);
 }
});

test('explicit draft mode and rejection remain drafts; malformed immediacy fails closed',async()=>{
 const f=fixture();
 await route(f,{ids:['a'],decision:'confirm',immediate:false,token:f.token()},()=>assert.fail('draft must not send'));
 await route(f,{ids:['b'],decision:'reject',reason:'合成原因',token:f.token()},()=>assert.fail('draft must not send'));
 assert.ok(f.registrations.every(r=>r.报名状态==='待筛选'));
 const response=await route(f,{ids:['a'],decision:'confirm',immediate:'true',token:f.token()});assert.equal(response.status,400);
});

test('mail outage reports pending without rolling back committed approval',async()=>{
 const f=fixture();
 const response=await route(f,{ids:['a'],decision:'confirm',token:f.token()},async()=>{throw Error('synthetic outage');});
 assert.equal(response.status,200);assert.equal(response.result.mailPending,true);assert.equal(f.registrations[0].报名状态,'已确认');
});
