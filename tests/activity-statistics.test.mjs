import test from 'node:test';
import assert from 'node:assert/strict';
import {activityStatistics} from '../lib/events/activity-statistics.js';
import {activityFeedbackTemplate} from '../public/app/shared/activity-taxonomy.js';

test('statistics deduplicates people within projects, counts every verified attended row and excludes recycled projects',()=>{
 const events=[
  {_id:'a',活动ID:'a',活动名称:'合成项目',活动地区:'南京地区',状态:'已结束',报名页配置:JSON.stringify({ordinary:{groupId:'g'},activityTag:'同伴教育'})},
  {_id:'b',活动ID:'b',活动地区:'南京地区',状态:'已结束',报名页配置:JSON.stringify({ordinary:{groupId:'g'}})},
  {_id:'deleted',活动ID:'deleted',活动地区:'南京地区',状态:'已删除'},
  {_id:'foreign',活动ID:'foreign',活动地区:'苏州地区',状态:'已结束'},
  {_id:'blank',活动ID:'blank',活动地区:'南京地区',状态:'已结束'},
 ];
 const registrations=[{_id:'1',活动ID:'a',学号:'one',报名状态:'已签到'},{_id:'2',活动ID:'b',学号:'one',报名状态:'已签到'},
  {_id:'3',活动ID:'b',学号:'two',报名状态:'已签到'},{_id:'4',活动ID:'deleted',学号:'other',报名状态:'已签到'}];
 const checkins=[{报名行ID:'1',活动ID:'a',核验人:'reviewer'},{报名行ID:'2',活动ID:'b',核验人:'reviewer'},
  {报名行ID:'3',活动ID:'b'},{报名行ID:'4',活动ID:'deleted',核验人:'reviewer'}];
 const report=activityStatistics({events,registrations,checkins},{regions:['nanjing'],tag:'同伴教育'});
 assert.deepEqual(report.totals,{held:1,applicants:2,participations:2});
 assert.equal(report.details.length,1);
 assert.equal(report.details[0].name,'合成项目');
 assert.equal(activityStatistics({events,registrations,checkins},{regions:['nanjing'],tag:'未分类'}).details.length,1);
});

test('youth activity tags default to IHL and the other options come from the activity configuration',()=>{
 for(const tag of ['同伴教育','探索人道法','特殊儿童','气候防灾'])assert.equal(activityFeedbackTemplate(tag),'ihl');
 assert.equal(activityFeedbackTemplate('','simple-rating'),'simple-rating');
 assert.equal(activityFeedbackTemplate('','short-summary'),'short-summary');
 assert.equal(activityFeedbackTemplate('','unknown'),null);
});
