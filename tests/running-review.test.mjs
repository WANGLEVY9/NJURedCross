import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunningReview} from '../lib/events/running-review.js';
import {workflowApprovalHash,workflowEventApproved} from '../lib/events/workflow.js';
import {createMutationQueue} from '../lib/events/safety.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {workspaceStage} from '../public/app/shared/activity-workspace.js';
function fixture(){
 const event={_id:'parent',活动ID:'parent-code',状态:'进行中',申请版本:'1',批准版本:'1',负责人账号ID:'director',活动地区:'苏州地区',组织类别:'生命中心',报名页配置:JSON.stringify({workspaceSubmission:{origin:true},region:'苏州活动',center:'生命中心',approval:{mode:'workspace-regional',region:'suzhou',category:'生命中心',version:'1'}})};
 event['批准摘要']=workflowApprovalHash(event);
 const data={events:[event],registrations:[{_id:'one',活动ID:'parent-code',账号ID:'account-one',姓名:'合成甲',学号:'20300001',报名状态:'已确认',签到照片ID:'synthetic-photo'}],checkins:[],ledger:[]};
 const roster={complete:true,rows:[{accountId:'director',role:'director',region:'suzhou',categories:['生命中心'],active:true},{accountId:'other',role:'director',region:'suzhou',categories:['生命中心'],active:true},{accountId:'chair',role:'presidium',region:'suzhou',categories:[],active:true},{accountId:'nj-chair',role:'presidium',region:'nanjing',categories:[],active:true}]};
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>structuredClone(roster)});let writes=0,lost=false;
 const review=createRunningReview({read:async()=>structuredClone(data),write:createMutationQueue(),WF:{events:'events'},update:async(_t,row,patch)=>{writes++;Object.assign(event,patch);if(lost){lost=false;throw Error('lost response');}},approved:workflowEventApproved,authorize:(row,actor)=>routing.assertHoursRecorder(row,actor),secret:'synthetic-review-secret',now:()=>123456});
 const item={id:'one',serviceHours:2,trainingHours:0,travelHours:0,decision:'pass',reason:'',evidenceChecked:true};
 return {review,data,event,roster,item,writes:()=>writes,lose:()=>{lost=true;}};
}
test('only current responsible regional director may write first review; revoked roster is rechecked',async()=>{
 const f=fixture(),before=await f.review.runningReview('parent','director');assert.equal(before.canRecord,true);
 for(const actor of ['other','chair','nj-chair']){assert.equal((await f.review.runningReview('parent',actor)).canRecord,false);await assert.rejects(f.review.saveRunningReview('parent',{token:before.token,items:[f.item]},actor),{statusCode:403});}
 f.roster.rows[0].active=false;await assert.rejects(f.review.saveRunningReview('parent',{token:before.token,items:[f.item]},'director'),{statusCode:403});assert.equal(f.writes(),0);
});
test('draft is separate from final ledger, preserves approval, rejects stale saves and records nonpass reason',async()=>{
 const f=fixture(),before=await f.review.runningReview('parent','director');await f.review.saveRunningReview('parent',{token:before.token,items:[{...f.item,decision:'fail',reason:'未按要求完成',evidenceChecked:false}]},'director');
 const state=await f.review.runningReview('parent','director');assert.equal(state.entries[0].decision,'fail');assert.equal(f.data.checkins.length,0);assert.equal(f.data.ledger.length,0);assert.equal(workflowEventApproved(f.event),true);assert.equal(workspaceStage(f.event),'进行中');
 await assert.rejects(f.review.saveRunningReview('parent',{token:before.token,items:[f.item]},'director'),{statusCode:409});
});
test('all records and fresh preview are mandatory; changes invalidate preview and submission is retry-safe',async()=>{
 const f=fixture(),state=await f.review.runningReview('parent','director'),body={token:state.token,items:[f.item]};
 await assert.rejects(f.review.submitRunningReview('parent',body,'director'),{statusCode:409});
 await assert.rejects(f.review.previewRunningReview('parent',{...body,items:[{...f.item,decision:''}]},'director'),{statusCode:409});
 const proof=await f.review.previewRunningReview('parent',body,'director');f.data.registrations[0]['签到提交时间']='changed';
 await assert.rejects(f.review.submitRunningReview('parent',{...body,previewToken:proof.previewToken},'director'),{statusCode:409});
 const fresh=await f.review.runningReview('parent','director'),next=await f.review.previewRunningReview('parent',{...body,token:fresh.token},'director'),submit={token:next.token,items:next.items,previewToken:next.previewToken};f.lose();
 await assert.rejects(f.review.submitRunningReview('parent',submit,'director'),/lost response/);assert.deepEqual(await f.review.submitRunningReview('parent',submit,'director'),{submitted:true});assert.equal(f.writes(),1);
 assert.equal(workspaceStage(f.event),'时长审核');assert.equal(workflowEventApproved(f.event),true);assert.equal(f.data.ledger.length,0);
 await assert.rejects(f.review.saveRunningReview('parent',{token:fresh.token,items:[f.item]},'director'),{statusCode:409});
});
test('attendance is optional while reasons, identities and complete review remain enforced',async()=>{
 const f=fixture();delete f.data.registrations[0]['签到照片ID'];let state=await f.review.runningReview('parent','director');
 const preview=await f.review.previewRunningReview('parent',{token:state.token,items:[{...f.item,evidenceChecked:false}]},'director');assert.equal(preview.items[0].decision,'pass');assert.equal(f.data.checkins.length,0);
 await assert.rejects(f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,decision:'fail',reason:''}]},'director'),{statusCode:400});
 await assert.rejects(f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,id:'foreign'}]},'director'),{statusCode:409});
 f.data.registrations.push({...f.data.registrations[0],_id:'two'});state=await f.review.runningReview('parent','director');await assert.rejects(f.review.previewRunningReview('parent',{token:state.token,items:[{...f.item,decision:'fail',reason:'未参加'}]},'director'),{statusCode:409});
});
test('attendance changes clear saved decisions and no empty submission is accepted',async()=>{
 const f=fixture(),state=await f.review.runningReview('parent','director');await f.review.saveRunningReview('parent',{token:state.token,items:[f.item]},'director');
 assert.equal((await f.review.runningReview('parent','director')).entries[0].decision,'pass');f.data.registrations[0]['签到照片ID']='different-photo';
 const changed=await f.review.runningReview('parent','director');assert.equal(changed.entries[0].decision,'');assert.equal(changed.entries[0].evidenceChecked,false);assert.equal(changed.entries[0].sourceDigest,undefined);
 f.data.registrations=[];const empty=await f.review.runningReview('parent','director');await assert.rejects(f.review.previewRunningReview('parent',{token:empty.token,items:[]},'director'),/没有可提交/);
});

