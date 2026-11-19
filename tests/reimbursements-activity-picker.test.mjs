import test from 'node:test';
import assert from 'node:assert/strict';
import { reimbursementCampus, recentReimbursementActivities } from '../public/app/shared/reimbursement-activities.js';

test('activity campus groups the three Nanjing campuses without guessing missing metadata', () => {
  for (const value of ['南京', '仙林校区', '鼓楼', '浦口']) assert.equal(reimbursementCampus(value), '南京');
  assert.equal(reimbursementCampus('苏州校区'), '苏州');
  for (const value of ['', undefined, '未知校区']) assert.equal(reimbursementCampus(value), '');
});
test('shifts sharing a name and a date are ordered by slot so the picker reads 10:00 before 13:00', () => {
  const shift = (id, timeSlot) => ({ id, name: '市血液献血车 · 第51周 · 新街口印象汇', date: '2026-10-27', timeSlot, campus: '南京' });
  const sorted = recentReimbursementActivities([shift('afternoon', '13:00'), shift('morning', '10:00')], new Date('2026-10-27T00:00:00Z'));
  assert.deepEqual(sorted.map(row => row.timeSlot), ['10:00', '13:00']);
  // 只登记了日期的班次（时段为空）稳定排在有时段的前面，避免同日同名的条目交替出现。
  const mixed = recentReimbursementActivities([shift('timed', '09:00'), shift('untimed', '')], new Date('2026-10-27T00:00:00Z'));
  assert.deepEqual(mixed.map(row => row.id), ['untimed', 'timed']);
});

test('recent catalogue uses Shanghai calendar days, includes the boundary, and never falls back to old or future activities', () => {
  const row = (id, date, campus = '苏州') => ({ id, name: id, date, campus });
  const activities = [row('today', '2026-10-27'), row('boundary', '2026-09-27'), row('old', '2026-09-26'),
    row('future', '2026-10-28'), row('missing-date', ''), row('missing-campus', '2026-10-27', ''), row('nanjing', '2026-10-26', '仙林')];
  assert.deepEqual(recentReimbursementActivities(activities, new Date('2026-10-26T16:01:00Z')).map(row => row.id), ['today', 'nanjing', 'boundary']);
  assert.deepEqual(recentReimbursementActivities([activities[2]], new Date('2026-10-27T00:00:00Z')), []);
  assert.equal(activities[0].id, 'today');
});
