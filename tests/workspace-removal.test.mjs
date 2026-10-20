import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceRemoval} from '../lib/events/workspace-removal.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {createMutationQueue} from '../lib/events/safety.js';
import {workflowApprovalHash,workflowEventApproved} from '../lib/events/workflow.js';
function fixture(state='报名中',extra={}){
 const event={_id:'parent',活动ID:'project-code',状态:state,申请版本:'1',批准版本:'1',负责人账号ID:'director',活动地区:'苏州地区',组织类别:'生命中心',报名页配置:JSON.stringify({workspaceSubmission:{origin:true},region:'苏州活动',center:'生命中心',approval:{mode:'workspace-regional',region:'suzhou',category:'生命中心',version:'1'},...extra})};event['批准摘要']=workflowApprovalHash(event);
 const data={events:[event],registrations:[{_id:'r',活动ID:'project-code',报名状态:'已确认'}],checkins:[{_id:'c',活动ID:'project-code'}],ledger:[{_id:'l',活动ID:'project-code',服务时长:'2'}]};
 const roster={complete:true,rows:[{accountId:'director',region:'suzhou',role:'director',categories:['生命中心'],active:true},{accountId:'chair',region:'suzhou',role:'presidium',categories:[],active:true},{accountId:'nj-chair',region:'nanjing',role:'presidium',categories:[],active:true},{accountId:'other',region:'suzhou',role:'director',categories:['生命中心'],active:true}]};
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>structuredClone(roster)});let writes=0,lost=false;
 const service=createWorkspaceRemoval({read:async()=>structuredClone(data),write:createMutationQueue(),update:async(_t,_r,patch)=>{Object.assign(event,patch);writes++;if(lost){lost=false;throw Error('lost response');}},WF:{events:'events'},authorizeRead:routing.assertRegistrar,authorizeChair:routing.assertPublisher,now:()=>1000});
 return {service,data,event,roster,writes:()=>writes,lose:()=>{lost=true;}};
}
const body=state=>({token:state.token,requestId:'synthetic-remove-request',reason:'合成取消原因'});
test('regional owner can end published activity without destroying participation; lost response reconciles once',async()=>{
 const f=fixture(),state=await f.service.workspaceRemoval('parent','director'),before=structuredClone(f.data);assert.equal(state.action,'end');assert.equal(state.canRemove,true);
 f.lose();await assert.rejects(f.service.removeWorkspace('parent',body(state),'director'),/lost response/);assert.equal(f.event['状态'],'已归档');assert.equal(workflowEventApproved(f.event),true);
 assert.deepEqual(await f.service.removeWorkspace('parent',body(state),'director'),{id:'parent',removed:true,action:'end'});assert.equal(f.writes(),1);
 for(const key of ['registrations','checkins','ledger'])assert.deepEqual(f.data[key],before[key]);
 await assert.rejects(f.service.removeWorkspace('parent',{...body(state),reason:'不同原因'},'director'),{statusCode:409});
 f.roster.rows[0].active=false;await assert.rejects(f.service.removeWorkspace('parent',body(state),'director'),{statusCode:403});
});
test('pending, scheduled and submitted-hours removal is regional-chair-only; completed remains downloadable',async()=>{
 for(const [phase,extra] of [['待审核',{}],['可发布',{}],['报名中',{publishAt:'2030-01-01T00:00:00+08:00'}],['进行中',{runningReview:{status:'submitted'}}]]){
  const f=fixture(phase,extra),director=await f.service.workspaceRemoval('parent','director');assert.equal(director.canRemove,false);
  await assert.rejects(f.service.removeWorkspace('parent',body(director),'director'),{statusCode:403});
  for(const actor of ['nj-chair','other'])await assert.rejects(f.service.workspaceRemoval('parent',actor),{statusCode:403});
  const chair=await f.service.workspaceRemoval('parent','chair');assert.equal(chair.action,phase==='进行中'?'end':'delete');assert.equal(chair.canRemove,true);await f.service.removeWorkspace('parent',body(chair),'chair');
 }
 const complete=fixture('已结束',{finalHours:{status:'exported',fileBase64:'frozen'}}),state=await complete.service.workspaceRemoval('parent','chair');assert.equal(state.canRemove,false);await assert.rejects(complete.service.removeWorkspace('parent',body(state),'chair'),{statusCode:403});assert.equal(complete.writes(),0);
});
test('removal binds every project revision, rejects malformed or stale requests and excludes legacy and child rows',async()=>{
 for(const key of ['registrations','checkins','ledger']){const f=fixture(),state=await f.service.workspaceRemoval('parent','director');f.data[key][0].changed=true;await assert.rejects(f.service.removeWorkspace('parent',body(state),'director'),{statusCode:409});assert.equal(f.writes(),0);}
 const f=fixture(),state=await f.service.workspaceRemoval('parent','director');await assert.rejects(f.service.removeWorkspace('parent',{...body(state),actor:'chair'},'director'),{statusCode:400});
 f.event['报名页配置']='{}';await assert.rejects(f.service.workspaceRemoval('parent','director'),{statusCode:409});
 f.event['报名页配置']=JSON.stringify({workspaceSubmission:{origin:true},parentActivityId:'other'});await assert.rejects(f.service.workspaceRemoval('parent','director'),{statusCode:409});
});
