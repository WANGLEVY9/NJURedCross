import test from 'node:test';
import assert from 'node:assert/strict';
import {runningPositions,runningParticipants,runningHours} from '../public/app/shared/activity-running.js';
const job=(id,config={})=>({'活动ID':id,'报名页配置':JSON.stringify(config)});
const person=(id,event,status='已确认')=>({_id:id,'活动ID':event,'报名状态':status});
test('running roster separates positions, excludes rejected and approved leave, retains repeated people by participation',()=>{
 const data={events:[job('parent',{bookingMode:'grouped'}),job('a'),job('b')],registrations:[person('1','a'),person('2','b'),person('3','a','未入选'),{...person('4','a'),请假状态:'已批准'},person('5','a','已签到')],ledger:[]};
 assert.equal(runningPositions(data).length,2);
 assert.deepEqual(runningParticipants(data,'a').map(item=>item.registration._id),['1','5']);
});
test('ambiguous source aliases cannot expose a person in either position',()=>{
 const data={events:[job('a',{sourceActivityIds:['source']}),job('b',{sourceActivityIds:['source']})],registrations:[person('1','source')],ledger:[]};
 assert.deepEqual(runningParticipants(data,'a'),[]);
 assert.deepEqual(runningParticipants(data,'b'),[]);
});
test('hours bind to participation and event and never imply director approval',()=>{
 const data={events:[job('a')],registrations:[person('1','a')],ledger:[{'报名行ID':'1','活动ID':'other',状态:'已批准'},{'报名行ID':'1','活动ID':'a',状态:'已批准',服务时长:2,培训时长:0,交通时长:0}]};
 const [item]=runningParticipants(data,'a');assert.equal(item.review,'待初审');assert.equal(item.entry['活动ID'],'a');
 assert.equal(runningHours(item.entry),'服务 2 · 培训 0 · 交通 0');
 data.ledger.push({...data.ledger[1]});assert.equal(runningParticipants(data,'a')[0].ambiguous,true);assert.equal(runningParticipants(data,'a')[0].entry,null);
});
