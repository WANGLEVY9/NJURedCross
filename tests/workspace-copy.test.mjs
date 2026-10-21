import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';
import {openWorkspaceDraftStore} from '../lib/events/workspace-draft-store.js';
import {createMutationQueue} from '../lib/events/safety.js';
const content={name:'合成岗位活动',region:'nanjing',category:'生命中心',bookingMode:'grouped',date:'2030-01-01',endDate:'2030-01-03',notice:'原手工通知',positions:[{id:'original-a',name:'引导',date:'2030-01-02',start:'09:15',end:'11:45',campus:'仙林',location:'合成地点',capacity:'4',serviceHours:'2.5',trainingHours:'0.5',travelHours:'0',work:'合成工作'},{id:'original-b',name:'登记',date:'2030-01-03',start:'14:05',end:'16:20',campus:'鼓楼',location:'另一地点',capacity:'3',serviceHours:'2',trainingHours:'0',travelHours:'1',work:'登记工作'}]};
async function fixture(t){const store=openWorkspaceDraftStore(':memory:');t.after(()=>store.close());const service=createWorkspaceDrafts({...store,queue:createMutationQueue(),authorize:async(row,actor)=>{if(row.ownerId!==actor)throw Object.assign(Error('forbidden'),{statusCode:403});}});const source=await service.create({requestId:'synthetic-source-key',content},'owner');return {store,service,source};}
test('copy keeps every position field with fresh identities, regenerates notice and clears all lifecycle state',async t=>{
 const f=await fixture(t);f.store.update(f.source.id,{version:2,stage:'已结束',preview:{digest:'old'},submission:{status:'complete',activityId:'old-business'},approval:{reviewer:'old'},registrations:['old'],ledger:['old']},1);const before=structuredClone(f.store.read()[0]);
 const copy=await f.service.copy(f.source.id,{requestId:'synthetic-copy-key',expectedVersion:2},'owner');
 assert.notEqual(copy.id,f.source.id);assert.equal(copy.stage,'草稿');assert.equal(copy.version,1);assert.equal(copy.content.positions.length,2);
 assert.deepEqual(copy.content.positions.map(({id,...row})=>row),f.source.content.positions.map(({id,...row})=>row));
 assert.equal(new Set([...copy.content.positions,...f.source.content.positions].map(p=>p.id)).size,4);
 assert.match(copy.content.notice,/2030-01-02 09:15-11:45/);assert.match(copy.content.notice,/登记/);assert.match(copy.content.notice,/（副本）/);
 const stored=f.store.read().find(row=>row.id===copy.id);for(const key of ['approval','registrations','ledger','submission'])assert.equal(stored[key],undefined);assert.equal(stored.preview,null);assert.deepEqual(f.store.read()[0],before);
 const updated=await f.service.save(copy.id,{expectedVersion:1,content:{...copy.content,positions:[{...copy.content.positions[0],name:'修改副本岗位'},copy.content.positions[1]]}},'owner');assert.match(updated.content.notice,/修改副本岗位/);assert.deepEqual(f.store.read()[0],before);
});
test('copy retry retains the same new activity and positions even when the source later changes',async t=>{
 const f=await fixture(t),body={requestId:'synthetic-copy-repeat',expectedVersion:1};const copy=await f.service.copy(f.source.id,body,'owner');
 await f.service.save(f.source.id,{expectedVersion:1,content:{...f.source.content,name:'原活动新版本'}},'owner');assert.deepEqual(await f.service.copy(f.source.id,body,'owner'),copy);assert.equal(f.store.read().length,2);
 await assert.rejects(f.service.copy(f.source.id,{...body,expectedVersion:2},'owner'),{statusCode:409});
});
test('unauthorized actors and stale sources cannot create a copy',async t=>{
 const f=await fixture(t);await assert.rejects(f.service.copy(f.source.id,{requestId:'synthetic-other-copy',expectedVersion:1},'other'),{statusCode:403});
 await assert.rejects(f.service.copy(f.source.id,{requestId:'synthetic-stale-copy',expectedVersion:2},'owner'),{statusCode:409});assert.equal(f.store.read().length,1);
});
