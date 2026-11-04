import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,WORKFLOW_SCHEMA} from '../lib/events/workflow.js';
import {createHoursPostingStore} from '../lib/events/hours-posting-store.js';
import {HOURS_POSTING_TABLES as T} from '../lib/events/hours-posting.js';
import {createRegistrationWriter} from '../lib/events/registration-schema.js';

function fixture({archive=false}={}){
 const tables=Object.fromEntries([...Object.values(WF),T.legacy,T.profile].map(name=>[name,[]])),store=createHoursPostingStore();let sequence=0;
 const metadata={tables:[...WORKFLOW_SCHEMA.map(t=>({name:t.name,columns:t.columns.map(name=>({name,type:'text'}))})),{name:T.legacy,columns:[]},{name:T.profile,columns:[]}]};
 const base={getMetadata:async()=>structuredClone(metadata),listRows:async(table,_v,_o,_c,start=0,limit=500)=>structuredClone((tables[table]||[]).slice(start,start+limit)),appendRow:async(table,row)=>{const saved={...row,_id:`new-${++sequence}`};tables[table].push(saved);return saved;},updateRow:async(table,id,patch)=>{const row=tables[table].find(row=>row._id===id);assert.ok(row);Object.assign(row,patch);},addColumnOptions:async()=>{throw Error('Schema/settings must not change');}};
 const row={id:'r',name:'合成甲',studentId:'000001',serviceHours:3,trainingHours:1,travelHours:1,decision:'pass',dates:'2030-01-01 上午'};
 tables[WF.events].push({_id:'p',活动ID:'event',活动名称:'合成献血周',状态:'已结束',报名页配置:JSON.stringify({workspaceSubmission:{origin:true},runningReview:{status:'submitted',sourceDigest:'source'},finalHours:{status:'exported',token:'archive-token',exportedBy:'chair',exportedAt:'2026-11-04T00:00:00Z',...(archive?{rows:[row]}:{})}})});
 tables[WF.registrations].push({_id:'r',活动ID:'event',账号ID:'member',姓名:'合成甲',学号:'000001',报名状态:'已确认',是否报名成功:'true',录入状态:'待录入'});
 if(!archive)tables[WF.ledger].push({_id:'l',报名行ID:'r',活动ID:'event',账号ID:'member',姓名:'合成甲',学号:'000001',幂等键:'FINAL:r',状态:'已批准',批准人:'chair',批准时间:'2026-11-04T00:00:00Z',来源摘要:'source',服务时长:'3',培训时长:'1',交通时长:'1',备注:JSON.stringify({v:2,d:'pass',e:false})});
 const workflow=createWorkflow(base,{hoursPostingStore:store,now:()=>Date.parse('2026-11-04T01:00:00Z')});return {tables,base,store,workflow};
}
for(const archive of [false,true])test(`workflow posts ${archive?'legacy config archive':'FINAL ledger'} without online checkin or schema changes`,async()=>{
 const f=fixture({archive});const result=await f.workflow.synchronizeHours();assert.deepEqual(result.failures,[]);
 assert.equal(f.tables[T.legacy][0]['志愿时长'],3);assert.equal(f.tables[WF.summaries][0]['服务时长'],'3');assert.equal(f.tables[WF.registrations][0]['志愿时长'],'5');assert.equal(f.tables[WF.registrations][0]['录入状态'],'网站已入账');assert.equal(f.tables[WF.checkins].length,0);
 const data=await f.workflow.memberRead();assert.equal(f.workflow.hoursProgress(data.registrations[0],data.ledger,data.events).code,'profile_pending');
 await f.workflow.synchronizeHours({manual:true});assert.equal(f.tables[T.profile][0]['志愿时长（26-27）'],3);assert.equal(f.workflow.hoursProgress(data.registrations[0],data.ledger,data.events).code,'synced');
 await f.workflow.synchronizeHours({manual:true});assert.equal(f.tables[T.legacy][0]['志愿时长'],3);f.store.close();
});
test('background posting refuses to add a missing option to the existing registration settings',async()=>{
 let settingsWrites=0;const writer=createRegistrationWriter({getMetadata:async()=>({tables:[{name:WF.registrations,columns:[{name:'录入状态',type:'single-select',data:{options:[{name:'待录入'}]}}]}]}),addColumnOptions:async()=>{settingsWrites++;}},{allowSchemaChanges:false});
 await assert.rejects(writer.encode({录入状态:'网站已入账'}),{code:'registration_schema_conflict'});assert.equal(settingsWrites,0);
});
