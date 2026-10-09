import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_CATEGORIES, eventCategory, EVENT_CAMPUSES, campusName } from '../public/app/portal/event-category.js';
test('activity categories cover ordinary regions and keep blood rosters separate', () => {
  assert.deepEqual(EVENT_CATEGORIES.map(c => c.label), ['全部', '南京地区', '苏州地区', '献血车专项']);
  assert.equal(eventCategory({ type: '公益活动', location: '仙林' }), 'nanjing');
  assert.equal(eventCategory({ type: '苏州分部', location: '南雍楼' }), 'suzhou');
  assert.equal(eventCategory({ campus: '苏州', type: '公益活动' }), 'suzhou');
  assert.equal(eventCategory({ blood: { week: 47 }, location: '苏州' }), 'blood');
  assert.equal(eventCategory({ type: '献血车志愿服务' }), 'blood');
  assert.equal(eventCategory({ type: '公益活动' }), 'nanjing');
});

test('campus filters always include the four main campuses and match short data names',()=>{
 assert.deepEqual(EVENT_CAMPUSES,['仙林校区','苏州校区','浦口校区','鼓楼校区']);
 for(const campus of EVENT_CAMPUSES)assert.equal(campusName(campus.replace('校区','')),campus);
 assert.equal(campusName(' 苏州校区 '),'苏州校区');
 assert.equal(campusName('鼓楼'),'鼓楼校区');
 assert.equal(campusName(''), '');
 assert.equal(campusName('校外'), '校外');
});
