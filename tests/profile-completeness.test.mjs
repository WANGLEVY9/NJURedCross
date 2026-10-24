import test from 'node:test';
import assert from 'node:assert/strict';
import {missingProfileFields} from '../public/app/shared/profile-completeness.js';
import {workspaceDraftErrors} from '../public/app/shared/activity-workspace.js';
const account={realName:'合成同学',studentId:'999990001',email:'999990001@smail.nju.edu.cn',emailVerified:true,campus:'鼓楼',department:'合成院系',qq:'123456789',wechat:'synthetic_wechat',gender:'女',phone:'13800000000'};
test('complete required profile accepts all required contacts',()=>assert.deepEqual(missingProfileFields(account),[]));
test('each required contact is checked including whitespace and malformed numbers',()=>{
 for(const [key,label] of [['department','院系'],['qq','QQ号'],['wechat','微信号'],['gender','性别'],['phone','手机号']]){
  for(const value of ['', '  '])assert.deepEqual(missingProfileFields({...account,[key]:value}),[label]);
 }
 assert.deepEqual(missingProfileFields({...account,phone:'123',qq:'bad'}),['QQ号','手机号']);
});
test('missing identity and campus remain protected',()=>assert.deepEqual(missingProfileFields({...account,realName:'',studentId:'',campus:''}),['真实姓名','学号','校区']));
test('email is not a profile completeness reminder condition',()=>assert.deepEqual(missingProfileFields({...account,email:'',emailVerified:false}),[]));

test('verified administrator can use mailbox student ID without changing identity',()=>assert.deepEqual(missingProfileFields({...account,role:'platform_admin',studentId:''}),[]));
test('submission validation requires QQ while leaving draft saving separate',()=>{const base={name:'合成活动'};assert.ok(workspaceDraftErrors(base).some(error=>error.includes('QQ群号')));assert.equal(workspaceDraftErrors({...base,qqGroup:'123456789'}).some(error=>error.includes('QQ群号')),false);});
import {workflowRoutes} from '../lib/events/workflow-api.js';
test('registration API refuses incomplete own profile before attempting any registration write',async()=>{
 let writes=0,result;const current={accountId:'synthetic-member',role:'member',...account};
 const ctx={requirePortalSession:()=>({username:'synthetic-member'}),requireCsrf:()=>true,getAccount:async()=>current,getWorkflow:async()=>({register:async()=>{writes++;return {_id:'synthetic-registration',报名ID:'synthetic-code',报名状态:'待筛选'};}}),readJson:async()=>({consent:true}),audit:async()=>{},json:(_res,status,payload)=>{result={status,payload};}};
 for(const patch of [{realName:''},{studentId:''},{department:''},{qq:''},{wechat:''},{gender:''},{phone:''},{campus:''}]){Object.assign(current,account,patch);await workflowRoutes({method:'POST',headers:{}},null,new URL('http://fixture.test/api/portal/workflow/events/e/register'),ctx);assert.equal(result.status,400);assert.equal(result.payload.code,'profile_incomplete');assert.equal(writes,0);}
 Object.assign(current,account);await workflowRoutes({method:'POST',headers:{}},null,new URL('http://fixture.test/api/portal/workflow/events/e/register'),ctx);assert.equal(result.status,201);assert.equal(writes,1);
});
