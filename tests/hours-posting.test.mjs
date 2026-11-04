import test from 'node:test';
import assert from 'node:assert/strict';
import {createHoursPosting,HOURS_POSTING_TABLES as T} from '../lib/events/hours-posting.js';
import {createHoursPostingStore} from '../lib/events/hours-posting-store.js';
import {hoursPersonKey} from '../lib/events/hours-posting-source.js';

const source=(patch={})=>({key:'FINAL:r1',version:'v1',registrationId:'r1',ledgerId:'l1',personKey:hoursPersonKey('合成甲','000001'),name:'合成甲',studentId:'000001',accountId:'member',eventId:'evt-1',activityId:'event-1',activityName:'合成活动',dates:'2026-10-31',serviceHours:3,trainingHours:1,travelHours:1,totalHours:5,approvedAt:'2026-11-04T00:00:00Z',...patch});
function fixture(){
 const tables=Object.fromEntries(Object.values(T).map(name=>[name,[]])),store=createHoursPostingStore();let clock=Date.parse('2026-11-04T01:00:00Z'),fail=null,sequence=0;
 tables[T.legacy].push({_id:'old',姓名:'合成甲',学号:'000001',志愿时长:10,活动名称:'历史活动'});
 tables[T.profile].push({_id:'profile',姓名:'合成甲',学号:'000001',志愿时长:10,'志愿时长（25-26）':20,总志愿时长:30,其他字段:'保持'});
 const base={listRows:async(table,_v,_o,_c,start,limit)=>structuredClone(tables[table].slice(start,start+limit)),
  appendRow:async(table,patch)=>{const row={...patch,_id:`new-${++sequence}`};tables[table].push(row);if(fail===table){fail=null;throw Error('lost response');}return row;},
  updateRow:async(table,id,patch)=>{Object.assign(tables[table].find(r=>r._id===id),patch);if(fail===table){fail=null;throw Error('lost response');}}};
 const service=()=>createHoursPosting({base,store,now:()=>clock});
 return {tables,store,service:service(),restart:service,fail:table=>{fail=table;},clock:value=>{clock=Date.parse(value);}};
}
test('both summaries receive all three components immediately; Monday updates current profile only',async()=>{
 const f=fixture(),s=source();await f.service.run([s]);
 assert.equal(f.tables[T.legacy][0]['志愿时长'],13);assert.equal(f.tables[T.website][0]['服务时长'],'3');assert.equal(f.tables[T.website][0]['培训时长'],'1');assert.equal(f.tables[T.website][0]['交通时长'],'1');
 assert.equal(f.tables[T.profile][0]['志愿时长'],10);assert.equal(f.service.receipt(s).profileStatus,'pending');
 f.clock('2026-11-08T22:00:00Z');await f.service.run([s]);
 assert.equal(f.tables[T.profile][0]['志愿时长'],10);assert.equal(f.tables[T.profile][0]['志愿时长（25-26）'],20);assert.equal(f.tables[T.profile][0]['总志愿时长'],30);assert.equal(f.tables[T.profile][0]['志愿时长（26-27）'],3);assert.ok(String(f.tables[T.legacy][0]['活动ID']||'').length>0);assert.equal(f.tables[T.profile][0]['其他字段'],'保持');assert.equal(f.tables[T.websiteProfile][0]['志愿时长'],'5');assert.equal(f.service.receipt(s).profileStatus,'done');
 await f.service.run([s]);assert.equal(f.tables[T.legacy][0]['志愿时长'],13);f.store.close();
});
test('lost responses and process restarts recover absolute legacy and website writes without double credit',async()=>{
 for(const table of [T.legacy,T.website,T.profile,T.websiteProfile]){
  const f=fixture(),s=source();f.fail(table);await f.service.run([s],{manual:true});
  await f.restart().run([s],{manual:true});assert.equal(f.tables[T.legacy][0]['志愿时长'],13);assert.equal(f.tables[T.website].length,1);assert.equal(f.tables[T.profile][0]['志愿时长'],10);assert.equal(f.service.receipt(s).profileStatus,'done');f.store.close();
 }
});
test('new sources arriving during uncertain website writes are not incorrectly acknowledged or omitted',async()=>{
 const f=fixture(),s=source(),second=source({key:'FINAL:r2',version:'v2',registrationId:'r2',ledgerId:'l2'});f.fail(T.website);await f.service.run([s]);
 await f.restart().run([s,second]);assert.equal(f.tables[T.legacy][0]['志愿时长'],16);assert.equal(f.tables[T.website][0]['服务时长'],'6');assert.equal(f.service.receipt(second).websiteStatus,'done');f.store.close();
});
test('historic same-activity credit needs explicit snapshot-bound acknowledgement',async()=>{
 const f=fixture(),s=source();f.tables[T.legacy][0]['活动名称']='历史活动、合成活动';
 const result=await f.service.run([s]);assert.equal(result.failures.length,1);assert.equal(f.tables[T.legacy][0]['志愿时长'],10);assert.equal(f.tables[T.website].length,0);
 const snapshot=await f.service.existingCredit(s.key);await assert.rejects(f.service.existingCredit(s.key,{confirmed:true,token:'stale'}),/变化/);
 await f.service.existingCredit(s.key,{confirmed:true,token:snapshot.token});await f.service.run([s]);assert.equal(f.tables[T.legacy][0]['志愿时长'],10);assert.equal(f.tables[T.website].length,1);f.store.close();
});
test('a legacy change after an uncertain write stops retry instead of overwriting external increments',async()=>{
 const f=fixture(),s=source();f.fail(T.legacy);await f.service.run([s]);f.tables[T.legacy][0]['志愿时长']=18;
 const result=await f.restart().run([s]);assert.equal(result.failures.length,1);assert.equal(f.tables[T.legacy][0]['志愿时长'],18);assert.equal(f.tables[T.website].length,0);f.store.close();
});
test('weekly catchup excludes approvals after the cutoff, and manual synchronization can include them',async()=>{
 const f=fixture(),old=source({approvedAt:'2026-11-01T00:00:00Z'}),recent=source({key:'FINAL:r2',version:'v2',registrationId:'r2',activityName:'第二活动'});
 await f.service.run([old,recent]);assert.equal(f.tables[T.legacy][0]['志愿时长'],16);assert.equal(f.tables[T.profile][0]['志愿时长'],10);assert.equal(f.service.receipt(old).profileStatus,'done');assert.equal(f.service.receipt(recent).profileStatus,'pending');assert.equal(f.tables[T.websiteProfile][0]['志愿时长'],'5');assert.equal(f.tables[T.profile][0]['活动名称'],undefined);
 await f.service.run([old,recent],{manual:true});assert.equal(f.tables[T.profile][0]['志愿时长'],10);assert.equal(f.tables[T.websiteProfile][0]['志愿时长'],'10');f.store.close();
});
test('source changes and removals block the whole person instead of recomputing an incomplete total',async()=>{
 const f=fixture(),s=source(),second=source({key:'FINAL:r2',version:'v2',registrationId:'r2'});await f.service.run([s,second]);
 await f.service.run([s,{...second,version:'changed',totalHours:9}]);assert.equal(f.tables[T.legacy][0]['志愿时长'],16);assert.equal(f.tables[T.website][0]['服务时长'],'6');
 const result=await f.service.run([s]);assert.equal(result.failures.length,1);assert.equal(f.tables[T.website][0]['服务时长'],'6');f.store.close();
});
test('duplicate identities and concurrent process leases stop writes',async()=>{
 const f=fixture();f.tables[T.legacy].push({...f.tables[T.legacy][0],_id:'duplicate'});const result=await f.service.run([source()]);assert.equal(result.failures.length,1);assert.equal(f.tables[T.website].length,0);
 f.store.acquire('other-process',Date.now());await assert.rejects(f.restart().run([source()]),/其他进程/);f.store.release('other-process');f.store.close();
});

