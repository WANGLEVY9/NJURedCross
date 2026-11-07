import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceWindowOpen, attendanceGraceMs, attendanceBounds, DEFAULT_ATTENDANCE_GRACE_HOURS,
} from '../lib/events/attendance-window.js';

const at = value => Date.parse(value);
const ordinary = (status = '进行中', extra = {}) => ({
  活动ID: 'E', 状态: status, 报名日期: '2026-11-07',
  报名页配置: JSON.stringify(extra),
});
const blood = (extra = {}) => ({
  活动ID: 'B', 状态: '已结束', 报名日期: '2026-11-07',
  报名页配置: JSON.stringify({ source: { kind: 'generated_blood' }, blood: { start: '2026-11-07T08:00:00+08:00', end: '2026-11-07T12:00:00+08:00' }, ...extra }),
});

test('ordinary activities accept attendance within the configured grace window after the shift ends', () => {
  const event = ordinary();
  const { start, end } = attendanceBounds(event);
  assert.equal(start, at('2026-11-07T00:00:00+08:00'));
  assert.equal(end, at('2026-11-07T23:59:59+08:00'));
  assert.equal(attendanceGraceMs(event), DEFAULT_ATTENDANCE_GRACE_HOURS * 3_600_000);
  assert.equal(attendanceWindowOpen(event, [], at('2026-11-06T23:00:00+08:00')), false, 'before start');
  assert.equal(attendanceWindowOpen(event, [], at('2026-11-07T12:00:00+08:00')), true, 'during shift');
  assert.equal(attendanceWindowOpen({ ...event, 状态: '已结束' }, [], at('2026-11-08T12:00:00+08:00')), true, 'after end within grace');
  assert.equal(attendanceWindowOpen({ ...event, 状态: '已结束' }, [], at('2026-11-10T12:00:00+08:00')), false, 'past grace');
});

test('grace period is explicitly configurable per activity or by environment', t => {
  const saved = process.env.ATTENDANCE_GRACE_HOURS;
  delete process.env.ATTENDANCE_GRACE_HOURS;
  t.after(() => { if (saved === undefined) delete process.env.ATTENDANCE_GRACE_HOURS; else process.env.ATTENDANCE_GRACE_HOURS = saved; });
  const afterEnd = at('2026-11-08T02:00:00+08:00');
  assert.equal(attendanceWindowOpen(ordinary('已结束'), [], afterEnd), true);
  assert.equal(attendanceWindowOpen(ordinary('已结束', { attendanceGraceHours: 0 }), [], afterEnd), false);
  process.env.ATTENDANCE_GRACE_HOURS = '0';
  assert.equal(attendanceWindowOpen(ordinary('已结束'), [], afterEnd), false);
  assert.equal(attendanceWindowOpen(ordinary('已结束', { attendanceGraceHours: 24 }), [], afterEnd), true);
});

test('archived, removed and submitted projects close attendance for every activity type', () => {
  const submitted = { 活动ID: 'S', 状态: '进行中', 报名页配置: JSON.stringify({ runningReview: { status: 'submitted' } }) };
  assert.equal(attendanceWindowOpen(ordinary(), [submitted], at('2026-11-07T12:00:00+08:00')), false);
  assert.equal(attendanceWindowOpen(ordinary('已归档'), [], at('2026-11-07T12:00:00+08:00')), false);
  assert.equal(attendanceWindowOpen(ordinary('进行中', { workspaceRemoval: true }), [], at('2026-11-07T12:00:00+08:00')), false);
  assert.equal(attendanceWindowOpen(ordinary('进行中', { bloodWeekArchive: true }), [], at('2026-11-07T12:00:00+08:00')), false);
});

test('generated blood shifts keep their archive-based window, not a time-based grace', () => {
  const late = at('2026-11-14T12:00:00+08:00');
  assert.equal(attendanceWindowOpen(blood(), [], late), true, 'late evidence before weekly archive');
  assert.equal(attendanceWindowOpen(blood({ bloodWeekArchive: true }), [], late), false);
  assert.equal(attendanceWindowOpen(blood(), [], at('2026-11-07T07:00:00+08:00')), false, 'before start');
});

test('legacy rows without a valid window stay open by status instead of blocking on-site check-in', () => {
  const legacy = { 活动ID: 'L', 状态: '进行中', 报名页配置: '{}' };
  assert.equal(attendanceWindowOpen(legacy, [], at('2026-11-07T12:00:00+08:00')), true);
});
