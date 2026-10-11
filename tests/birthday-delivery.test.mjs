import test from 'node:test';
import assert from 'node:assert/strict';
import { birthdayDeliveryQuota } from '../lib/community/birthday-delivery.js';

const recipient = { studentId: 'synthetic-recipient', day: '10-09', year: '2026', earned: 3, doneStatus: '已送达' };
const delivered = id => ({ 投稿ID: id, 收件人学号: recipient.studentId, 触发日期: recipient.day, 触发年份: recipient.year, 站内状态: recipient.doneStatus, 来源: '一对一匹配' });

test('partial persisted delivery resumes remaining quota and excludes completed blessings', () => {
  const result = birthdayDeliveryQuota([delivered('synthetic-one')], recipient);
  assert.equal(result.remaining, 2);
  assert.deepEqual([...result.completedSubmissionIds], ['synthetic-one']);
  assert.equal(birthdayDeliveryQuota([1, 2, 3].map(delivered), recipient).remaining, 0);
});

test('incomplete records, another recipient and previous birthdays do not spend current quota', () => {
  const rows = [
    { ...delivered('incomplete'), 站内状态: '待发送' },
    { ...delivered('other'), 收件人学号: 'synthetic-other' },
    { ...delivered('last-year'), 触发年份: '2025' },
  ];
  assert.equal(birthdayDeliveryQuota(rows, recipient).remaining, 3);
  assert.equal(birthdayDeliveryQuota([], { ...recipient, earned: 0 }).remaining, 1);
});