test('a later real account adopts only its matching synthetic manual mirror',async()=>{
 const f=fixture(),manual=source({accountId:'manual:000001'});await f.service.run([manual],{manual:true});
 const real=source({key:'FINAL:r2',version:'v2',registrationId:'r2',accountId:'member'});await f.service.run([manual,real],{manual:true});
 assert.equal(f.tables[T.legacy][0]['志愿时长'],16);assert.equal(f.tables[T.website].length,1);assert.equal(f.tables[T.website][0]['账号ID'],'member');assert.equal(f.tables[T.websiteProfile].length,1);assert.equal(f.tables[T.websiteProfile][0]['账号ID'],'member');f.store.close();
});

test('a new weekly window and explicit manual refresh copy external legacy additions without changing history',async()=>{
 const f=fixture(),s=source();await f.service.run([s],{manual:true});f.tables[T.legacy][0]['志愿时长']=22;
 await f.service.run([s]);assert.equal(f.tables[T.profile][0]['志愿时长'],10);
 f.clock('2026-11-08T22:00:00Z');await f.service.run([s]);assert.equal(f.tables[T.profile][0]['志愿时长'],10);
 f.tables[T.legacy][0]['志愿时长']=24;await f.service.run([s],{manual:true});assert.equal(f.tables[T.profile][0]['志愿时长'],10);assert.equal(f.tables[T.profile][0]['志愿时长（25-26）'],20);f.store.close();
});
