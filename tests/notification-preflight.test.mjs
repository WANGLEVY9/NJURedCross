import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationPreflight} from '../lib/events/notification-preflight.js';
const events=[{_id:'e',活动ID:'a',活动名称:'合成活动',岗位:'服务岗',地点:'合成地点'}],rows=[{_id:'r',活动ID:'a',账号ID:'u',姓名:'合成同学',报名日期:'2030-10-23',报名时段:'10:00-12:00',邮箱:'wrong@example.test'}],account={accountId:'u',email:'verified@example.test',emailVerified:true,status:'启用'};
test('notification uses exact account verified email, not stale registration email',()=>{const result=notificationPreflight(events,rows,[account])[0];assert.equal(result.email,account.email);assert.equal(result.reason,'');assert.match(result.information,/服务岗/);assert.match(result.information,/10:00-12:00/);});
test('missing, duplicate, unverified and disabled accounts block notification',()=>{for(const accounts of [[],[account,account],[{...account,emailVerified:false}],[{...account,status:'停用'}],[{...account,email:'bad'}]])assert.ok(notificationPreflight(events,rows,accounts)[0].reason);});
import {managementRoutes} from '../lib/events/management-api.js';
test('repeat notification preflight never sends, validates email again and reuses a stable delivery key',async()=>{
 let output,status,sends=0,verified=true;const keys=new Set();const records=[{...rows[0],报名状态:'已确认',报名ID:'reg'}];
 const ctx={readJson:async req=>req.body,json:(_res,code,value)=>{status=code;output=value;},actor:()=> 'admin',getDirectory:async()=>[{...account,emailVerified:verified}],audit:async()=>{},sendResultMail:async message=>{assert.equal(message.to,account.email);if(!keys.has(message.idempotencyKey)){keys.add(message.idempotencyKey);sends++;}return {ok:true,transport:'smtp'};}};
 const w={detail:async()=>({events,registrations:records})},url=new URL('http://fixture.test/api/volunteer/workflow/events/e/notify-results'),session={role:'super_admin'};
 await managementRoutes({method:'POST',body:{preview:true,ids:['r']}},null,url,ctx,w,session);assert.equal(status,200);assert.equal(sends,0);assert.equal(output.items[0].email,account.email);
 verified=false;await managementRoutes({method:'POST',body:{repeat:true,ids:['r'],requestId:'synthetic-batch-0001'}},null,url,ctx,w,session);assert.equal(status,409);assert.equal(sends,0);
 verified=true;for(let i=0;i<2;i++){await managementRoutes({method:'POST',body:{repeat:true,ids:['r'],requestId:'synthetic-batch-0001'}},null,url,ctx,w,session);assert.equal(status,200);assert.equal(output.results[0].status,'sent');}assert.equal(sends,1);
});
