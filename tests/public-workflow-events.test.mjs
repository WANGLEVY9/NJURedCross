import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicWorkflowEvents} from '../lib/events/public-workflow-events.js';
import {workflowApprovalHash} from '../lib/events/workflow.js';
test('published sessions expose a parent link alias but not private configuration',()=>{
 const parent={_id:'parent-row',活动ID:'parent',状态:'可发布'};
 const child={_id:'child',活动ID:'child-business',活动名称:'Synthetic',状态:'报名中',申请版本:'1',批准版本:'1',容量:'2',报名页配置:JSON.stringify({parentActivityId:'parent',coOwners:['private'],ordinary:{groupId:'group'}}),registrationControl:{published:true}};
 child['批准摘要']=workflowApprovalHash(child);
 const data={events:[parent,child],registrations:[{活动ID:'child-business',报名状态:'已确认'}]};
 const out=publicWorkflowEvents(data);
 assert.equal(out.length,1);assert.equal(out[0].parentEventId,'parent-row');assert.equal(out[0].remaining,1);
 assert.equal(JSON.stringify(out).includes('private'),false);
 child.registrationControl.published=false;assert.equal(publicWorkflowEvents(data).length,0);
 child.registrationControl.published=true;child['容量']='3';assert.equal(publicWorkflowEvents(data).length,0);
});
