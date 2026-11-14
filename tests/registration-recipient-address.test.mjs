import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistrationNotifications } from '../lib/events/registration-notifications.js';

// 平台允许会员另配「收信邮箱」。投递必须走它，但收件人不该被拿去和校园邮箱比对：
// 原实现那样比，会让所有配了收信邮箱的报名永久停在「结果待核对」，一封信都发不出去。
function fixture(recipientFor, enabled = () => true) {
  const tasks = [{ _id: 'baseline', 幂等键: 'INIT:REGISTRATION-NOTIFICATIONS', 状态: '历史未补发' }];
  const base = {
    listRows: async () => structuredClone(tasks),
    appendRow: async (_t, row) => {
      const saved = { ...row, _id: `task-${tasks.length}` };
      tasks.push(saved);
      return { _id: saved._id };
    },
    updateRow: async (_t, id, patch) => { Object.assign(tasks.find(row => row._id === id), patch); },
  };
  const sent = [];
  const worker = createRegistrationNotifications(base, {
    origin: 'https://fixture.invalid',
    enabled,
    recipientFor,
    send: async message => { sent.push(message); return { ok: true, transport: 'smtp' }; },
  });
  return { tasks, sent, worker };
}

const event = { _id: 'e-1', 活动ID: 'event-1', 活动名称: '合成活动', 报名页配置: '{}' };
const registration = (id, patch = {}) => ({
  _id: id, 报名ID: id, 活动ID: 'event-1', 账号ID: 'acc-1', 学号: '999999',
  邮箱: '999999@smail.nju.edu.cn', 姓名: '合成同学', 报名状态: '已确认',
  是否报名成功: 'true', 请假状态: '', 报名日期: '2030-01-02', 报名时段: '09:00', 岗位: '引导',
  ...patch,
});

test('a configured delivery address is used and still gets delivered', async () => {
  const f = fixture(() => 'backup@example.test');
  await f.worker.reconcile({ events: [event], registrations: [registration('WR-1')] });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, 'backup@example.test');
  assert.equal(f.tasks.find(row => row.报名ID === 'WR-1').状态, '已发送');
});

test('an invalid delivery address falls back to the campus mailbox', async () => {
  const f = fixture(() => 'not-an-address');
  await f.worker.reconcile({ events: [event], registrations: [registration('WR-2')] });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, '999999@smail.nju.edu.cn');
});

test('changing the delivery address of an unattempted task redirects it instead of stranding it', async () => {
  let address = 'first@example.test';
  let allow = false;
  const f = fixture(() => address, () => allow);

  // 第一轮只入队不投递（开关关闭），任务停在「待发送」。
  await f.worker.reconcile({ events: [event], registrations: [registration('WR-3')] });
  assert.equal(f.sent.length, 0);
  assert.equal(f.tasks.find(row => row.报名ID === 'WR-3').收件人, 'first@example.test');

  // 改收信邮箱后开启投递：未尝试过的任务应改投新地址，而不是被判「结果待核对」。
  address = 'second@example.test';
  allow = true;
  await f.worker.reconcile({ events: [event], registrations: [registration('WR-3')] });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, 'second@example.test');
  assert.equal(f.tasks.find(row => row.报名ID === 'WR-3').状态, '已发送');
});