test('optional attendance links retain safe web addresses and reject executable or credential-bearing links',async()=>{
 const f=fixture(),state=await f.review.runningReview('parent','director');
 for(const attendanceUrl of ['javascript:alert(1)','data:text/html,test','https://user:secret@example.test/photo'])await assert.rejects(f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,attendanceUrl}]},'director'),{statusCode:400});
 await f.review.saveRunningReview('parent',{token:state.token,items:[{...f.item,attendanceUrl:'https://example.test/attendance',evidenceChecked:false}]},'director');
 assert.equal((await f.review.runningReview('parent','director')).entries[0].attendanceUrl,'https://example.test/attendance');
});

test('running grouped projects keep detail and review available after contact updates without reapproval',async()=>{
 const f=fixture(),c=JSON.parse(f.event['报名页配置']);
 c.ordinary={groupId:'synthetic-running-project'};c.bookingMode='grouped';c.positionPlan={groupId:'synthetic-running-project'};
 f.event['报名页配置']=JSON.stringify(c);f.event['批准摘要']=workflowApprovalHash(f.event);
 const child={...f.event,_id:'child',活动ID:'child-code',报名页配置:JSON.stringify({...c,bookingMode:'unified',parentActivityId:'parent-code',positionPlan:undefined})};
 child['批准摘要']=workflowApprovalHash(child);f.data.events.push(child);f.data.registrations[0]['活动ID']='child-code';
 for(const row of f.data.events)row['报名页配置']=JSON.stringify({...JSON.parse(row['报名页配置']),registrationContact:{qqGroup:'123456789',notes:'合成联系人变更'}});
 const state=await f.review.runningReview('parent','director');assert.equal(state.canRecord,true);
 await f.review.saveRunningReview('parent',{token:state.token,items:[f.item]},'director');
 assert.equal((await f.review.runningReview('parent','director')).entries[0].decision,'pass');
 child['状态']='报名中';await assert.rejects(f.review.runningReview('parent','director'),{statusCode:409});
 child['状态']='进行中';child['容量']='999';await assert.rejects(f.review.runningReview('parent','director'),{statusCode:409});
});
