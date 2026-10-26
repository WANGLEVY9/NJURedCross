import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_CATEGORY_OPTIONS, activityKind, activityRegion, categoryFacets } from '../public/app/shared/activity-taxonomy.js';

test('legacy single-select categories are not regions or programme types', () => {
  assert.deepEqual(ACTIVITY_CATEGORY_OPTIONS, ['主席团专项','博爱中心','生命中心','综事中心','排班类','一加助残专项','献血车专项']);
  assert.equal(activityKind({center:'主席团'}),'主席团专项');
  assert.equal(activityKind({center:'排班类'}),'排班类');
  assert.equal(activityKind({center:'排班专项'}),'排班类');
  assert.equal(activityKind({type:'排版类'}),'排班类');
  assert.equal(activityKind({center:'一加助残'}),'一加助残专项');
  assert.equal(activityKind({center:'苏州分部'}),'未分类');
  assert.equal(activityKind({center:'生命类',type:'献血车志愿服务'}),'生命中心');
  assert.equal(activityKind({type:'生命中心'}),'生命中心');
  assert.equal(activityKind({type:'志愿服务'}),'未分类');
  assert.equal(activityKind({type:'献血车志愿服务'}),'未分类');
  assert.equal(activityRegion({blood:{},location:'新街口'}),'nanjing');
  assert.equal(activityRegion({type:'生命中心',campus:'苏州'}),'suzhou');
  assert.equal(activityRegion({region:'南京活动',campus:'苏州'}),'nanjing');
  assert.equal(activityRegion({type:'苏州分部'}),'suzhou');
  assert.deepEqual(categoryFacets([{type:'志愿服务'}]), [...ACTIVITY_CATEGORY_OPTIONS]);
  assert.deepEqual(categoryFacets([{center:'苏州分部'},{center:'任意新增类别'}],['苏州分部','主席团','未分类',...ACTIVITY_CATEGORY_OPTIONS]), [...ACTIVITY_CATEGORY_OPTIONS]);
});
