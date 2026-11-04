import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedHoursSources} from '../lib/events/hours-posting-source.js';

function fixture(){
 const config={workspaceSubmission:{origin:true},finalHours:{status:'exported',token:'frozen-token'}};
 const parent={_id:'p',活动ID:'parent-code',活动名称:'合成献血周',状态:'已结束',报名页配置:JSON.stringify(config)};
 const child={_id:'c',活动ID:'child-code',活动名称:'合成岗位',状态:'已结束',报名页配置:JSON.stringify({parentActivityId:'parent-code'})};
 const reg={_id:'r',活动ID:'child-code',账号ID:'person',姓名:'合成甲',学号:'000001'};
 const line={_id:'l',...reg,报名行ID:'r',幂等键:'FINAL:r',状态:'已批准',服务时长:'3',培训时长:'1',交通时长:'1',批准人:'chair',批准时间:'2026-11-04T00:00:00Z',来源摘要:'frozen-source',备注:JSON.stringify({v:2,d:'pass',e:false})};line._id='l';
 return {events:[parent,child],registrations:[reg],ledger:[line]};
}
test('a finalized child session uses the parent activity code, accepts paper attendance and sums three components',()=>{
 const data=fixture(),[source]=approvedHoursSources(data);assert.equal(source.eventId,'p');assert.equal(source.activityName,'合成献血周');assert.equal(source.totalHours,5);assert.equal(source.studentId,'000001');
 const version=source.version;data.ledger[0]['状态']='已入账';data.registrations[0]['录入状态']='网站已入账';data.registrations[0]['志愿时长']=5;assert.equal(approvedHoursSources(data)[0].version,version);
});
test('initial reviews, unfinished exports and failed final decisions do not post',()=>{
 for(const mutate of [d=>d.ledger[0]['幂等键']='RUNNING:r',d=>d.events[0]['状态']='进行中',d=>d.events[0]['报名页配置']='{}',d=>d.ledger[0]['备注']=JSON.stringify({v:2,d:'fail'})]){const data=fixture();mutate(data);assert.equal(approvedHoursSources(data).length,0);}
});
test('duplicate or inconsistent identities, invalid values and incomplete approval evidence fail before writes',()=>{
 for(const mutate of [d=>d.ledger.push({...d.ledger[0],_id:'duplicate'}),d=>d.ledger[0]['学号']='foreign',d=>d.ledger[0]['培训时长']='invalid',d=>d.ledger[0]['批准人']='',d=>d.events.pop()]){const data=fixture();mutate(data);assert.throws(()=>approvedHoursSources(data),{code:'hours_source_conflict'});}
});
test('FINAL supersedes SERVICE for the same registration without counting either RUNNING or legacy twice',()=>{
 const data=fixture();data.ledger.push({...data.ledger[0],_id:'service',幂等键:'SERVICE:r',服务时长:9},{...data.ledger[0],_id:'running',幂等键:'RUNNING:r'});assert.equal(approvedHoursSources(data).length,1);assert.equal(approvedHoursSources(data)[0].totalHours,5);
});

test('a damaged person is isolated while valid people and renamed activity contributions retain stable identities',()=>{
 const data=fixture(),version=approvedHoursSources(data)[0].version;data.events[0]['活动名称']='修改后的活动标题';assert.equal(approvedHoursSources(data)[0].version,version);
 data.registrations.push({...data.registrations[0],_id:'bad-reg',姓名:'合成乙',学号:'000002',账号ID:'bad-account'});
 data.ledger.push({...data.ledger[0],_id:'bad-ledger',报名行ID:'bad-reg',幂等键:'FINAL:bad-reg',姓名:'合成乙',学号:'000002',账号ID:'bad-account',服务时长:-1});
 const issues=[],sources=approvedHoursSources(data,{onIssue:issue=>issues.push(issue)});assert.equal(sources.length,1);assert.equal(issues.length,1);assert.equal(sources[0].studentId,'000001');
});
