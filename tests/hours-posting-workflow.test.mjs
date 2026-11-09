import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,WORKFLOW_SCHEMA} from '../lib/events/workflow.js';
import {createHoursPostingStore} from '../lib/events/hours-posting-store.js';
import {HOURS_POSTING_TABLES as T} from '../lib/events/hours-posting.js';
import {createRegistrationWriter} from '../lib/events/registration-schema.js';

function fixture({archive=false,production=false,onTrainingQualified=null}={}){
 const tables=Object.fromEntries([...Object.values(WF),T.legacy,T.profile].map(name=>[name,[]])),store=createHoursPostingStore();let sequence=0;
 const metadata={tables:[...WORKFLOW_SCHEMA.map(t=>({name:t.name,columns:t.columns.map(name=>({name,type:'text'}))})),{name:T.legacy,columns:[{name:'活动ID',type:'text'}]},...(production?[]:[{name:T.profile,columns:[]}])]};
 const base={getMetadata:async()=>structuredClone(metadata),listRows:async(table,_v,_o,_c,start=0,limit=500)=>structuredClone((tables[table]||[]).slice(start,start+limit)),appendRow:async(table,row)=>{const saved={...row,_id:`new-${++sequence}`};tables[table].push(saved);return saved;},updateRow:async(table,id,patch)=>{const row=tables[table].find(row=>row._id===id);assert.ok(row);Object.assign(row,patch);},addColumnOptions:async()=>{throw Error('Schema/settings must not change');}};
 const row={id:'r',name:'合成甲',studentId:'000001',serviceHours:3,trainingHours:1,travelHours:1,decision:'pass',dates:'2026-10-31 上午'};
 tables[WF.events].push({_id:'p',活动ID:'event',活动名称:'合成献血周',状态:'已结束',报名页配置:JSON.stringify({workspaceSubmission:{origin:true},runningReview:{status:'submitted',sourceDigest:'source'},finalHours:{status:'exported',token:'archive-token',exportedBy:'chair',exportedAt:'2026-11-04T00:00:00Z',...(archive?{rows:[row]}:{})}})});
 tables[WF.registrations].push({_id:'r',活动ID:'event',账号ID:'member',姓名:'合成甲',学号:'000001',报名状态:'已确认',是否报名成功:'true',录入状态:'待录入'});
 if(!archive)tables[WF.ledger].push({_id:'l',报名行ID:'r',活动ID:'event',账号ID:'member',姓名:'合成甲',学号:'000001',幂等键:'FINAL:r',状态:'已批准',批准人:'chair',批准时间:'2026-11-04T00:00:00Z',来源摘要:'source',服务时长:'3',培训时长:'1',交通时长:'1',备注:JSON.stringify({v:2,d:'pass',e:false})});
 const workflow=createWorkflow(base,{mode:production?'production':'test',onTrainingQualified,hoursPostingStore:store,now:()=>Date.parse('2026-11-04T01:00:00Z')});return {tables,base,store,workflow};
}
for(const archive of [false,true])test(`workflow posts ${archive?'legacy config archive':'FINAL ledger'} without online checkin or schema changes`,async()=>{
 const f=fixture({archive});const result=await f.workflow.synchronizeHours();assert.deepEqual(result.failures,[]);
 assert.equal(f.tables[T.legacy][0]['志愿时长'],3);assert.equal(f.tables[WF.summaries][0]['服务时长'],'3');assert.equal(f.tables[WF.registrations][0]['志愿时长'],'5');assert.equal(f.tables[WF.registrations][0]['录入状态'],'网站已入账');assert.equal(f.tables[WF.checkins].length,0);
 const data=await f.workflow.memberRead();assert.equal(f.workflow.hoursProgress(data.registrations[0],data.ledger,data.events).code,'summary_done');
 assert.ok(f.workflow.memberHoursSync(data.registrations).lastRunAt,'last sync time comes from the posting run');
 await f.workflow.synchronizeHours({manual:true});assert.equal(f.tables[T.profile].length,0);assert.equal(f.workflow.hoursProgress(data.registrations[0],data.ledger,data.events).code,'summary_done');
 assert.equal(f.workflow.memberHoursSync(data.registrations).mode,'table_automation');assert.equal(f.workflow.memberHoursSync([{...data.registrations[0],账号ID:'foreign'}]).mode,'table_automation');
 await f.workflow.synchronizeHours({manual:true});assert.equal(f.tables[T.legacy][0]['志愿时长'],3);f.store.close();
});
test('background posting refuses to add a missing option to the existing registration settings',async()=>{
 let settingsWrites=0;const writer=createRegistrationWriter({getMetadata:async()=>({tables:[{name:WF.registrations,columns:[{name:'录入状态',type:'single-select',data:{options:[{name:'待录入'}]}}]}]}),addColumnOptions:async()=>{settingsWrites++;}},{allowSchemaChanges:false});
 await assert.rejects(writer.encode({录入状态:'网站已入账'}),{code:'registration_schema_conflict'});assert.equal(settingsWrites,0);
});

