import test from 'node:test';
import assert from 'node:assert/strict';
import {positionLeaveSummary} from '../public/app/shared/activity-leave-attention.js';

const position=(id,config={})=>({_id:id,活动ID:id,报名页配置:JSON.stringify(config)});
const leave=(id,status='待审批',registration='已确认')=>({活动ID:id,请假状态:status,报名状态:registration});

test('position leave counts include pending registrations and retain processed history separately',()=>{
  const data={events:[position('a'),position('b'),position('parent',{bookingMode:'grouped'})],registrations:[leave('a'),leave('a','待审批','待筛选'),leave('a','已批准','已请假'),leave('b','已驳回'),leave('b','待审批','已取消'),leave('parent'),leave('outside')]};
  const before=structuredClone(data),summary=positionLeaveSummary(data);
  assert.equal(summary.get('a').pending,2);assert.equal(summary.get('a').rows.length,3);
  assert.equal(summary.get('b').pending,0);assert.equal(summary.get('b').rows.length,2);
  assert.equal(summary.has('parent'),false);assert.equal(summary.has('outside'),false);
  assert.deepEqual(data,before);
});

test('source activity leaves belong to exactly one position; ambiguous rows are not counted twice',()=>{
  const summary=positionLeaveSummary({events:[position('a',{sourceActivityIds:['legacy','shared']}),position('b',{sourceActivityIds:['shared']})],registrations:[leave('legacy'),leave('shared'),leave('a')]});
  assert.equal(summary.get('a').pending,2);assert.equal(summary.get('b').pending,0);
  assert.equal(positionLeaveSummary({events:[],registrations:[]}).size,0);
});
