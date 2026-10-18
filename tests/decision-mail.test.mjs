import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDecisionMail,decisionMessage} from '../lib/events/decision-mail.js';
import {openDecisionMailStore,decisionOperationKey} from '../lib/events/decision-mail-store.js';

const secret='synthetic-decision-mail-test-secret-32-plus';
const requestAt='2026-10-17T02:00:00.000Z';

test('archived activities cancel queued outcome mail without sending',()=>{
 const data=snapshot();data.events[0]['状态']='已归档';assert.equal(decisionMessage(data,{kind:'confirm',id:'registration-1'},'https://example.test'),null);
});
const leave={kind:'leave',id:'registration-1',requestAt,approved:false,reason:'冻结的审批说明'};
function snapshot(overrides={},config={}){
 return {events:[{_id:'event-row',活动ID:'EVENT-1',活动名称:'合成活动',报名页配置:JSON.stringify(config)}],registrations:[{_id:'registration-1',报名ID:'WF-SYNTHETIC-1',活动ID:'EVENT-1',姓名:'合成测试',学号:'123456789',邮箱:'123456789@smail.nju.edu.cn',报名日期:'2026-10-20',报名时段:'上午',报名状态:'已确认',是否报名成功:'true',请假状态:'',请假申请时间:requestAt,处理说明:'其他说明',...overrides}]};
}
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'decision-mail-test-')),file=join(directory,'private.sqlite');
 let store=await openDecisionMailStore(file,{secret});
 const workers=[];
 t.after(async()=>{for(const worker of workers)await worker.close();store.close();await rm(directory,{recursive:true,force:true});});
 return {file,get store(){return store;},async reopen(){store.close();store=await openDecisionMailStore(file,{secret});return store;},worker(options={}){const worker=createDecisionMail({read:async()=>snapshot(),send:async()=>({ok:true,transport:'smtp'}),store,schedule:()=>{},retryDelay:10,...options});workers.push(worker);return worker;}};
}

test('durable OFF-mode confirmations/rejections, batch, exact deduplication and no historic scan',async t=>{
 const f=await fixture(t),messages=[];
 const data=snapshot();data.registrations.push({...data.registrations[0],_id:'registration-2',报名ID:'WF-SYNTHETIC-2',报名状态:'未入选',是否报名成功:'false'});
 const worker=f.worker({read:async()=>data,send:async message=>{messages.push(message);return {ok:true,transport:'smtp'};}});
 await worker.drain();assert.equal(messages.length,0);
 const items=[{kind:'confirm',id:'registration-1'},{kind:'reject',id:'registration-2'}];
 assert.equal(worker.enqueue(items),true);assert.equal(worker.enqueue(items),true);
 assert.equal(worker.pending(),2);assert.equal((await worker.drain()).sent,2);
 assert.equal(messages[0].to,'123456789@smail.nju.edu.cn');assert.ok(messages.some(message=>message.text.includes('未能录取')));
 assert.equal(worker.enqueue(items),false);await worker.drain();assert.equal(messages.length,2);
 await worker.close();await f.reopen();const restarted=f.worker({send:async()=>{throw Error('must not resend');}});
 await restarted.drain();assert.equal(restarted.info().states.sent,2);
});

test('restart restores only queued operations and freezes leave request time and reason',async t=>{
 const f=await fixture(t),messages=[];
 const first=f.worker();assert.equal(first.enqueue([leave]),true);
 await first.close();await f.reopen();
 const worker=f.worker({read:async()=>snapshot({请假状态:'已驳回',处理说明:''}),send:async message=>{messages.push(message);return {ok:true,transport:'smtp'};}});
 assert.equal(worker.pending(),1);await worker.drain();
 assert.equal(messages.length,1);assert.match(messages[0].text,/冻结的审批说明/);
 assert.equal(f.store.get(decisionOperationKey(leave)).item.requestAt,requestAt);
 assert.throws(()=>f.store.create({...leave,reason:'不能改写已提交原因'}),/conflict/);
});

test('explicit rejection reason is frozen at enqueue, across restart and later edits',async t=>{
 const f=await fixture(t),item={kind:'reject',id:'registration-1',reason:' 原始拒绝说明 '};
 const first=f.worker();assert.equal(first.enqueue([item]),true);await first.close();await f.reopen();
 const messages=[],worker=f.worker({read:async()=>snapshot({报名状态:'未入选',处理说明:'后来改写的说明'}),send:async message=>{messages.push(message);return {ok:true,transport:'smtp'};}});
 await worker.drain();assert.match(messages[0].text,/原始拒绝说明/);assert.doesNotMatch(messages[0].text,/后来改写/);
 assert.equal(decisionOperationKey(item),decisionOperationKey({kind:'reject',id:item.id}));
 assert.throws(()=>f.store.create({...item,reason:'不同拒绝说明'}),/conflict/);
});

