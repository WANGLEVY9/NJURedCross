import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistrationCounter } from '../lib/events/registration-counts.js';

test('confirmed and checked-in count as confirmed; only pending selection counts as pending', () => {
  const rows = ['已确认', '已签到', '待筛选', '未入选', '已请假', '已取消', '候补', ''].map(status => ({ 活动ID: 'a', 报名状态: status }));
  assert.deepEqual(createRegistrationCounter(rows)(['a']), { confirmed: 2, pending: 1 });
});
test('combines source activities without double counting repeated source IDs', () => {
  const count = createRegistrationCounter([
    { 活动ID: 'a', 报名状态: '已确认' }, { 活动ID: 'b', 报名状态: '待筛选' },
    { 活动ID: 'c', 报名状态: '已确认' },
  ]);
  assert.deepEqual(count(['a', 'b', 'a', 'b']), { confirmed: 1, pending: 1 });
});
test('preserves strict identity matching, including numeric and missing activity IDs', () => {
  const count = createRegistrationCounter([
    { 活动ID: 1, 报名状态: '已确认' }, { 活动ID: '1', 报名状态: '待筛选' },
    { 报名状态: '已签到' }, { 活动ID: '', 报名状态: '待筛选' },
  ]);
  assert.deepEqual(count([1]), { confirmed: 1, pending: 0 });
  assert.deepEqual(count(['1']), { confirmed: 0, pending: 1 });
  assert.deepEqual(count([undefined]), { confirmed: 1, pending: 0 });
  assert.deepEqual(count(['']), { confirmed: 0, pending: 1 });
});
test('does not deduplicate distinct registration rows or expose identity data', () => {
  const rows = [{ 活动ID: 'a', 报名状态: '已确认', 邮箱: 'synthetic@example.invalid' }];
  const original = JSON.stringify(rows);
  const count = createRegistrationCounter([rows[0], rows[0]]);
  const result = count(['a']);
  assert.deepEqual(result, { confirmed: 2, pending: 0 });
  result.confirmed = 99;
  assert.equal(count(['a']).confirmed, 2);
  assert.equal(JSON.stringify(rows), original);
});
test('matches the existing filtering rule across mixed activities and statuses', () => {
  const statuses = ['已确认', '已签到', '待筛选', '已取消', '已请假', '未入选'];
  const rows = Array.from({ length: 2000 }, (_, i) => ({ 活动ID: `event-${i % 37}`, 报名状态: statuses[i % statuses.length] }));
  const count = createRegistrationCounter(rows);
  for (let i = 0; i < 37; i++) {
    const ids = [`event-${i}`, `event-${(i + 3) % 37}`, `event-${i}`];
    const own = rows.filter(row => ids.includes(row['活动ID']));
    assert.deepEqual(count(ids), {
      confirmed: own.filter(row => ['已确认', '已签到'].includes(row['报名状态'])).length,
      pending: own.filter(row => row['报名状态'] === '待筛选').length,
    });
  }
});
test('repeated activity queries do not rescan the registration rows', () => {
  let reads = 0;
  const rows = Array.from({ length: 1000 }, (_, i) => ({ get 活动ID() { reads++; return `a-${i % 10}`; }, 报名状态: '已确认' }));
  const count = createRegistrationCounter(rows);
  assert.equal(reads, 1000);
  for (let i = 0; i < 100; i++) assert.equal(count(['a-0']).confirmed, 100);
  assert.equal(reads, 1000);
});
test('empty input and unmatched activities return zero counts', () => {
  const count = createRegistrationCounter([]);
  assert.deepEqual(count([]), { confirmed: 0, pending: 0 });
  assert.deepEqual(count(['missing']), { confirmed: 0, pending: 0 });
});
