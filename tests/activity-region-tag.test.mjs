import test from 'node:test';
import assert from 'node:assert/strict';
import {isSuzhouActivity} from '../public/app/shared/activity-region-tag.js';

test('management region tags use explicit persisted region without promoting Nanjing activities',()=>{
  assert.equal(isSuzhouActivity({region:'suzhou'}),true);
  assert.equal(isSuzhouActivity({region:'苏州地区'}),true);
  assert.equal(isSuzhouActivity({活动地区:'苏州活动'}),true);
  assert.equal(isSuzhouActivity({报名页配置:JSON.stringify({region:'苏州活动'})}),true);
  assert.equal(isSuzhouActivity({content:{region:'suzhou'}}),true);
  assert.equal(isSuzhouActivity({region:'南京地区',地点:'苏州校区'}),false);
  assert.equal(isSuzhouActivity({活动名称:'合成南京活动'}),false);
});