test('leave approval sends; reversal and newer requests cancel old operations',async t=>{
 for(const overrides of [{请假状态:'已批准',报名状态:'已请假'},{请假状态:'已驳回'},{请假状态:'已批准',报名状态:'已请假',请假申请时间:'2026-10-18T02:00:00.000Z'}]){
  const f=await fixture(t),item={...leave,approved:true},messages=[];
  const worker=f.worker({read:async()=>snapshot(overrides),send:async message=>{messages.push(message);return {ok:true,transport:'smtp'};}});
  worker.enqueue([item]);await worker.drain();
  assert.equal(messages.length,overrides.请假状态==='已批准'&&overrides.请假申请时间===undefined?1:0);
 }
});

test('different leave request and decision identities remain separate',async t=>{
 const f=await fixture(t),next={...leave,requestAt:'2026-10-18T02:00:00.000Z'};
 const worker=f.worker({read:async()=>snapshot({请假状态:'已驳回',请假申请时间:next.requestAt})});
 worker.enqueue([leave,next]);const result=await worker.drain();
 assert.equal(result.skipped,1);assert.equal(result.sent,1);
 assert.notEqual(decisionOperationKey(leave),decisionOperationKey(next));
 assert.notEqual(decisionOperationKey(leave),decisionOperationKey({...leave,approved:true}));
});

test('explicit retryable SMTP failures are bounded and survive restart',async t=>{
 const f=await fixture(t);let clock=100,attempts=0;
 const options={now:()=>clock,send:async()=>{attempts++;return {ok:false,transport:'smtp',retryable:true};}};
 const worker=f.worker(options);const item={kind:'confirm',id:'registration-1'};
 worker.enqueue([item]);await worker.drain();assert.equal(attempts,1);
 await worker.drain();assert.equal(attempts,1);await worker.close();await f.reopen();
 const restarted=f.worker(options);
 clock+=10;await restarted.drain();clock+=10;await restarted.drain();clock+=100;await restarted.drain();
 assert.equal(attempts,3);assert.equal(restarted.info().states.failed,1);assert.equal(restarted.enqueue([item]),false);
});

test('success on explicitly safe retry uses the same frozen message',async t=>{
 const f=await fixture(t),messages=[];let clock=100,data=snapshot({请假状态:'已驳回'});
 const worker=f.worker({now:()=>clock,read:async()=>data,send:async message=>{messages.push(message);return messages.length===1?{ok:false,retryable:true}:{ok:true,transport:'smtp'};}});
 worker.enqueue([leave]);await worker.drain();data=snapshot({请假状态:'已驳回',处理说明:''});clock+=10;
 await worker.drain();assert.equal(messages.length,2);assert.deepEqual(messages[0],messages[1]);assert.equal(worker.info().states.sent,1);
});

test('exceptions, ambiguous transports and non-retryable failures never resend',async t=>{
 for(const outcome of [undefined,{ok:true,transport:'unverified'},{ok:false,retryable:false},{ok:false},'throw']){
  const f=await fixture(t);let sends=0,clock=100;
  const worker=f.worker({now:()=>clock,send:async()=>{sends++;if(outcome==='throw')throw Error('synthetic uncertain SMTP');return outcome;}});
  worker.enqueue([{kind:'confirm',id:'registration-1'}]);await worker.drain();clock+=100;await worker.drain();
  assert.equal(sends,1);assert.equal(worker.info().states.unknown,1);
  await worker.close();await f.reopen();const restart=f.worker({send:async()=>{sends++;return {ok:true,transport:'smtp'};}});
  await restart.drain();assert.equal(sends,1);
 }
});

test('persist sending before SMTP and recover interrupted sending as unknown',async t=>{
 const f=await fixture(t),item={kind:'confirm',id:'registration-1'},entry=f.store.create(item);
 const message=decisionMessage(snapshot(),item);
 f.store.transition(entry.key,'pending','sending',{message});await f.reopen();
 assert.equal(f.store.get(entry.key).state,'unknown');let sends=0;
 const worker=f.worker({send:async()=>{sends++;return {ok:true,transport:'smtp'};}});await worker.drain();assert.equal(sends,0);
 const other={kind:'reject',id:'registration-2'};
 const data=snapshot();data.registrations.push({...data.registrations[0],_id:other.id,报名ID:'WF-SYNTHETIC-2',报名状态:'未入选'});
 const sender=f.worker({read:async()=>data,send:async()=>{assert.equal(f.store.get(decisionOperationKey(other)).state,'sending');return {ok:true,transport:'smtp'};}});
 sender.enqueue([other]);await sender.drain();assert.equal(f.store.get(decisionOperationKey(other)).attempts,1);
});

