import test from 'node:test';
import assert from 'node:assert/strict';
import { reimbursementActivityCatalogue, retireSupersededActivities, activityTimeSlot } from '../lib/reimbursements/activity-catalogue.js';

const approved = () => true;
const row = (id, name, group, extra = {}) => ({ _id: id, '活动名称': name, '状态': '已结束', '活动类别': '公益活动', '组织类别': '生命中心',
  '活动地区': '苏州', '地点': '南雍楼-东121', '工作内容': '协助YABC同伴教育课程开展', '活动人数': 24,
  '报名页配置': JSON.stringify({ ordinary: group ? { groupId: group, start: '2026-11-15T16:00:00+08:00' } : null }), ...extra });
const yabc = '11.15 YABC（八）应对暴力';

test('a grouped activity keeps one catalogue entry even though the workflow stores one row per position', () => {
  // 11.15 YABC（八）应对暴力：课程志愿者与摄影志愿者两行，共用一个项目分组。
  const catalogue = reimbursementActivityCatalogue([], [row('position-course', yabc, 'PROJECT-WS-yabc'),
    row('position-photo', yabc, 'PROJECT-WS-yabc')], approved);
  assert.equal(catalogue.length, 1);
  assert.equal(catalogue[0].name, yabc);
  assert.equal(catalogue[0].campus, '苏州');
});

test('an ungrouped activity still keys each position separately, which is what re-keying has to clean up', () => {
  const catalogue = reimbursementActivityCatalogue([], [row('position-course', yabc, ''), row('position-photo', yabc, '')], approved);
  assert.deepEqual(catalogue.map(item => item.eventId).sort(), ['workflow:position-course', 'workflow:position-photo']);
});

test('a superseded id stops listing an activity twice, while manual and referenced rows survive', () => {
  const live = new Map([['workflow:position-course', { name: yabc, date: '2026-11-15' }]]);
  const activities = new Map([
    ['workflow-group:PROJECT-WS-yabc', { id: 'workflow-group:PROJECT-WS-yabc', name: yabc, date: '2026-11-15', catalogSource: true }],
    ['workflow:position-course', { id: 'workflow:position-course', name: yabc, date: '2026-11-15', catalogSource: true }],
    ['manual-activity', { id: 'manual-activity', name: '财务手工补录活动', date: '2026-11-15' }],
    ['workflow:old-referenced', { id: 'workflow:old-referenced', name: yabc, date: '2026-11-15', catalogSource: true }],
  ]);
  retireSupersededActivities(activities, live, new Set(['workflow:old-referenced']));
  assert.deepEqual([...activities.keys()], ['workflow:position-course', 'manual-activity', 'workflow:old-referenced']);
});

test('an activity that merely left the catalogue keeps its place, so pausing registration never blocks finance', () => {
  const live = new Map([['workflow:position-course', { name: yabc, date: '2026-11-15' }]]);
  const activities = new Map([['workflow:paused-blood', { id: 'workflow:paused-blood', name: '市血液献血车 · 第52周 · 新街口中央',
    date: '2026-11-20', catalogSource: true }]]);
  retireSupersededActivities(activities, live);
  assert.deepEqual([...activities.keys()], ['workflow:paused-blood']);
});

test('the shift time is taken literally so a +08:00 string is never shifted twice', () => {
  assert.equal(activityTimeSlot('2026-11-19T10:00:00+08:00'), '10:00');
  assert.equal(activityTimeSlot('2026-11-19T13:00:00+08:00'), '13:00');
  assert.equal(activityTimeSlot('2026-11-19 09:30'), '09:30');
  // 只登记了日期，或排班表用零点表示「时间待定」，都不该在下拉里显示 00:00。
  assert.equal(activityTimeSlot('2026-11-19'), '');
  assert.equal(activityTimeSlot('2026-11-11T00:00:00+08:00'), '');
  assert.equal(activityTimeSlot(''), '');
  assert.equal(activityTimeSlot(null), '');
  assert.equal(activityTimeSlot('2026-11-19T25:70:00+08:00'), '');
});

test('same-name sessions on one day stay separate, because blood shifts share a name but not a slot', () => {
  const live = new Map([['workflow:BS-morning', { name: '市血液献血车 · 第52周 · 新街口中央', date: '2026-11-23' }],
    ['workflow:BS-afternoon', { name: '市血液献血车 · 第52周 · 新街口中央', date: '2026-11-23' }]]);
  const activities = new Map([...live].map(([id, activity]) => [id, { id, ...activity, catalogSource: true }]));
  retireSupersededActivities(activities, live);
  assert.equal(activities.size, 2);
});
