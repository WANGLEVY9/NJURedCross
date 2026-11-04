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
 const base={listRows:async(table,_v,_o,_c,start,limit)=>{assert.ok(![T.profile,T.websiteProfile].includes(table),'Posting must not access personal-profile tables');return structuredClone(tables[table].slice(start,start+limit));},
  appendRow:async(table,patch)=>{const row={...patch,_id:`new-${++sequence}`};tables[table].push(row);if(fail===table){fail=null;throw Error('lost response');}return row;},
  updateRow:async(table,id,patch)=>{Object.assign(tables[table].find(r=>r._id===id),patch);if(fail===table){fail=null;throw Error('lost response');}}};
 const service=()=>createHoursPosting({base,store,now:()=>clock});
 return {tables,store,service:service(),restart:service,fail:table=>{fail=table;},clock:value=>{clock=Date.parse(value);}};
}
test('automatic, manual and restart runs only write the two summaries and preserve profile history',async()=>{
 const f=fixture(),s=source(),before=structuredClone(f.tables[T.profile]);
 // Existing uncertain personal-profile intents belong to the former writer.
 // They must never be replayed after the automation handover.
 f.store.set('intent',`profile:${s.personKey}`,{status:'pending',after:{'志愿时长（26-27）':99}});
 for(const manual of [false,true]){
  await f.service.run([s],{manual});f.clock('2026-11-08T22:00:00Z');await f.restart().run([s],{manual});
 }
 assert.equal(f.tables[T.legacy][0]['志愿时长'],13);
 assert.equal(f.tables[T.website][0]['服务时长'],'3');assert.equal(f.tables[T.website][0]['培训时长'],'1');assert.equal(f.tables[T.website][0]['交通时长'],'1');
 assert.deepEqual(f.tables[T.profile],before);assert.deepEqual(f.tables[T.websiteProfile],[]);
 assert.equal(f.service.status().profileSyncMode,'table_automation');
 await assert.rejects(f.service.acceptYearBase(s,{},'super'),/NJUTable/);assert.deepEqual(f.tables[T.profile],before);f.store.close();
});

test('lost summary responses recover after restart without double credit or profile writes',async()=>{
 for(const table of [T.legacy,T.website]){
  const f=fixture(),s=source();f.fail(table);await f.service.run([s],{manual:true});
  await f.restart().run([s],{manual:true});assert.equal(f.tables[T.legacy][0]['志愿时长'],13);assert.equal(f.tables[T.website].length,1);assert.equal(f.tables[T.websiteProfile].length,0);assert.equal(f.service.receipt(s).websiteStatus,'done');f.store.close();
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
 assert.equal(f.tables[T.legacy][0]['志愿时长'],16);assert.equal(f.tables[T.website].length,1);assert.equal(f.tables[T.website][0]['账号ID'],'member');assert.equal(f.tables[T.websiteProfile].length,0);f.store.close();
});

test('summary refresh leaves external legacy additions and profile history unchanged',async()=>{
 const f=fixture(),s=source();await f.service.run([s],{manual:true});f.tables[T.legacy][0]['志愿时长']=22;
 await f.service.run([s]);assert.equal(f.tables[T.profile][0]['志愿时长'],10);
 f.clock('2026-11-08T22:00:00Z');await f.service.run([s]);assert.equal(f.tables[T.profile][0]['志愿时长'],10);
 f.tables[T.legacy][0]['志愿时长']=24;await f.service.run([s],{manual:true});assert.equal(f.tables[T.profile][0]['志愿时长'],10);assert.equal(f.tables[T.profile][0]['志愿时长（25-26）'],20);f.store.close();
});

test('bottom-table corrections wait for a super-confirmed delta and keep external history',async()=>{
 const f=fixture(),old=source(),changed=source({version:'changed',serviceHours:5,totalHours:7});await f.service.run([old],{manual:true});
 const paused=await f.service.run([changed]);assert.equal(paused.failures[0].step,'revision');assert.equal(f.tables[T.legacy][0]['志愿时长'],13);
 const preview=await f.service.previewRevision(changed);assert.equal(preview.delta,2);
 await assert.rejects(f.service.acceptRevision(changed,{token:preview.token,reason:''},'super'),/原因/);
 await f.service.acceptRevision(changed,{token:preview.token,reason:'核对纸质名单更正服务时长'},'super');
 await f.service.run([changed]);assert.equal(f.tables[T.legacy][0]['志愿时长'],15);assert.equal(f.tables[T.profile][0]['志愿时长（26-27）'],undefined);assert.equal(f.tables[T.website][0]['服务时长'],'5');assert.equal(f.service.status().revisions[0].actor,'super');
 await f.service.run([changed]);assert.equal(f.tables[T.legacy][0]['志愿时长'],15);f.store.close();
});

test('confirmed corrections can subtract or zero a prior contribution without deleting history',async()=>{
 const f=fixture(),old=source(),zero=source({version:'zero',serviceHours:0,trainingHours:0,travelHours:0,totalHours:0});await f.service.run([old],{manual:true});
 const check=await f.service.previewRevision(zero);assert.equal(check.delta,-3);await f.service.acceptRevision(zero,{token:check.token,reason:'超管核对确认本记录应为零'},'super');await f.service.run([zero]);
 assert.equal(f.tables[T.legacy][0]['志愿时长'],10);assert.equal(f.tables[T.profile][0]['志愿时长（26-27）'],undefined);assert.equal(f.tables[T.profile][0]['志愿时长（25-26）'],20);f.store.close();
});

test('correction snapshots reject changed targets and identity overrides',async()=>{
 const f=fixture(),old=source(),changed=source({version:'new',serviceHours:5,totalHours:7});await f.service.run([old],{manual:true});const check=await f.service.previewRevision(changed);
 f.tables[T.legacy][0]['志愿时长']=14;await assert.rejects(f.service.acceptRevision(changed,{token:check.token,reason:'过期核对'},'super'),/变化/);
 await assert.rejects(f.service.previewRevision({...changed,accountId:'foreign'}),/改变/);assert.equal(f.service.status().revisions.length,0);f.store.close();
});

test('a lost correction acknowledgement resumes after restart without adding the delta twice',async()=>{
 const f=fixture(),old=source(),changed=source({version:'new',serviceHours:5,totalHours:7});await f.service.run([old],{manual:true});const check=await f.service.previewRevision(changed);await f.service.acceptRevision(changed,{token:check.token,reason:'超管已核对'},'super');
 f.fail(T.legacy);await f.service.run([changed]);assert.equal(f.tables[T.legacy][0]['志愿时长'],15);await f.restart().run([changed]);assert.equal(f.tables[T.legacy][0]['志愿时长'],15);assert.equal(f.tables[T.profile][0]['志愿时长（26-27）'],undefined);f.store.close();
});

test('a provable old three-component credit requires confirmation before adopting service-only accounting',async()=>{
 const f=fixture(),s=source();await f.service.run([s],{manual:true});
 const receipt=f.store.get('receipt',s.key);delete receipt.legacyCreditHours;f.store.set('receipt',s.key,receipt);
 const intent=f.store.get('intent',`legacy:${s.personKey}`);intent.after['志愿时长']=15;f.store.set('intent',`legacy:${s.personKey}`,intent);f.tables[T.legacy][0]['志愿时长']=15;
 const check=await f.service.previewRevision(s);assert.equal(check.previousCreditedHours,5);assert.equal(check.delta,-2);
 await f.service.acceptRevision(s,{token:check.token,reason:'按最新服务时长口径核对修订'},'super');await f.service.run([s]);assert.equal(f.tables[T.legacy][0]['志愿时长'],13);f.store.close();
});
