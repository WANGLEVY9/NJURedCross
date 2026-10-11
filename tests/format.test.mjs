import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDate, date, dateTime, relative, daysUntil, dateRange, todayISO,
  int, dec, percent, ratio, signed,
  text, truncate, maskName, maskEmail, initials, shortCode,
  statusTone, priorityLabel,
} from '../public/app/core/format.js';

test('toDate accepts the shapes SeaTable returns and rejects everything else', () => {
  assert.ok(toDate('2026-10-20') instanceof Date);
  assert.ok(toDate('2026-10-20 14:30') instanceof Date);
  assert.ok(toDate('2026-10-20T14:30') instanceof Date);
  assert.equal(toDate('  '), null);
  assert.equal(toDate(null), null);
  assert.equal(toDate('not-a-date'), null);
  assert.equal(toDate(new Date('nonsense')), null);
});

test('a Date instance passes through unchanged', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  assert.equal(toDate(now), now);
});

test('date output is rendered in Asia/Shanghai', () => {
  assert.match(date('2026-10-20T16:30:00Z'), /2026/);
  assert.match(date('2026-10-20T16:30:00Z'), /10/);
  // 16:30Z is already the next day in Shanghai.
  assert.match(date('2026-10-20T16:30:00Z'), /21/);
});

test('unparseable values fall back to a placeholder', () => {
  assert.equal(date('nonsense'), '—');
  assert.equal(date(null, '待定'), '待定');
  assert.equal(dateTime('nonsense'), '—');
});

test('relative time picks the unit and the direction', () => {
  const now = Date.now();
  assert.equal(relative(new Date(now - 30_000)), '刚刚');
  assert.equal(relative(new Date(now - 5 * 60_000)), '5 分钟前');
  assert.equal(relative(new Date(now + 5 * 60_000)), '5 分钟后');
  assert.equal(relative(new Date(now - 2 * 3_600_000)), '2 小时前');
  assert.equal(relative(new Date(now - 3 * 86_400_000)), '3 天前');
  assert.equal(relative('nonsense'), '—');
});

test('far-past dates fall back to an absolute date', () => {
  assert.match(relative(new Date(Date.now() - 60 * 86_400_000)), /\d{4}/);
});

test('daysUntil is signed and null for unparseable input', () => {
  assert.equal(typeof daysUntil(new Date(Date.now() + 3 * 86_400_000)), 'number');
  assert.ok(daysUntil(new Date(Date.now() + 3 * 86_400_000)) >= 0);
  assert.ok(daysUntil(new Date(Date.now() - 3 * 86_400_000)) <= 0);
  assert.equal(daysUntil('nonsense'), null);
});

test('todayISO returns a calendar date in Shanghai', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

// Explicit instants keep Shanghai expectations independent of the runner timezone.
test('dateRange covers both ends, one end and neither', () => {
  assert.match(dateRange('2026-10-20T09:00:00+08:00', '2026-10-20T17:00:00+08:00'), /09:00/);
  assert.match(dateRange('2026-10-20T09:00:00+08:00', null), /09:00/);
  assert.match(dateRange(null, '2026-10-20T17:00:00+08:00'), /截至/);
  assert.equal(dateRange(null, null), '时间待定');
});

test('a same-day range collapses the repeated date', () => {
  const same = dateRange('2026-10-20T09:00:00+08:00', '2026-10-20T17:00:00+08:00');
  const across = dateRange('2026-10-20T09:00:00+08:00', '2026-10-21T17:00:00+08:00');
  assert.ok(same.length < across.length);
});

test('number formatting rounds, groups and clamps', () => {
  assert.equal(int(1234.6), '1,235');
  assert.equal(int('nonsense'), '0');
  assert.equal(dec(12.34), '12.3');
  assert.equal(percent(3, 4), '75%');
  assert.equal(percent(1, 0), '—');
  assert.equal(ratio(3, 4), 0.75);
  assert.equal(ratio(5, 4), 1);
  assert.equal(ratio(-1, 4), 0);
  assert.equal(ratio(1, 0), 0);
});

test('signed uses a typographic minus so it aligns in tables', () => {
  assert.equal(signed(5), '+5');
  assert.equal(signed(-5), '−5');
  assert.equal(signed(0), '0');
});

test('text and truncate handle blanks and length limits', () => {
  assert.equal(text('  '), '—');
  assert.equal(text(' 张三 '), '张三');
  assert.equal(truncate('x'.repeat(10), 5), 'xxxx…');
  assert.equal(truncate('short', 80), 'short');
});

test('masking keeps names and emails recognisable but not readable', () => {
  assert.equal(maskName(''), '未填写');
  assert.equal(maskName('张'), '张');
  assert.equal(maskName('张三'), '张＊');
  assert.equal(maskName('欧阳娜娜'), '欧＊＊＊');
  assert.equal(maskEmail(''), '未填写');
  assert.equal(maskEmail('nodomain'), '已隐藏');
  assert.equal(maskEmail('zhangsan@nju.edu.cn'), 'zh＊＊＊＊@nju.edu.cn');
  assert.equal(maskName('张三').endsWith('三'), false);
  assert.equal(maskEmail('zhangsan@nju.edu.cn').includes('zhangsan'), false);
});

test('initials prefer latin initials and fall back to the first character', () => {
  assert.equal(initials('Zhang San'), 'ZS');
  assert.equal(initials(''), '·');
  assert.equal(initials('张三'), '张');
  assert.equal(initials('Bob'), 'B');
});

test('shortCode keeps the prefix and the tail of opaque ids', () => {
  assert.equal(shortCode(''), '—');
  assert.equal(shortCode('NOT-1'), 'NOT-1');
  assert.equal(shortCode('RC-M-ABCDEFGH'), 'RC-…CDEFGH');
  assert.equal(shortCode('ABCDEFGHIJK'), 'ABCDEF…');
});

test('status tone maps business vocabulary to a semantic tone', () => {
  assert.equal(statusTone('已确认'), 'success');
  assert.equal(statusTone('逾期'), 'error');
  assert.equal(statusTone('已取消'), 'error');
  assert.equal(statusTone('待审核'), 'warning');
  assert.equal(statusTone('报名中'), 'info');
  assert.equal(statusTone('随便写的状态'), 'neutral');
});

test('priority labels fall back to an unsorted bucket', () => {
  assert.equal(priorityLabel('high'), '高优先级');
  assert.equal(priorityLabel('medium'), '需处理');
  assert.equal(priorityLabel('low'), '可稍后');
  assert.equal(priorityLabel('bogus'), '待分类');
});
