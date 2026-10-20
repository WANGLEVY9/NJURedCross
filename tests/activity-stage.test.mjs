import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityStage,
  stageLabel,
  stageActions,
  stageProgress,
  canEditMeta,
  hasSubmittedHours,
  nextStepHint,
  WORKFLOW_STEPS,
} from '../public/app/shared/activity-stage.js';
import { numeral, positionCode, buildPositionMap, buildPositionMapFromRows, labelPosition, positionLegend } from '../public/app/shared/position-labels.js';

const event = (status, extra = {}) => ({ 状态: status, ...extra });

test('every persisted status maps to exactly one visible stage', () => {
  assert.equal(activityStage(event('草稿')), 'draft');
  assert.equal(activityStage(event('待审核')), 'approval');
  assert.equal(activityStage(event('可发布')), 'ready');
  assert.equal(activityStage(event('报名中')), 'registering');
  assert.equal(activityStage(event('进行中')), 'running');
  assert.equal(activityStage(event('停点')), 'running');
  assert.equal(activityStage(event('已结束')), 'ended');
  assert.equal(activityStage(event('已归档')), 'archived');
  assert.equal(activityStage({}), 'draft');
});

test('submitted hours promote 进行中 to the review stage without writing a new status', () => {
  assert.equal(hasSubmittedHours([{ 状态: '待批准' }]), true);
  assert.equal(hasSubmittedHours([{ 状态: '已入账' }]), true);
  assert.equal(hasSubmittedHours([{ 状态: '草稿' }]), false);
  assert.equal(activityStage(event('进行中'), { ledger: [{ 状态: '待批准' }] }), 'hours');
  assert.equal(activityStage(event('进行中'), { ledger: [] }), 'running');
  // 已结束不再回退到时长审核，保证完成后页面稳定。
  assert.equal(activityStage(event('已结束'), { ledger: [{ 状态: '待批准' }] }), 'ended');
});

test('the flow indicator always shows the six ordered steps', () => {
  assert.deepEqual(WORKFLOW_STEPS.map(step => step.label), ['待审核', '待发布', '报名中', '进行中', '时长审核', '已结束']);
  const ready = stageProgress('ready');
  assert.equal(ready.filter(step => step.done).length, 1);
  assert.equal(ready.find(step => step.current).label, '待发布');
  assert.equal(stageLabel('hours'), '时长审核');
  assert.ok(nextStepHint('registering').includes('报名截止'));
});

test('批准与时长审核只对分管主席开放，负责人保留只读入口', () => {
  assert.deepEqual(stageActions('approval', { isOwner: true }).map(item => item.intent), []);
  assert.deepEqual(stageActions('approval', { canReview: true }).map(item => item.intent), ['approve', 'return-approval']);
  assert.deepEqual(stageActions('ready', { isOwner: true }).map(item => item.intent), ['publish-now', 'publish-schedule', 'copy-notice']);
  assert.deepEqual(stageActions('registering', { isOwner: true, project: true }).map(item => item.label), ['报名截止']);
  assert.deepEqual(stageActions('running', { isOwner: true }).map(item => item.label), ['提交时长表']);
  assert.deepEqual(stageActions('hours', { canReview: true }).map(item => item.label), ['在线预览', '导出 Excel', '结束活动']);
  assert.deepEqual(stageActions('hours', { isOwner: true }).map(item => item.label), ['在线预览']);
  assert.deepEqual(stageActions('ended', {}).map(item => item.label), ['查看时长表']);
  assert.deepEqual(stageActions('archived', { canReview: true }).map(item => item.label), ['恢复活动']);
});

test('活动信息修改只在发布前可用，岗位生成与来源班次一律只读', () => {
  assert.equal(canEditMeta(event('草稿')), true);
  assert.equal(canEditMeta(event('待审核')), true);
  assert.equal(canEditMeta(event('可发布')), true);
  assert.equal(canEditMeta(event('报名中')), false);
  assert.equal(canEditMeta(event('进行中')), false);
  assert.equal(canEditMeta(event('已结束')), false);
  assert.equal(canEditMeta(event('草稿', { 报名页配置: JSON.stringify({ positionPlan: { positions: [] } }) })), false);
  assert.equal(canEditMeta(event('草稿', { 报名页配置: JSON.stringify({ source: { kind: 'generated_blood' } }) })), false);
});

test('岗位编号覆盖一到百，并按配置顺序稳定映射', () => {
  assert.equal(numeral(1), '一');
  assert.equal(numeral(10), '十');
  assert.equal(numeral(11), '十一');
  assert.equal(numeral(20), '二十');
  assert.equal(numeral(21), '二十一');
  assert.equal(numeral(100), '一百');
  assert.equal(positionCode(2), '岗位二');

  const map = buildPositionMap([{ name: '引导岗' }, { name: '签到岗' }, { name: '引导岗' }]);
  assert.equal(map.size, 2);
  assert.equal(labelPosition(map, '签到岗'), '岗位二 · 签到岗');
  assert.equal(labelPosition(map, ''), '不限岗位');
  assert.equal(labelPosition(map, '未配置岗位'), '未配置岗位');
  assert.equal(positionLegend(map), '岗位一 引导岗 · 岗位二 签到岗');

  const fallback = buildPositionMapFromRows([{ 岗位: 'B' }, { 岗位: 'A' }, { 岗位: 'B' }]);
  assert.equal(labelPosition(fallback, 'B'), '岗位一 · B');
  assert.equal(positionLegend(buildPositionMap([{ name: '唯一岗位' }])), '');
});
