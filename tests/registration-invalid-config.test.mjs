import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistrationNotifications } from '../lib/events/registration-notifications.js';

// 生产上曾出现：某个活动的报名页配置不是合法 JSON，reconcile 直接抛 SyntaxError，
// 整个报名通知任务失败，其它活动的确认邮件也跟着停发。这里锁住"只跳过坏活动"。
function fixture() {
  const tasks = [{ _id: 'baseline', 幂等键: 'INIT:REGISTRATION-NOTIFICATIONS', 状态: '历史未补发' }];
  const base = {
    listRows: async () => structuredClone(tasks),
    appendRow: async (table, row) => {
      const saved = { ...row, _id: `task-${tasks.length}` };
      tasks.push(saved);
      return { _id: saved._id };
    },
    updateRow: async (table, id, patch) => { Object.assign(tasks.find(row => row._id === id), patch); },
  };
  const sent = [];
  const worker = () => createRegistrationNotifications(base, {
    origin: 'https://fixture.invalid',
    enabled: () => true,
    send: async message => { sent.push(message); return { ok: true, transport: 'smtp' }; },
  });
  return { tasks, sent, worker };
}

const registration = (id, eventId) => ({
  _id: id, 报名ID: id, 活动ID: eventId, 学号: '999999', 邮箱: '999999@smail.nju.edu.cn', 姓名: '合成同学',
  报名状态: '已确认', 是否报名成功: 'true', 请假状态: '', 报名日期: '2030-01-02', 报名时段: '09:00', 岗位: '引导',
});

test('a corrupt 报名页配置 only skips its own activity and keeps other confirmations flowing', async () => {
  const f = fixture();
  const bad = { _id: 'e-bad', 活动ID: 'event-bad', 活动名称: '合成坏配置活动', 报名页配置: '{"source":' };
  const good = { _id: 'e-good', 活动ID: 'event-good', 活动名称: '合成正常活动', 报名页配置: '{}' };
  await f.worker().reconcile({
    events: [bad, good],
    registrations: [registration('WR-bad', 'event-bad'), registration('WR-good', 'event-good')],
  });
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].text, /合成正常活动/);
  assert.equal(f.tasks.find(row => row.报名ID === 'WR-bad'), undefined);
});
