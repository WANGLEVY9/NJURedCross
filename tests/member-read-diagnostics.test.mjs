import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memberReadStage} from '../lib/events/member-read-diagnostics.js';
import {createObserver} from '../lib/observability.js';
import {apiFailure} from '../lib/http/errors.js';

test('member stages identify failures without exposing exception contents in responses or telemetry',async()=>{
 const logs=[],telemetry=createObserver({sink:record=>logs.push(record)});
 for(const stage of ['initialize','account','data','attendance','projection','hours']){
  assert.equal(await memberReadStage(stage,()=>42,telemetry),42);
  await assert.rejects(memberReadStage(stage,()=>{throw Error('SECRET account / private query');},telemetry),error=>{
   assert.equal(error.code,`workflow_member_${stage}_failed`);
   const response=apiFailure(error,{method:'GET'});
   assert.equal(response.status,500);
   assert.equal(response.payload.code,error.code);
   assert.ok(!JSON.stringify(response).includes('SECRET'));
   assert.ok(!error.stack.includes('SECRET'));
   return true;
  });
  assert.equal(logs.at(-1).operation,`member-${stage}`);
  assert.equal(logs.at(-1).ok,false);
 }
 assert.ok(!JSON.stringify(logs).includes('SECRET'));
});

test('member diagnostics preserve known rejection, timeout, cancellation and upstream semantics',async()=>{
 const telemetry=createObserver({sink:()=>{}});
 for(const error of [
  Object.assign(Error('denied'),{statusCode:403,code:'access_denied'}),
  Object.assign(Error('unavailable'),{statusCode:503,code:'profile_query_unavailable'}),
  Object.assign(Error('timeout'),{statusCode:504,code:'external_request_timeout'}),
  Object.assign(Error('cancelled'),{code:'ERR_CANCELED'}),
  Object.assign(Error('upstream'),{response:{status:401}}),
 ])await assert.rejects(memberReadStage('account',()=>{throw error;},telemetry),actual=>actual===error);
 await assert.rejects(memberReadStage('SECRET',()=>42,telemetry),TypeError);
});
