import test from 'node:test';
import assert from 'node:assert/strict';
import {flexibleCapacity,activityRegistrationLimit} from '../public/app/shared/activity-capacity.js';
import {normalizeWorkspaceDraft,workspaceDraftErrors,workspaceNotice} from '../public/app/shared/activity-workspace.js';
import {workspaceWorkflowInput} from '../lib/events/workspace-workflow-bridge.js';
import {workflowApprovalHash} from '../lib/events/workflow.js';
import {publicWorkflowEvents} from '../lib/events/public-workflow-events.js';
import {projectWorkflowEvents} from '../lib/events/public-workflow.js';
import {registrationCapacity} from '../public/app/shared/activity-registration.js';

const content=()=>({qqGroup:'123456789',name:'合成弹性名额活动',region:'nanjing',category:'生命中心',responsibleId:'owner',bookingMode:'unified',date:'2030-01-01',endDate:'2030-01-01',start:'09:00',end:'12:00',deadline:'2029-12-31T18:00',location:'合成地点',capacity:'20',serviceHours:'3',trainingHours:'0',travelHours:'0',work:'合成服务',notice:'合成通知'});

test('flexible capacity accepts disabled or 5–10 places and rejects invalid settings before saving',()=>{
 for(const value of [undefined,'',0,'0',5,'5',6,7,8,9,10,'10'])assert.equal(flexibleCapacity(value),Number(value||0));
 for(const value of [null,true,false,1,4,11,-5,5.5,'05','5.0','1e1',' 5 ',[],{},NaN])assert.throws(()=>flexibleCapacity(value),{statusCode:400});
 assert.throws(()=>normalizeWorkspaceDraft({...content(),flexibleCapacity:'4'}),{statusCode:400});
 const legacy=normalizeWorkspaceDraft(content());assert.equal(Object.hasOwn(legacy,'flexibleCapacity'),false);
 assert.deepEqual(normalizeWorkspaceDraft(legacy),legacy);
 const enabled=normalizeWorkspaceDraft({...content(),flexibleCapacity:'5'});assert.equal(enabled.capacity,'20');assert.equal(enabled.flexibleCapacity,'5');assert.deepEqual(workspaceDraftErrors(enabled),[]);
 assert.equal(workspaceNotice(enabled),workspaceNotice(legacy));
 const plan=workspaceWorkflowInput(enabled);assert.equal(plan.body.capacity,20);assert.equal(plan.body.flexibleCapacity,5);
});

test('each grouped position keeps its own demand and flexibility through the workflow contract',()=>{
 const d={...content(),bookingMode:'grouped',positions:[{id:'synthetic-a',name:'宣传岗',date:'2030-01-01',start:'09:00',end:'12:00',location:'合成地点',capacity:'20',flexibleCapacity:'5',serviceHours:'3',trainingHours:'0',travelHours:'0',work:'合成服务'},{id:'synthetic-b',name:'签到岗',date:'2030-01-01',start:'13:00',end:'16:00',location:'合成地点',capacity:'10',flexibleCapacity:'10',serviceHours:'3',trainingHours:'0',travelHours:'0',work:'合成服务'}]};
 const plan=workspaceWorkflowInput(d);assert.equal(plan.body.capacity,30);assert.equal(plan.body.registrationLimit,45);
 assert.deepEqual(plan.positions.map(p=>[p.capacity,p.flexibleCapacity]),[[20,5],[10,10]]);
 assert.throws(()=>normalizeWorkspaceDraft({...d,positions:[{...d.positions[0],flexibleCapacity:'11'}]}),{statusCode:400});
 assert(workspaceDraftErrors({...content(),capacity:'100000',flexibleCapacity:'5'}).some(error=>error.includes('报名上限超过限制')));
});

test('regional bookings widen only through explicit flexibility; legacy registration rules are retained',()=>{
 const event={容量:'20'};
 assert.equal(activityRegistrationLimit(event,{approval:{mode:'workspace-regional'},registrationLimit:30}),20);
 assert.equal(activityRegistrationLimit(event,{registrationLimit:30}),30);
 assert.equal(activityRegistrationLimit(event,{approval:{mode:'workspace-regional'},registrationLimit:25,flexibleCapacity:5}),25);
 assert.equal(activityRegistrationLimit(event,{approval:{mode:'workspace-regional'},flexibleCapacity:0}),20);
 assert.equal(activityRegistrationLimit({容量:'30'},{bookingMode:'grouped',positionPlan:{positions:[{capacity:20,flexibleCapacity:5},{capacity:10,flexibleCapacity:10}]}}),45);
});

test('public views keep demand visible and stay open until the flexible application limit',()=>{
 const event={_id:'synthetic-job',活动ID:'synthetic-job',活动名称:'合成宣传岗',岗位:'宣传岗',状态:'报名中',申请版本:'1',批准版本:'1',容量:'20',报名页配置:JSON.stringify({flexibleCapacity:5,registrationLimit:25,approval:{mode:'workspace-regional'},ordinary:{groupId:'synthetic-group',start:'2030-01-01T09:00:00+08:00',end:'2030-01-01T12:00:00+08:00'},registrationDeadline:'2029-12-31T18:00'}),registrationControl:{enabled:true,published:true,deadline:'2029-12-31T18:00:00+08:00'}};
 event['批准摘要']=workflowApprovalHash(event);
 const rows=Array.from({length:20},()=>({活动ID:event['活动ID'],报名状态:'待筛选'}));
 for(const count of [20,24,25]){
  while(rows.length<count)rows.push({活动ID:event['活动ID'],报名状态:'待筛选'});
  const signup=publicWorkflowEvents({events:[event],registrations:rows})[0],card=projectWorkflowEvents([event],rows)[0];
  assert.equal(signup.capacity,20);assert.equal(signup.remaining,0);assert.equal(signup.quotaMode,'review');assert.equal(signup.flexibleRegistration,true);assert.equal(signup.full,count===25);
  assert.equal(card.capacity,20);assert.equal(card.remaining,0);assert.equal(card.full,count===25);assert.equal(card.sessions[0].capacity,20);
  assert.equal(registrationCapacity(event,rows).full,count===25);
  assert(!JSON.stringify(signup).includes('registrationLimit'));assert(!JSON.stringify(signup).includes('flexibleCapacity'));
 }
});
