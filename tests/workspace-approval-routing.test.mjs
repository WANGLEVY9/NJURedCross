import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {createWorkflow,WF,workflowEventApproved} from '../lib/events/workflow.js';
import {projectWorkflowEvents} from '../lib/events/public-workflow.js';
const row=(accountId,region,extra={})=>({accountId,region,role:'presidium',active:true,categories:[],name:'主席团',...extra});
function fixture(){let roster={complete:true,rows:[row('nj','nanjing'),row('sz','suzhou')]};const routing=createWorkspaceApprovalRouting({getRoster:async()=>structuredClone(roster),now:()=>0});const event={活动地区:'苏州地区',组织类别:'生命中心',申请版本:'1',状态:'待审核',报名页配置:JSON.stringify({region:'苏州活动',center:'生命中心'})};return {routing,event,setRoster:value=>{roster=value;}};}
async function submitted(f){const approval=await f.routing.assign(f.event);return {...f.event,报名页配置:JSON.stringify({...JSON.parse(f.event['报名页配置']),approval})};}
test('same organization names route Suzhou only to Suzhou and Nanjing only to Nanjing',async()=>{
 const f=fixture(),event=await submitted(f);assert.deepEqual(JSON.parse(event['报名页配置']).approval.reviewerIds,['sz']);
 assert.equal((await f.routing.assertReviewer(event,'sz')).canSelfReview,true);
 await assert.rejects(f.routing.assertReviewer(event,'nj'),{statusCode:403});
 const nj={...f.event,活动地区:'南京地区',报名页配置:JSON.stringify({region:'南京活动',center:'生命中心'})};assert.deepEqual((await f.routing.assign(nj)).reviewerIds,['nj']);
});
test('missing, contradictory or region-ineligible event evidence never assigns reviewers',async()=>{
 const f=fixture();for(const event of [{...f.event,活动地区:'南京地区'},{...f.event,活动地区:'',报名页配置:'{}'},{...f.event,组织类别:'献血车专项'},{...f.event,组织类别:'博爱中心'}])await assert.rejects(f.routing.assign(event),{statusCode:409});
});
test('incomplete, duplicated, disabled and global role-only accounts cannot authorize review',async()=>{
 const f=fixture(),event=await submitted(f);
 for(const roster of [{complete:false,rows:[row('sz','suzhou')]},{complete:true,rows:[row('sz','suzhou'),row('sz','suzhou')]},{complete:true,rows:[row('sz','suzhou',{active:false})]},{complete:true,rows:[row('sz','suzhou',{role:'super_admin'})]}]){
  f.setRoster(roster);await assert.rejects(f.routing.assertReviewer(event,'sz'));await assert.rejects(f.routing.assign(f.event));
 }
});
test('fresh roster revocation applies immediately and new chairs do not silently inherit old tasks',async()=>{
 const f=fixture(),event=await submitted(f);f.setRoster({complete:true,rows:[row('replacement','suzhou')]});
 await assert.rejects(f.routing.assertReviewer(event,'sz'),{statusCode:403});await assert.rejects(f.routing.assertReviewer(event,'replacement'),{statusCode:403});
 assert.deepEqual((await f.routing.assign(f.event)).reviewerIds,['replacement']);
 await assert.rejects(f.routing.assertReviewer({...event,申请版本:'2'},'replacement'));
});
test('view capabilities agree with mutation authorization and approved items cannot be reviewed again',async()=>{
 const f=fixture(),event=await submitted(f);assert.equal((await f.routing.describe([event],'nj'))[0].approvalAccess.canReview,false);
 assert.equal((await f.routing.describe([event],'sz'))[0].approvalAccess.canReview,true);
 assert.equal((await f.routing.describe([{...event,状态:'可发布'}],'sz'))[0].approvalAccess.canReview,false);
 await assert.rejects(f.routing.assertReviewer({...event,状态:'可发布'},'sz'),{statusCode:409});
});

test('real workflow keeps regional approval separate from release and preserves return/resubmit',async()=>{
 const f=fixture(),tables=Object.fromEntries(Object.values(WF).map(table=>[table,[]]));let seq=0;
 const base={getMetadata:async()=>({tables:Object.keys(tables).map(name=>({name}))}),listRows:async(table,_v,_o,_c,start=0,count=500)=>structuredClone(tables[table].slice(start,start+count)),appendRow:async(table,data)=>{const saved={...data,_id:`synthetic-region-${++seq}`};tables[table].push(saved);return {_id:saved._id};},updateRow:async(table,id,patch)=>Object.assign(tables[table].find(row=>row._id===id),patch)};
 const workflow=createWorkflow(base,{approvalRouting:f.routing});
 const created=await workflow.create({name:'合成苏州活动',region:'苏州活动',center:'生命中心',date:'2030-10-15',slot:'09:15-11:45',window:{start:'2030-10-15T09:15',end:'2030-10-15T11:45'},capacity:4,serviceHours:2.5,trainingHours:0,travelHours:0,location:'合成场地',work:'合成工作'},'owner');
 const current=()=>tables[WF.events][0];
 await assert.rejects(workflow.approve(created._id,'nj','super_admin'),{statusCode:403});
 await workflow.returnApproval(created._id,'sz','platform_admin','补全合成通知');assert.equal(current()['状态'],'草稿');
 await workflow.submit(created._id);assert.equal(current()['状态'],'待审核');
 await workflow.approve(created._id,'sz','platform_admin');assert.equal(current()['状态'],'可发布');assert.equal(workflowEventApproved(current()),true);
 assert.equal(projectWorkflowEvents((await workflow.publicRead()).events,[]).length,0);
 const approved=structuredClone(current());
 for(const actor of ['owner','nj',undefined]){await assert.rejects(workflow.publish(created._id,{actor}),{statusCode:403});await assert.rejects(workflow.schedulePublication(created._id,'2029-01-01T09:00:00+08:00',actor),{statusCode:403});await assert.rejects(workflow.schedulePublication(created._id,null,actor),{statusCode:403});assert.deepEqual(current(),approved);}
 assert.equal((await f.routing.describe([current()],'owner'))[0].approvalAccess.canPublish,false);assert.equal((await f.routing.describe([current()],'sz'))[0].approvalAccess.canPublish,true);
 await workflow.schedulePublication(created._id,'2029-10-01T08:00:00+08:00','sz');assert.equal(JSON.parse(current()['报名页配置']).publishAt,'2029-10-01T08:00:00+08:00');
 const scheduled=structuredClone(current());await assert.rejects(workflow.schedulePublication(created._id,null,'owner'),{statusCode:403});assert.deepEqual(current(),scheduled);
 await workflow.schedulePublication(created._id,null,'sz');assert.equal(current()['状态'],'可发布');
 f.setRoster({complete:true,rows:[row('sz','suzhou',{active:false})]});await assert.rejects(workflow.publish(created._id,{actor:'sz'}),{statusCode:403});assert.equal(current()['状态'],'可发布');
 f.setRoster({complete:true,rows:[row('sz','suzhou')]});
 await workflow.publish(created._id,{actor:'sz'});assert.equal(current()['状态'],'报名中');
});
