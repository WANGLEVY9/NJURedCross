import test from 'node:test';
import assert from 'node:assert/strict';
import { reimbursementCampus, recentReimbursementActivities } from '../public/app/shared/reimbursement-activities.js';

test('activity campus groups the three Nanjing campuses without guessing missing metadata', () => {
  for (const value of ['南京', '仙林校区', '鼓楼', '浦口']) assert.equal(reimbursementCampus(value), '南京');
  assert.equal(reimbursementCampus('苏州校区'), '苏州');
  for (const value of ['', undefined, '未知校区']) assert.equal(reimbursementCampus(value), '');
});
test('recent catalogue uses Shanghai calendar days, includes the boundary, and never falls back to old or future activities', () => {
  const row = (id, date, campus = '苏州') => ({ id, name: id, date, campus });
  const activities = [row('today', '2026-10-27'), row('boundary', '2026-09-27'), row('old', '2026-09-26'),
    row('future', '2026-10-28'), row('missing-date', ''), row('missing-campus', '2026-10-27', ''), row('nanjing', '2026-10-26', '仙林')];
  assert.deepEqual(recentReimbursementActivities(activities, new Date('2026-10-26T16:01:00Z')).map(row => row.id), ['today', 'nanjing', 'boundary']);
  assert.deepEqual(recentReimbursementActivities([activities[2]], new Date('2026-10-27T00:00:00Z')), []);
  assert.equal(activities[0].id, 'today');
});
