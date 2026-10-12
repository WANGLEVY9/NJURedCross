import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {createWishlist,WISHLIST_SCHEMA} from '../lib/events/wishlist.js';
const account={accountId:'synthetic',studentId:'999990001',realName:'合成同学',email:'999990001@smail.nju.edu.cn',emailVerified:true};
function fixture(options={}){let time=Date.parse('2026-10-06'),sequence=0;const tables=Object.fromEntries([...Object.values(WF),'source',WISHLIST_SCHEMA.name].map(t=>[t,[]]));tables.source=[{_id:'position',日期:'2026-10-12',点位:'新街口中央',活动时间:'上午 11~15点',周次:46,姓名:'private-name',学号:'private-student',邮箱:'private-email',报名结果:'成功'}];
 const base={async listRows(t,_v,_o,_c,s=0,l=500){return structuredClone(tables[t].slice(s,s+l));},async appendRow(t,row){const value={...row,_id:String(++sequence)};tables[t].push(value);return {_id:value._id};},async updateRow(t,id,patch){Object.assign(tables[t].find(r=>r._id===id),patch);}};
 const workflow=createWorkflow(base,{bloodSourceTable:'source',now:()=>time}),messages=[];let succeeds=true;
 const wishlist=createWishlist(base,workflow,{now:()=>time,origin:'https://example.test',sendMail:async message=>{messages.push(message);return {ok:succeeds};},...options});
 return {tables,workflow,wishlist,messages,advance:()=>{time+=300001;},fail:()=>{succeeds=false;},recover:()=>{succeeds=true;},async event(){return (await workflow.publicRead()).events[0];}};
}
test('occupied position is full, cannot register; ordinary source projection omits other identities',async()=>{const f=fixture(),e=await f.event();assert.equal(JSON.stringify(e).includes('private-'),false);await assert.rejects(f.workflow.register(e._id,account),{statusCode:409});const positions=await f.workflow.positions(e._id);assert.equal(positions[0].profile.姓名,'private-name');});
test('subscriptions are idempotent, owned and send once after external source release',async()=>{const f=fixture(),id=(await f.event())._id;await Promise.all([f.wishlist.subscribe(id,account),f.wishlist.subscribe(id,account)]);assert.equal(f.tables[WISHLIST_SCHEMA.name].length,1);assert.deepEqual(await f.wishlist.own({accountId:'other'}),[]);await f.wishlist.unsubscribe(id,{accountId:'other'});await f.wishlist.deliver();assert.equal(f.messages.length,0);Object.assign(f.tables.source[0],{姓名:'',学号:'',邮箱:'',报名结果:'可报名'});await Promise.all([f.wishlist.deliver(),f.wishlist.deliver()]);await f.wishlist.deliver();assert.equal(f.messages.length,1);assert.equal(f.messages[0].to,account.email);assert.equal(f.messages[0].text.includes('private-'),false);assert.deepEqual(await f.wishlist.own(account),[]);});
test('unsubscribe prevents notification and failure retries with same mail key',async()=>{const f=fixture(),id=(await f.event())._id;await f.wishlist.subscribe(id,account);await f.wishlist.subscribe(id,{...account,accountId:'cancelled'});await f.wishlist.unsubscribe(id,{accountId:'cancelled'});Object.assign(f.tables.source[0],{姓名:'',学号:'',邮箱:'',报名结果:'可报名'});f.fail();await f.wishlist.deliver();await f.wishlist.deliver();assert.equal(f.messages.length,1);f.advance();f.recover();await f.wishlist.deliver();assert.equal(f.messages.length,2);assert.equal(f.messages[0].idempotencyKey,f.messages[1].idempotencyKey);await f.wishlist.deliver();assert.equal(f.messages.length,2);});
test('cannot subscribe to free slots or unverified identities',async()=>{const f=fixture(),id=(await f.event())._id;await assert.rejects(f.wishlist.subscribe(id,{...account,emailVerified:false}),{statusCode:409});Object.assign(f.tables.source[0],{姓名:'',学号:'',邮箱:'',报名结果:'可报名'});await assert.rejects(f.wishlist.subscribe(id,account),{statusCode:409});});

test('ordinary workflow activities support vacancy reminders and reject duplicate participants',async()=>{
 const f=fixture();
 const event=await f.workflow.create({name:'合成博爱活动',category:'博爱中心',date:'2026-10-12',slot:'下午',position:'服务岗',capacity:1,serviceHours:1,location:'合成地点',work:'合成工作事项'},'organizer');
 await f.workflow.approve(event._id,'reviewer');await f.workflow.publish(event._id);
 await f.workflow.register(event._id,{...account,accountId:'other',studentId:'999990002',email:'999990002@smail.nju.edu.cn'});
 await f.wishlist.subscribe(event._id,account);
 await assert.rejects(f.wishlist.subscribe(event._id,{...account,accountId:'other'}),{statusCode:409});
 f.tables[WF.registrations][0]['报名状态']='已请假';
 await f.wishlist.deliver();await f.wishlist.deliver();
 assert.equal(f.messages.length,1);assert.equal(f.messages[0].subject,'你关注的活动有空位了');
 assert.ok(f.messages[0].text.includes(`/workflow-events?event=${event._id}`));
});

test('managed activities subscribe, release once and expire at the registration deadline',async()=>{
 const event={_id:'managed:EVT-test',活动ID:'EVT-test',活动名称:'合成急救活动',状态:'报名中',报名日期:'2026-10-12',容量:1,报名页配置:JSON.stringify({managed:true,startAt:'2026-10-12T14:00:00+08:00',registrationEnd:'2026-10-10T23:00:00+08:00',remaining:0})};
 const managed={events:[event],registrations:[]};
 const f=fixture({getManagedData:async()=>structuredClone(managed)});
 await f.wishlist.subscribe(event._id,account);
 event.报名页配置=JSON.stringify({...JSON.parse(event.报名页配置),remaining:1});
 await f.wishlist.deliver();await f.wishlist.deliver();
 assert.equal(f.messages.length,1);assert.ok(f.messages[0].text.includes('/events/EVT-test'));
 event.报名页配置=JSON.stringify({...JSON.parse(event.报名页配置),remaining:0,registrationEnd:'2026-10-01'});
 await assert.rejects(f.wishlist.subscribe(event._id,account),{statusCode:409});
});