test('editing a finalized ledger in the bottom table requires a trusted revision before changing both summaries',async()=>{
 const f=fixture();await f.workflow.synchronizeHours({manual:true});f.tables[WF.ledger][0]['服务时长']='5';
 await f.workflow.synchronizeHours();assert.equal(f.tables[T.legacy][0]['志愿时长'],3);
 const check=await f.workflow.hoursRevision('FINAL:r');assert.equal(check.delta,2);
 await f.workflow.hoursRevision('FINAL:r',{token:check.token,reason:'超管核对实际服务五小时'},'super');
 const waiting=await f.workflow.memberRead();assert.equal(f.workflow.hoursProgress(waiting.registrations[0],waiting.ledger,waiting.events).code,'revision_pending');
 await f.workflow.synchronizeHours();assert.equal(f.tables[T.legacy][0]['志愿时长'],5);assert.equal(f.tables[T.profile].length,0);assert.equal(f.tables[WF.registrations][0]['志愿时长'],'7');assert.equal(f.tables[WF.ledger][0]['修订人'],'super');
 f.store.close();
});

test('production posting does not require the personal-profile year column or metadata',async()=>{
 const f=fixture({production:true});const result=await f.workflow.synchronizeHours({manual:true});
 assert.deepEqual(result.failures,[]);assert.equal(f.tables[T.legacy][0]['志愿时长'],3);assert.equal(f.tables[WF.summaries][0]['服务时长'],'3');assert.equal(f.tables[T.profile].length,0);assert.equal(f.tables[WF.profiles].length,0);f.store.close();
});


test('final One Plus qualification updates retry independently without duplicating hour posting',async t=>{
 let calls=0,offline=true;const f=fixture({onTrainingQualified:async source=>{calls++;assert.equal(source.key,'FINAL:r');if(offline)throw Error('offline');return {status:'updated'};}});t.after(()=>f.store.close());
 f.tables[WF.events][0].活动名称='一加·急救培训';
 let result=await f.workflow.synchronizeHours();assert.equal(result.failures[0].step,'qualification');assert.equal(f.tables[T.legacy][0].志愿时长,3);assert.equal(f.store.get('qualification','FINAL:r'),null);
 offline=false;result=await f.workflow.synchronizeHours();assert.deepEqual(result.failures,[]);assert.equal(f.store.get('qualification','FINAL:r').status,'updated');assert.equal(calls,2);
 await f.workflow.synchronizeHours();assert.equal(calls,2);assert.equal(f.tables[T.legacy][0].志愿时长,3);assert.equal(f.tables[WF.profiles].length,0);
});

test('unapproved final records never trigger training qualification changes',async t=>{
 let calls=0;const f=fixture({onTrainingQualified:async()=>{calls++;return {status:'updated'};}});t.after(()=>f.store.close());f.tables[WF.events][0].活动名称='一加·急救培训';f.tables[WF.ledger][0].状态='待审核';
 await f.workflow.synchronizeHours();assert.equal(calls,0);
});

test('workspace admission posts only selected same-name shifts and releases the mutation queue', {timeout:2000}, async t=>{
 const f=fixture();
 t.after(()=>f.store.close());
 const first=f.tables[WF.registrations][0],line=f.tables[WF.ledger][0];
 f.tables[WF.registrations].push({...first,_id:'second'});
 f.tables[WF.ledger].push({...line,_id:'second-ledger',报名行ID:'second',幂等键:'FINAL:second',服务时长:'2'});
 f.tables[T.legacy].push({_id:'manual',姓名:first.姓名,学号:first.学号,活动名称:'合成献血周',志愿时长:2});
 await f.workflow.synchronizeHours();
 assert.equal(f.store.get('receipt','FINAL:r').legacyStatus,'failed');
 assert.equal(f.store.get('receipt','FINAL:second').legacyStatus,'failed');
 await assert.rejects(f.workflow.admitHoursPosting('another-event',['FINAL:r'],'合成核对通过'),{statusCode:409});
 assert.deepEqual(await f.workflow.admitHoursPosting('p',['FINAL:r'],'合成核对通过'),{posted:1,total:1,message:''});
 assert.equal(f.tables[T.legacy][0].志愿时长,5);
 assert.equal(f.tables[WF.summaries][0].服务时长,'3');
 assert.equal(f.store.get('receipt','FINAL:second').legacyStatus,'failed');
 await f.workflow.synchronizeHours();
 assert.equal(f.tables[T.legacy][0].志愿时长,5);
 assert.equal(f.store.get('receipt','FINAL:r').legacyStatus,'done');
 await f.workflow.skipHoursPosting('p',['FINAL:second']);
 await f.workflow.synchronizeHours();
 assert.equal(f.tables[T.legacy][0].志愿时长,5);
 assert.equal(f.tables[WF.summaries][0].服务时长,'5');
 assert.equal(f.tables[WF.registrations][1].录入状态,'网站已入账');
});
