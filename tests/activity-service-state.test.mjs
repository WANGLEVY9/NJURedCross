import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceStatus, matchesServiceFilter, attendanceBlockReason, reviewBlockReason } from '../public/app/console/pages/activity-service-state.js';

test('attendance defaults to unfinished work and returns submitted records to the review stage', () => {
  const confirmed = { 报名状态: '已确认' };
  for (const entry of [undefined, { 状态: '已退回' }]) {
    assert.equal(matchesServiceFilter('todo', entry, false), true);
    assert.equal(attendanceBlockReason(confirmed, entry, false), '');
  }
  const submitted = { 状态: '待批准' };
  assert.equal(matchesServiceFilter('todo', submitted, false), false);
  assert.equal(matchesServiceFilter('submitted', submitted, false), true);
  assert.match(attendanceBlockReason(confirmed, submitted, false), /⑤/);
  assert.equal(serviceStatus(submitted, false), '已提交');
  assert.equal(serviceStatus(submitted, true), '待审核');
});

test('approved and posted records share one completed view and cannot re-enter attendance', () => {
  for (const status of ['已批准', '已入账']) {
    const entry = { 状态: status };
    assert.equal(serviceStatus(entry, true), '已通过');
    assert.equal(serviceStatus(entry, false), '已通过');
    assert.equal(matchesServiceFilter('approved', entry, true), true);
    assert.equal(matchesServiceFilter('todo', entry, true), false);
    assert.match(attendanceBlockReason({ 报名状态: '已签到' }, entry, false), /已通过/);
    assert.match(reviewBlockReason(entry, 'reviewer', true), /导出/);
  }
});

test('unavailable records explain leave, missing photo and independent review requirements', () => {
  assert.match(attendanceBlockReason({ 报名状态: '已确认', 请假状态: '待审批' }, undefined, false), /请假/);
  assert.match(attendanceBlockReason({ 报名状态: '已确认' }, undefined, true), /照片/);
  const entry = { 状态: '待批准', 核对人: 'checker', 账号ID: 'participant' };
  assert.match(reviewBlockReason(entry, 'checker', false), /另一位/);
  assert.match(reviewBlockReason(entry, 'participant', false), /另一位/);
  assert.equal(reviewBlockReason(entry, 'reviewer', false), '');
  assert.equal(reviewBlockReason(entry, 'checker', true), '');
  assert.match(reviewBlockReason({ 状态: '已退回' }, 'reviewer', false), /④/);
});
