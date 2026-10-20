import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,workflowApprovalHash} from '../lib/events/workflow.js';
import {ORDINARY_GROUP_TABLE} from '../lib/events/ordinary-groups.js';
import {workspaceContentFromEvent} from '../lib/events/workspace-event-copy.js';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';
import {openWorkspaceDraftStore} from '../lib/events/workspace-draft-store.js';
import {createMutationQueue} from '../lib/events/safety.js';
async function fixture(t){
 let seq=0;const tables=Object.fromEntries([...Object.values(WF),ORDINARY_GROUP_TABLE].map(name=>[name,[]]));
 const base={getMetadata:async()=>({tables:[]}),listRows:async(name,_v,_o,_c,start=0,count=500)=>structuredClone(tables[name].slice(start,start+count)),appendRow:async(name,row)=>{const saved={...row,_id:`synthetic-event-${++seq}`};tables[name].push(saved);return {_id:saved._id};},updateRow:async(name,id,patch)=>Object.assign(tables[name].find(row=>row._id===id),patch)};
 const workflow=createWorkflow(base),parent=await workflow.create({name:'合成旧岗位活动',region:'苏州活动',center:'生命中心',bookingMode:'grouped',window:{start:'2030-01-01T08:00',end:'2030-01-03T18:00'},capacity:6,serviceHours:2,trainingHours:0,travelHours:0,location:'合成校区',work:'合成工作',submit:false},'owner');
 const positions=[{name:'引导岗',start:'2030-01-01T09:15',end:'2030-01-01T11:45',campus:'苏州',location:'合成地点甲',capacity:2,work:'引导工作',serviceHours:2.5,trainingHours:0.5,travelHours:0},{name:'登记岗',start:'2030-01-03T14:05',end:'2030-01-03T16:20',campus:'苏州',location:'合成地点乙',capacity:4,work:'登记工作',serviceHours:2,trainingHours:0,travelHours:1}];
 await workflow.configurePositions(parent._id,{token:workflowApprovalHash(tables[WF.events][0]),deadline:'2029-12-31T18:00',positions},'owner');
 const store=openWorkspaceDraftStore(':memory:');t.after(()=>store.close());
 const drafts=createWorkspaceDrafts({...store,queue:createMutationQueue(),getCopyEvent:async(id,actor)=>{if(actor!=='owner')throw Object.assign(Error('forbidden'),{statusCode:403});return structuredClone(tables[WF.events].find(row=>row._id===id));},authorize:async(row,actor)=>{if(row.ownerId!==actor)throw Object.assign(Error('forbidden'),{statusCode:403});}});
 return {tables,workflow,parent,positions,store,drafts,source:()=>tables[WF.events][0]};
}
for(const published of [false,true])test(`copies complete ${published?'published positionPlan':'pending positionDraft'} from the real legacy workflow`,async t=>{
 const f=await fixture(t);if(published){await f.workflow.submit(f.parent._id);await f.workflow.approve(f.parent._id,'chair','super_admin');await f.workflow.publish(f.parent._id);}
 const before=structuredClone(f.tables),body={requestId:'synthetic-legacy-copy',expectedVersion:String(f.source()['申请版本'])};
 const result=await f.drafts.copyEvent(f.parent._id,body,'owner');assert.equal(result.stage,'草稿');assert.equal(result.content.region,'suzhou');assert.equal(result.content.positions.length,2);assert.equal(result.content.date,'2030-01-01');assert.equal(result.content.endDate,'2030-01-03');
 assert.deepEqual(result.content.positions.map(p=>[p.name,p.date,p.start,p.end,p.serviceHours,p.trainingHours,p.travelHours]),[['引导岗','2030-01-01','09:15','11:45','2.5','0.5','0'],['登记岗','2030-01-03','14:05','16:20','2','0','1']]);
 assert.equal(result.content.responsibleId,'');assert.match(result.content.notice,/登记工作/);assert.deepEqual(f.tables,before);assert.deepEqual(await f.drafts.copyEvent(f.parent._id,body,'owner'),result);assert.equal(f.store.read().length,1);
});
test('missing, corrupt or unsupported position data cannot silently produce an empty-position draft',async t=>{
 const f=await fixture(t),original=JSON.parse(f.source()['报名页配置']);
 for(const config of ['{bad',JSON.stringify({...original,positionDraft:null}),JSON.stringify({...original,positionDraft:{positions:[{...original.positionDraft.positions[0],start:'2030-01-01T09:15:01'}]}})])assert.throws(()=>workspaceContentFromEvent({...f.source(),'报名页配置':config}),{statusCode:409});
 assert.equal(f.store.read().length,0);
});
test('fresh source authority and source version are required before any legacy copy write',async t=>{
 const f=await fixture(t);await assert.rejects(f.drafts.copyEvent(f.parent._id,{requestId:'synthetic-denied-copy',expectedVersion:'1'},'other'),{statusCode:403});
 await assert.rejects(f.drafts.copyEvent(f.parent._id,{requestId:'synthetic-stale-copy',expectedVersion:'99'},'owner'),{statusCode:409});assert.equal(f.store.read().length,0);
});
test('unified multi-day events retain exact dates, minutes and explicit hours without deriving duration',()=>{
 const event={'活动名称':'合成跨日统一活动','活动地区':'南京地区','组织类别':'生命中心','报名日期':'2030-01-01','容量':'20','服务时长':'3.5','培训时长':'0','交通时长':'1','地点':'合成地点','工作内容':'合成工作','报名页配置':JSON.stringify({region:'南京活动',center:'生命中心',bookingMode:'unified',window:{start:'2030-01-01T23:35',end:'2030-01-03T01:15'}})};
 const result=workspaceContentFromEvent(event);assert.equal(result.date,'2030-01-01');assert.equal(result.endDate,'2030-01-03');assert.equal(result.start,'23:35');assert.equal(result.end,'01:15');assert.equal(result.serviceHours,'3.5');assert.deepEqual(result.positions,[]);
 assert.throws(()=>workspaceContentFromEvent({...event,'报名页配置':JSON.stringify({ordinary:{groupId:'old-multi-session'}})}),{statusCode:409});
});
