import test from 'node:test';
import assert from 'node:assert/strict';
import {missingProfileFields,profileConflictMessage} from '../public/app/shared/profile-completeness.js';
import {accountWithProfileQualification} from '../lib/identity/volunteer-profile.js';
import {workspaceDraftErrors} from '../public/app/shared/activity-workspace.js';
const account={realName:'合成同学',studentId:'999990001',email:'999990001@smail.nju.edu.cn',emailVerified:true,campus:'鼓楼',department:'合成院系',qq:'123456789',wechat:'synthetic_wechat',gender:'女',certificate:'否',phone:'13800000000'};
test('complete required profile accepts all required contacts',()=>assert.deepEqual(missingProfileFields(account),[]));

test('existing qualification labels satisfy completeness without a new declaration',()=>{
 for(const certificate of ['是，CPR+AED/红十字救护证','是，AHA证书','否','否，但参加过“一加·急救培训”'])assert.deepEqual(missingProfileFields({...account,certificate}),[]);
 for(const certificate of ['', '未知', '未登记'])assert.deepEqual(missingProfileFields({...account,certificate}),['急救证']);
});

test('booking reads source qualification and rejects ambiguous or foreign identities',async()=>{
 for(const rows of [[{_id:'p',学号:account.studentId,姓名:account.realName,急救证:'是，CPR+AED/红十字救护证'}],[{_id:'p',学号:account.studentId,姓名:'其他同学',急救证:'否'}],[]]){
  const actual=await accountWithProfileQualification({...account,certificate:'否'},{query:async()=>rows});
  assert.equal(actual.certificate,rows.length&&rows[0].姓名===account.realName?rows[0].急救证:'');
 }
 const actual=await accountWithProfileQualification({...account,emailVerified:false},{query:async()=>{throw Error('must not read');}});assert.equal(actual.certificate,'');
});
test('each required contact is checked including whitespace and malformed numbers',()=>{
 for(const [key,label] of [['department','院系'],['qq','QQ号'],['wechat','微信号'],['gender','性别'],['phone','手机号'],['certificate','急救证']]){
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
 for(const patch of [{realName:''},{studentId:''},{department:''},{qq:''},{wechat:''},{gender:''},{phone:''},{campus:''},{certificate:''},{certificate:'未知'}]){Object.assign(current,account,patch);await workflowRoutes({method:'POST',headers:{}},null,new URL('http://fixture.test/api/portal/workflow/events/e/register'),ctx);assert.equal(result.status,400);assert.equal(result.payload.code,'profile_incomplete');assert.equal(writes,0);}
 Object.assign(current,account);await workflowRoutes({method:'POST',headers:{}},null,new URL('http://fixture.test/api/portal/workflow/events/e/register'),ctx);assert.equal(result.status,201);assert.equal(writes,1);
});


test('contact conflicts identify affected fields without claiming an identity mismatch',()=>{
 const message=profileConflictMessage({conflictFields:['phone','certificate']});assert.ok(message.includes('手机号、急救证'));assert.equal(message.includes('身份冲突'),false);assert.ok(profileConflictMessage({}).includes('身份冲突'));
});