test('failed or incomplete snapshots preserve operations without consuming SMTP retries',async t=>{
 const f=await fixture(t);let clock=100,reads=0,sends=0;
 const worker=f.worker({now:()=>clock,read:async()=>{reads++;if(reads===1)throw Error('synthetic read failure');const data=snapshot();if(reads===2)data.registrations.readMeta={truncated:true};return data;},send:async()=>{sends++;return {ok:true,transport:'smtp'};}});
 const item={kind:'confirm',id:'registration-1'};worker.enqueue([item]);await worker.drain();
 assert.equal(worker.pending(),1);clock+=10;await worker.drain();assert.equal(worker.pending(),1);
 assert.equal(f.store.get(decisionOperationKey(item)).attempts,0);clock+=10;await worker.drain();assert.equal(sends,1);
});

test('reads a fresh complete snapshot for every batch operation',async t=>{
 const f=await fixture(t);let reads=0,sends=0;
 const data=snapshot();data.registrations.push({...data.registrations[0],_id:'registration-2',报名ID:'WF-SYNTHETIC-2'});
 const worker=f.worker({read:async()=>{reads++;return data;},send:async()=>{sends++;data.registrations.forEach(row=>{row.报名状态='未入选';});return {ok:true,transport:'smtp'};}});
 worker.enqueue([{kind:'confirm',id:'registration-1'},{kind:'confirm',id:'registration-2'}]);await worker.drain();assert.equal(reads,2);assert.equal(sends,1);
});

test('reviewed rosters, unsynchronized sources, pending leave and invalid addresses cannot send',async t=>{
 for(const [overrides,config] of [[{}, {rosterReview:{phase:'draft'}}],[{岗位同步状态:'待同步'},{source:{kind:'generated_blood'}}],[{请假状态:'待审批'},{}],[{邮箱:'someone@example.org'},{}]]){
  const f=await fixture(t);let sends=0;
  const worker=f.worker({read:async()=>snapshot(overrides,config),send:async()=>{sends++;return {ok:true,transport:'smtp'};}});
  worker.enqueue([{kind:'confirm',id:'registration-1'}]);await worker.drain();assert.equal(sends,0);
 }
});

test('recipient changes after a safe failure block retransmission',async t=>{
 const f=await fixture(t);let data=snapshot(),clock=100,sends=0;
 const worker=f.worker({now:()=>clock,read:async()=>data,send:async()=>{sends++;return {ok:false,retryable:true};}});
 worker.enqueue([{kind:'confirm',id:'registration-1'}]);await worker.drain();clock+=10;data=snapshot({学号:'987654321',邮箱:'987654321@smail.nju.edu.cn'});
 await worker.drain();assert.equal(sends,1);assert.equal(worker.info().states.unknown,1);
});

test('private file encrypts JSON payloads and rejects short/wrong secrets',async t=>{
 const f=await fixture(t);f.store.create(leave);
 if(process.platform!=='win32')assert.equal((await stat(f.file)).mode&0o777,0o600);
 await assert.rejects(openDecisionMailStore(join(f.file,'unused'),{secret:'short'}),/at least 32/);
 await f.reopen();const bytes=await readFile(f.file);
 assert.equal(bytes.includes(Buffer.from('冻结的审批说明')),false);assert.equal(bytes.includes(Buffer.from('registration-1')),false);
 await assert.rejects(openDecisionMailStore(f.file,{secret:'incorrect-synthetic-secret-32-plus'}));
 assert.deepEqual(f.store.get(decisionOperationKey(leave)).item,leave);
});

test('invalid leave identities and unaccepted queue entries are not persisted',async t=>{
 const f=await fixture(t),worker=f.worker();
 assert.equal(worker.enqueue([{kind:'leave',id:leave.id},{...leave,requestAt:'invalid'},{...leave,reason:''},{...leave,approved:'true'},{kind:'wrong',id:'x'},null]),false);
 assert.deepEqual(f.store.info(),{});
 await worker.close();assert.equal(worker.enqueue([leave]),false);
});

test('startup recovery and retry timer use the provided background scheduler',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let clock=1000;
 const f=await fixture(t);f.store.create({kind:'confirm',id:'registration-1'});const scheduled=[];
 const worker=f.worker({schedule:task=>scheduled.push(task)});
 assert.equal(scheduled.length,1);scheduled.shift()();await worker.drain();assert.equal(worker.info().states.sent,1);
 let sends=0;
 const next=f.worker({now:()=>clock,read:async()=>snapshot({报名状态:'未入选'}),send:async()=>{sends++;return sends===1?{ok:false,retryable:true}:{ok:true,transport:'smtp'};},schedule:task=>scheduled.push(task)});
 next.enqueue([{kind:'reject',id:'registration-1'}]);scheduled.shift()();await next.drain();
 assert.equal(next.info().timerActive,true);
 clock+=11;t.mock.timers.tick(11);assert.equal(scheduled.length,1);scheduled.shift()();await next.drain();assert.equal(sends,2);
});
