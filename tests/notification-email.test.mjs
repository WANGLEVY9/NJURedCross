import test from 'node:test';
import assert from 'node:assert/strict';
import { mailRecipient, mailRecipientFromRow, isValidDeliveryEmail, notificationEmailError, NOTIFICATION_EMAIL_MAX } from '../lib/identity/mail-recipient.js';
import { accountFromRow, createAccountRow } from '../lib/identity/store.js';
import { confirmationMessage } from '../lib/events/registration-notifications.js';
import { notificationPreflight } from '../lib/events/notification-preflight.js';

const campus = '230000001@smail.nju.edu.cn';

test('delivery helper prefers a valid member address and always falls back to the campus mailbox', () => {
  assert.equal(mailRecipient({ email: campus }), campus);
  assert.equal(mailRecipient({ email: campus, notificationEmail: '' }), campus);
  assert.equal(mailRecipient({ email: campus, notificationEmail: 'me@qq.com' }), 'me@qq.com');
  assert.equal(mailRecipient({ email: campus, notificationEmail: '  me@qq.com  ' }), 'me@qq.com');
  assert.equal(mailRecipient({ email: campus, notificationEmail: 'bad-address' }), campus);
  assert.equal(mailRecipient({ email: campus, notificationEmail: 'a@b.com\r\nBcc: x@y.com' }), campus);
  assert.equal(mailRecipient({ email: campus, notificationEmail: 'x'.repeat(NOTIFICATION_EMAIL_MAX + 1) + '@qq.com' }), campus);
  assert.equal(mailRecipient(null), '');
  assert.equal(mailRecipientFromRow({ '邮箱': campus, '收信邮箱': 'alt@163.com' }), 'alt@163.com');
  assert.equal(mailRecipientFromRow({ '邮箱': campus, '收信邮箱': '' }), campus);
});

test('form validation accepts an empty value and rejects malformed, long or non-string input', () => {
  assert.equal(notificationEmailError(''), '');
  assert.equal(notificationEmailError('  '), '');
  assert.equal(notificationEmailError('user@example.com'), '');
  assert.match(notificationEmailError('not-an-email'), /有效/);
  assert.match(notificationEmailError('a@b.com;c@d.com'), /有效/);
  assert.match(notificationEmailError('a@b.com'.padEnd(NOTIFICATION_EMAIL_MAX + 1, 'x')), /超过/);
  assert.match(notificationEmailError(42), /格式/);
  assert.equal(isValidDeliveryEmail('  a@b.com '), true);
});

test('account row reads and writes the delivery address without touching profile sync fields', async () => {
  const base = { '账号ID': 'ACC-1', '登录名': campus, '邮箱': campus, '密码哈希': 'hash', '邮箱已验证': '已验证', '收信邮箱': 'me@qq.com' };
  const account = accountFromRow(base);
  assert.equal(account.notificationEmail, 'me@qq.com');
  assert.equal(account.email, campus);
  assert.equal('contactEmail' in account, false, 'retired contact email must not be exposed');
  assert.equal(accountFromRow({ ...base, '收信邮箱': '' }).notificationEmail, '');
  const writes = [];
  const client = { appendRow: async (table, row) => { writes.push({ table, row }); return { _id: 'row-1' }; } };
  await createAccountRow(client, { login: campus, email: campus, passwordHash: 'hash', role: 'member', notificationEmail: 'me@qq.com' });
  assert.equal(writes[0].row['收信邮箱'], 'me@qq.com');
  await createAccountRow(client, { login: campus, email: campus, passwordHash: 'hash', role: 'member' });
  assert.equal('收信邮箱' in writes[1].row, false, 'blank preference must not write an empty column');
});

const event = { _id: 'evt', '活动ID': 'ACT-1', '活动名称': '合成献血周', '地点': '仙林', '报名日期': '2030-01-01', '报名时段': '上午' };
const row = { _id: 'reg', '活动ID': 'ACT-1', '报名ID': 'WR-1', '账号ID': 'ACC-1', '学号': '230000001', '姓名': '合成同学', '邮箱': campus, '报名日期': '2030-01-01', '报名时段': '上午', '报名状态': '已确认', '是否报名成功': true, '岗位': '服务岗' };

test('registration confirmation keeps the verified identity check but delivers to the configured mailbox', () => {
  const origin = 'https://example.test';
  assert.equal(confirmationMessage(event, row, origin).to, campus);
  assert.equal(confirmationMessage(event, row, origin, 'me@qq.com').to, 'me@qq.com');
  assert.equal(confirmationMessage(event, row, origin, 'bad').to, campus);
  assert.throws(() => confirmationMessage(event, { ...row, '邮箱': 'other@example.test' }, origin, 'me@qq.com'), /verified participant address/);
});

test('directory preflight exposes the configured mailbox while still requiring a verified account', () => {
  const accounts = [{ accountId: 'ACC-1', email: campus, emailVerified: true, status: '启用', notificationEmail: 'me@qq.com' }];
  assert.equal(notificationPreflight([event], [row], accounts)[0].email, 'me@qq.com');
  assert.ok(notificationPreflight([event], [row], [{ ...accounts[0], emailVerified: false }])[0].reason);
  const invalid = [{ ...accounts[0], notificationEmail: 'broken' }];
  assert.equal(notificationPreflight([event], [row], invalid)[0].email, campus);
});
