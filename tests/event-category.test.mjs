import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_CATEGORIES, eventCategory } from '../public/app/portal/event-category.js';
import { eventCenterLabel } from '../public/app/portal/event-center.js';

test('activity badges normalize source departments into the four centres', () => {
  for (const type of ['博爱中心', '博爱青春', '博爱三献', '博爱法务', '一加助残']) {
    assert.equal(eventCenterLabel({ type }), '博爱中心');
  }
  for (const type of ['生命中心', '生命防艾', '生命同伴', '生命三救']) {
    assert.equal(eventCenterLabel({ type }), '生命中心');
  }
  assert.equal(eventCenterLabel({ type: '综事宣新/摄影' }), '综事中心');
  assert.equal(eventCenterLabel({ type: '主席团&指导组' }), '主席团');
  assert.equal(eventCenterLabel({ type: '献血车志愿服务', blood: { week: 47 } }), '博爱中心');
  assert.equal(eventCenterLabel({ category: '一加助残', name: '一加急救' }), '博爱中心');
  assert.equal(eventCenterLabel({ type: '苏州分部' }), '苏州分部');
  assert.equal(eventCenterLabel({ type: '生命中心', campus: '苏州' }), '生命中心');
  assert.equal(eventCenterLabel({ category: '综事中心', type: '献血车志愿服务', blood: true }), '综事中心');
  assert.equal(eventCenterLabel({ center: '主席团', type: '博爱中心' }), '主席团');
  assert.equal(eventCenterLabel({ category: '苏州分部', type: '生命中心' }), '苏州分部');
});
test('activity categories cover ordinary regions and keep blood rosters separate', () => {
  assert.deepEqual(EVENT_CATEGORIES.map(c => c.label), ['全部', '南京地区', '苏州地区', '献血车专项']);
  assert.equal(eventCategory({ type: '公益活动', location: '仙林' }), 'nanjing');
  assert.equal(eventCategory({ type: '苏州分部', location: '南雍楼' }), 'suzhou');
  assert.equal(eventCategory({ campus: '苏州', type: '公益活动' }), 'suzhou');
  assert.equal(eventCategory({ blood: { week: 47 }, location: '苏州' }), 'blood');
  assert.equal(eventCategory({ type: '献血车志愿服务' }), 'blood');
  assert.equal(eventCategory({ type: '公益活动' }), 'nanjing');
});
