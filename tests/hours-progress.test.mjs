import test from 'node:test';
import assert from 'node:assert/strict';
import {registrationHoursProgress} from '../lib/events/hours-progress.js';

const registration={_id:'reg',账号ID:'member',姓名:'合成同学',学号:'000001',活动ID:'event'};
const row=(prefix,status='已批准',hours=3)=>({...registration,报名行ID:'reg',幂等键:`${prefix}:reg`,状态:status,服务时长:hours,培训时长:1,交通时长:1,备注:JSON.stringify({v:2,d:'pass',e:false}),批准时间:'2030-01-01T00:00:00.000Z'});
test('initial review does not expose provisional hours as confirmed contributions',()=>{
 const result=registrationHoursProgress(registration,[row('RUNNING')]);assert.equal(result.code,'final_review');assert.equal(result.hours,undefined);assert.equal(result.attendanceConfirmed,true);assert.equal(result.profileSynced,false);
});
test('final and legacy approved hours use the same posting and profile progress contract',()=>{
 for(const prefix of ['FINAL','SERVICE']){
  const ledger=[row(prefix)],pending=registrationHoursProgress(registration,ledger);assert.equal(pending.code,'summary_pending');assert.equal(pending.hours.totalHours,5);
  const summary=registrationHoursProgress(registration,ledger,{websiteStatus:'done',legacyStatus:'done',profileStatus:'pending',nextProfileSyncAt:'2030-01-07T06:00:00+08:00'});assert.equal(summary.code,'profile_pending');assert.equal(summary.summarySynced,true);assert.equal(summary.profileSynced,false);
  const done=registrationHoursProgress(registration,ledger,{websiteStatus:'done',legacyStatus:'done',profileStatus:'done'});assert.equal(done.code,'synced');assert.equal(done.profileSynced,true);
 }
});
test('partial writes, pending final review, rejections and identity conflicts never appear synchronized',()=>{
 assert.equal(registrationHoursProgress(registration,[row('FINAL','待批准')]).hours,undefined);
 assert.equal(registrationHoursProgress(registration,[{...row('FINAL'),备注:JSON.stringify({v:2,d:'fail'})}]).code,'rejected');
 assert.equal(registrationHoursProgress(registration,[{...row('FINAL'),学号:'foreign'}]).code,'conflict');
 assert.equal(registrationHoursProgress(registration,[row('FINAL'),row('FINAL')]).code,'conflict');
 assert.equal(registrationHoursProgress(registration,[row('FINAL')],{websiteStatus:'done',legacyStatus:'failed'}).code,'summary_failed');
});
test('final records supersede a legacy service record for display without adding them twice',()=>{
 const result=registrationHoursProgress(registration,[row('SERVICE','已批准',9),row('FINAL','已批准',3)]);assert.equal(result.hours.serviceHours,3);assert.equal(result.hours.totalHours,5);
});
