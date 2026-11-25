import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityFeedbackStore,feedbackEligible,feedbackTemplate} from '../lib/events/activity-feedback.js';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';

const event={_id:'evt',活动ID:'EVT',活动名称:'探索人道法',活动类别:'青年参与',状态:'已结束',报名日期:'2030-01-01',报名页配置:'{"endTime":"12:00"}'};
const member={accountId:'member',studentId:'234567890',realName:'合成志愿者',email:'234567890@smail.nju.edu.cn',emailVerified:true,status:'启用'};
const row={_id:'reg',报名ID:'WR-test',活动ID:'EVT',账号ID:'member',学号:member.studentId,姓名:member.realName,报名状态:'已签到',是否报名成功:'true',签到行ID:'checkin'};
const now=()=>Date.parse('2030-01-01T12:00:00+08:00');

test('eligibility requires an ended activity, successful attendance and verified ownership, including manual entries',()=>{
 assert.equal(feedbackEligible(event,row,member,now()),true);
 assert.equal(feedbackEligible(event,row,member,now()-1),false);
 assert.equal(feedbackEligible(event,{...row,签到行ID:''},member,now()),false);
 assert.equal(feedbackEligible(event,{...row,报名状态:'已确认'},member,now()),false);
 const manual={...row,账号ID:`manual:${member.studentId}`};
 assert.equal(feedbackEligible(event,manual,member,now()),true);
 assert.equal(feedbackEligible(event,manual,{...member,realName:'不同姓名'},now()),false);
 assert.equal(feedbackEligible(event,row,{...member,accountId:'other'},now()),false);
 assert.equal(feedbackTemplate(event),'ihl');
 assert.equal(feedbackTemplate({...event,报名页配置:'{"feedbackTemplate":"rating"}'}),'rating');
});

test('feedback templates save and reload, concurrent stale updates cannot overwrite a newer version',async t=>{
 const store=createActivityFeedbackStore(':memory:');t.after(()=>store.close());
 for(const [template,answers,rating] of [['rating',['意见'],5],['summary',['服务','感受','收获','建议'],null],['ihl',['一','二','三','四','五'],null]]){
  const entry={...row,_id:`reg-${template}`};
  assert.deepEqual(await store.write(entry,member,template,{rating,answers,version:0}),{template,rating,answers,version:1});
  const response=await store.write(entry,member,'rating',{rating,answers,version:1});
  assert.equal(response.version,2);
  assert.deepEqual(await store.read(entry,member),response);
  await assert.rejects(store.write(entry,member,template,{rating,answers,version:1}),{statusCode:409});
  await assert.rejects(store.read(entry,{accountId:'other'}),{statusCode:403});
 }
 assert.equal((await store.submitted(member.accountId)).size,3);
});

test('portal route verifies the actual check-in and CSRF before saving activity feedback',async t=>{
 const store=createActivityFeedbackStore(':memory:');t.after(()=>store.close());
 let checkin={_id:'checkin',报名行ID:row._id,活动ID:row.活动ID,账号ID:row.账号ID,学号:row.学号,核验人:'reviewer'},csrf=true;
 const base={listRows:async table=>table===WF.events?[event]:table===WF.registrations?[row]:[],getRow:async()=>checkin};
 const workflow=createWorkflow(base,{now});
 const ctx={getWorkflow:async()=>workflow,requirePortalSession:()=>member,requireCsrf:()=>csrf,
  getAccount:async()=>member,getActivityFeedback:async()=>store,readJson:async req=>req.body,json:(_res,status,body)=>({status,body})};
 const url=new URL('http://localhost/api/portal/workflow/activity-feedback?registration=WR-test');
 const body={answers:['一','二','三','四','五'],version:0};
 const call=(method='GET')=>workflowRoutes({method,headers:{},body},null,url,ctx);
 assert.equal((await call()).body.template,'ihl');
 csrf=false;await call('PUT');assert.equal(await store.read(row,member),null);
 csrf=true;checkin={...checkin,报名行ID:'other'};
 await assert.rejects(call('PUT'),{statusCode:404});
 checkin={...checkin,报名行ID:row._id};
 assert.equal((await call('PUT')).body.result.version,1);
});
