import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_CATEGORY_OPTIONS, ACTIVITY_CENTER_OPTIONS, workflowActivityCenter, activityKind, activityRegion, categoryFacets } from '../public/app/shared/activity-taxonomy.js';
import {attachOrdinaryControls} from '../lib/events/ordinary-groups.js';

test('management choices and legacy centre values project consistently',()=>{
 assert.deepEqual(ACTIVITY_CENTER_OPTIONS,['博爱中心','生命中心','综事中心','主席团']);
 assert.equal(activityKind({center:'一加助残'}),'博爱中心');
 assert.equal(workflowActivityCenter({组织类别:'未分类',活动类别:'公益活动'},{center:'生命中心'}),'生命中心');
 assert.equal(workflowActivityCenter({组织类别:'综事中心'},{center:'生命中心'}),'综事中心');
 const [row]=attachOrdinaryControls([{组织类别:'生命中心',报名页配置:JSON.stringify({ordinary:{groupId:'synthetic'}})}],[{活动组ID:'synthetic',组织类别:'博爱中心'}]);
 assert.equal(row['组织类别'],'生命中心');
});

test('legacy single-select categories are not regions or programme types', () => {
  assert.deepEqual(ACTIVITY_CATEGORY_OPTIONS, ['苏州分部','主席团','一加助残','博爱中心','生命中心','综事中心','献血车专项']);
  assert.equal(activityKind({center:'生命类',type:'献血车志愿服务'}),'生命中心');
  assert.equal(activityKind({type:'生命中心'}),'生命中心');
  assert.equal(activityKind({type:'志愿服务'}),'未分类');
  assert.equal(activityKind({type:'献血车志愿服务'}),'未分类');
  assert.equal(activityRegion({blood:{},location:'新街口'}),'nanjing');
  assert.equal(activityRegion({type:'生命中心',campus:'苏州'}),'suzhou');
  assert.equal(activityRegion({region:'南京活动',campus:'苏州'}),'nanjing');
  assert.equal(activityRegion({type:'苏州分部'}),'suzhou');
  assert.deepEqual(categoryFacets([{type:'志愿服务'}]), [...ACTIVITY_CATEGORY_OPTIONS,'未分类']);
});
