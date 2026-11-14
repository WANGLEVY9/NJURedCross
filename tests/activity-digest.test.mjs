/**
 * 活动待办汇总（08:00 / 20:00）——领域层单测。
 *
 * 覆盖：哪些活动/报名会进汇总、按负责人归集、与宣传待办合并成一人一封、
 * 文案与类型码。不触网、不读 SeaTable。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_DIGEST_STATUSES,
  beijingTimeLabel,
  buildActivityDigest,
} from '../lib/events/activity-digest.js';
import {
  buildDigest,
  digestKindOf,
  digestMailText,
  digestSlot,
  digestSubject,
  mergeDigestRecipients,
  sendDigest,
} from '../lib/attachment/digest.js';

/* ------------------------------- 夹具 ------------------------------- */

const OWNER = {
  accountId: 'ACC-OWNER', username: 'owner', realName: '王诺',
  email: 'wang@example.invalid', emailVerified: true, status: '启用', studentId: '241820199',
};
const CO_OWNER = {
  accountId: 'ACC-CO', username: 'co', realName: '陈嘉铭',
  email: 'chen@example.invalid', emailVerified: true, status: '启用', studentId: '502024080002',
};
const ACCOUNTS = [OWNER, CO_OWNER];

function event(overrides = {}) {
  return {
    活动ID: 'ACT-1',
    活动名称: '苏州校区无偿献血周',
    活动类别: '献血服务',
    状态: '报名中',
    报名日期: '2026-11-20',
    报名时段: '08:00-12:00',
    负责人账号ID: 'ACC-OWNER',
    报名页配置: '{}',
    ...overrides,
  };
}

function registration(overrides = {}) {
  return {
    报名ID: 'REG-1',
    活动ID: 'ACT-1',
    账号ID: 'ACC-P1',
    姓名: '张三',
    报名状态: '待筛选',
    请假状态: '',
    创建时间: '2026-11-13T02:00:00.000Z',
    ...overrides,
  };
}

const LIAISON = {
  对接人ID: 'LIA-1', 姓名: '王诺', 负责栏目: '活动预热',
  角色: '对接人', 邮箱: 'wang@example.invalid', 启用: '是',
};

/* --------------------------- 哪些活动会进 --------------------------- */

test('buildActivityDigest：只统计报名中 / 进行中的活动', () => {
  assert.deepEqual([...ACTIVITY_DIGEST_STATUSES], ['报名中', '进行中']);

  for (const status of ['已结束', '已归档', '草稿', '待配置', '待审核', '可发布']) {
    const recipients = buildActivityDigest({
      events: [event({ 状态: status })],
      registrations: [registration()],
      accounts: ACCOUNTS,
    });
    assert.deepEqual(recipients, [], `${status} 不该产生待办`);
  }

  const live = buildActivityDigest({
    events: [event({ 状态: '进行中' })],
    registrations: [registration()],
    accounts: ACCOUNTS,
  });
  assert.equal(live.length, 1);
});

test('buildActivityDigest：没有待办的活动不发信', () => {
  const recipients = buildActivityDigest({
    events: [event()],
    registrations: [
      registration({ 报名状态: '已确认' }),
      registration({ 报名ID: 'REG-2', 报名状态: '已签到' }),
      registration({ 报名ID: 'REG-3', 报名状态: '未入选' }),
      registration({ 报名ID: 'REG-4', 报名状态: '已请假' }),
      registration({ 报名ID: 'REG-5', 报名状态: '已确认', 请假状态: '已批准' }),
      registration({ 报名ID: 'REG-6', 报名状态: '已确认', 请假状态: '已驳回' }),
    ],
    accounts: ACCOUNTS,
  });
  assert.deepEqual(recipients, []);
});

/* ----------------------------- 待办口径 ----------------------------- */

test('buildActivityDigest：待筛选算报名待确认，待审批算请假待审批', () => {
  const [recipient] = buildActivityDigest({
    events: [event()],
    registrations: [
      registration(),
      registration({ 报名ID: 'REG-2', 姓名: '李四' }),
      registration({ 报名ID: 'REG-3', 姓名: '赵六', 报名状态: '已确认', 请假状态: '待审批', 请假申请时间: '2026-11-14T01:20:00.000Z' }),
    ],
    accounts: ACCOUNTS,
  });
  assert.equal(recipient.email, OWNER.email);
  assert.equal(recipient.roles.includes('activity-owner'), true);
  assert.equal(recipient.items.length, 1, '一个活动只出一条待办');

  const [item] = recipient.items;
  assert.deepEqual(item.counts, { review: 2, leave: 1 });
  assert.ok(item.detailLines[0].startsWith('待确认报名 2 人：张三、李四'));
  assert.ok(item.detailLines[1].startsWith('待审批请假 1 条：赵六（11-14 09:20 申请）'));
});

test('buildActivityDigest：请假待审批时不再重复计入待确认报名', () => {
  // decideLeave 之前业务上不允许处理这条报名的录取结果，所以它只算一件待办。
  const [recipient] = buildActivityDigest({
    events: [event()],
    registrations: [registration({ 请假状态: '待审批', 请假申请时间: '2026-11-14T01:20:00.000Z' })],
    accounts: ACCOUNTS,
  });
  assert.deepEqual(recipient.items[0].counts, { review: 0, leave: 1 });
  assert.equal(recipient.items[0].detailLines.length, 1);
});

test('buildActivityDigest：姓名样例超量折叠，不把 200 人写进邮件', () => {
  const registrations = Array.from({ length: 12 }, (_, index) => registration({
    报名ID: `REG-${index}`,
    姓名: `同学${index}`,
  }));
  const [recipient] = buildActivityDigest({ events: [event()], registrations, accounts: ACCOUNTS });
  assert.ok(recipient.items[0].detailLines[0].includes('待确认报名 12 人：同学0、同学1、同学2、同学3 等 12 人'));
});

/* ----------------------------- 负责人解析 ----------------------------- */

test('buildActivityDigest：负责人含 coOwners，停用/未验证账号不发', () => {
  const recipients = buildActivityDigest({
    events: [event({ 报名页配置: JSON.stringify({ coOwners: ['ACC-CO'] }) })],
    registrations: [registration()],
    accounts: ACCOUNTS,
  });
  assert.deepEqual(recipients.map((row) => row.email).sort(), [CO_OWNER.email, OWNER.email].sort());

  const unverified = buildActivityDigest({
    events: [event()],
    registrations: [registration()],
    accounts: [{ ...OWNER, emailVerified: false }],
  });
  assert.deepEqual(unverified, [], '邮箱未验证不发');

  const disabled = buildActivityDigest({
    events: [event()],
    registrations: [registration()],
    accounts: [{ ...OWNER, status: '停用' }],
  });
  assert.deepEqual(disabled, [], '账号停用不发');
});

test('buildActivityDigest：负责人邮箱不可用时记入 stats，不静默丢', () => {
  const stats = { unownedEvents: 0, unowned: 0 };
  const recipients = buildActivityDigest({
    events: [event()],
    registrations: [registration(), registration({ 报名ID: 'REG-2', 姓名: '李四' })],
    accounts: [],
    stats,
  });
  assert.deepEqual(recipients, []);
  assert.deepEqual(stats, { unownedEvents: 1, unowned: 2 });
});

test('buildActivityDigest：收信邮箱优先，缺失回退校园邮箱', () => {
  const [recipient] = buildActivityDigest({
    events: [event()],
    registrations: [registration()],
    accounts: [{ ...OWNER, notificationEmail: 'notify@example.invalid' }],
  });
  assert.equal(recipient.email, 'notify@example.invalid');
});

test('buildActivityDigest：一人负责多个活动时各出一条，等得久的在前', () => {
  const [recipient] = buildActivityDigest({
    events: [event(), event({ 活动ID: 'ACT-2', 活动名称: '献血车志愿服务' })],
    registrations: [
      registration({ 创建时间: '2026-11-14T02:00:00.000Z' }),
      registration({ 报名ID: 'REG-2', 活动ID: 'ACT-2', 创建时间: '2026-11-10T02:00:00.000Z' }),
    ],
    accounts: ACCOUNTS,
  });
  assert.equal(recipient.items.length, 2);
  assert.deepEqual(recipient.items.map((item) => item.title), ['献血车志愿服务', '苏州校区无偿献血周']);
});

test('buildActivityDigest：同一活动组的多个班次合并成一条', () => {
  // 献血周这类活动按班次建行，一个活动组会有多个活动ID；逐条列会变成五条同名待办。
  const [recipient] = buildActivityDigest({
    events: [
      event({ 活动ID: 'ACT-1', 报名时段: '08:00:00-12:00:00' }),
      event({ 活动ID: 'ACT-2', 报名时段: '13:00:00-17:00:00' }),
      event({ 活动ID: 'ACT-3', 报名时段: '18:00:00-20:00:00' }),
    ],
    registrations: [
      registration({ 活动ID: 'ACT-1' }),
      registration({ 报名ID: 'REG-2', 活动ID: 'ACT-2', 姓名: '李四' }),
      registration({ 报名ID: 'REG-3', 活动ID: 'ACT-3', 姓名: '王五' }),
    ],
    accounts: ACCOUNTS,
  });
  assert.equal(recipient.items.length, 1, '同名活动只留一条');
  const [item] = recipient.items;
  assert.equal(item.sessions.length, 3);
  assert.equal(item.schedule, '2026-11-20 共 3 个班次');
  assert.equal(item.counts.review, 3);
  assert.ok(item.detailLines[0].includes('待确认报名 3 人：张三、李四、王五'));
});

/* ------------------------ 与宣传待办合并成一封 ------------------------ */

function outreachRecipients() {
  return buildDigest({
    rows: [{
      投稿ID: 'SUB-1', 来源: '公众投稿', 标题: '献血周预热', 类别: '文字稿件',
      推文类别: '活动预热', 审核状态: '待审核', 审核层级: '0', 审核轨迹: '[]',
      提交时间: '2026-11-10T00:00:00.000Z', 联系邮箱: 'reader@example.invalid',
    }],
    assignees: [{ ...LIAISON }, {
      对接人ID: 'LIA-2', 姓名: '汤艺暄', 负责栏目: '活动预热', 角色: '审核人', 邮箱: 'tang@example.invalid', 启用: '是',
    }],
  });
}

test('mergeDigestRecipients：同一人既管宣传又管活动时只留一封', () => {
  const activity = buildActivityDigest({
    events: [event()],
    registrations: [registration()],
    accounts: ACCOUNTS,
  });
  const merged = mergeDigestRecipients(outreachRecipients(), activity);

  const wang = merged.find((row) => row.email === LIAISON.邮箱);
  assert.equal(wang.items.length, 2, '宣传一条 + 活动一条');
  assert.deepEqual([...wang.roles].sort(), ['activity-owner', 'liaison']);
  assert.equal(merged.filter((row) => row.email === LIAISON.邮箱).length, 1);

  // 合并结果里的条目按「同类型同 ID」去重，重复传同一份不会翻倍。
  const twice = mergeDigestRecipients(activity, activity);
  assert.equal(twice[0].items.length, 1);
});

test('汇总文案：活动段写明状态、时段、待办明细与控制台入口', () => {
  const slot = digestSlot(new Date('2026-11-11T12:00:00.000Z'));
  const activity = buildActivityDigest({
    events: [event()],
    registrations: [
      registration(),
      registration({ 报名ID: 'REG-2', 姓名: '赵六', 报名状态: '已确认', 请假状态: '待审批', 请假申请时间: '2026-11-14T01:20:00.000Z' }),
    ],
    accounts: ACCOUNTS,
  });
  const [recipient] = mergeDigestRecipients(activity);

  const subject = digestSubject({ slot, count: recipient.items.length, recipient });
  assert.match(subject, /【活动待办·晚间汇总】1 条（11-11 20:00）/);

  const text = digestMailText({ recipient, slot, baseUrl: 'https://njuredcross.cn/', now: new Date('2026-11-14T12:00:00.000Z') });
  assert.ok(text.includes('王诺，你好：'));
  assert.ok(text.includes('【活动待办】'));
  assert.ok(text.includes('《苏州校区无偿献血周》｜献血服务｜报名中｜2026-11-20 08:00-12:00'));
  assert.ok(text.includes('已等待 1 天'));
  assert.ok(text.includes('待确认报名 1 人：张三'));
  assert.ok(text.includes('待审批请假 1 条：赵六（11-14 09:20 申请）'));
  assert.ok(text.includes('https://njuredcross.cn/console/events'));
  assert.ok(!text.includes('/console/outreach'), '只有活动待办时不附宣传入口');
});

test('汇总文案：两类待办同封时同时给出两个入口，主题升级为红会待办', () => {
  const slot = digestSlot(new Date('2026-11-11T00:00:00.000Z'));
  const activity = buildActivityDigest({ events: [event()], registrations: [registration()], accounts: ACCOUNTS });
  const [recipient] = mergeDigestRecipients(outreachRecipients(), activity)
    .filter((row) => row.email === LIAISON.邮箱);

  const subject = digestSubject({ slot, count: recipient.items.length, recipient });
  assert.match(subject, /【红会待办·早间汇总】2 条/);

  const text = digestMailText({ recipient, slot, baseUrl: 'https://njuredcross.cn' });
  assert.ok(text.includes('【待你审核】'));
  assert.ok(text.includes('【活动待办】'));
  assert.ok(text.includes('· 宣传审核：https://njuredcross.cn/console/outreach'));
  assert.ok(text.includes('· 活动报名与请假：https://njuredcross.cn/console/events'));
});

test('digestKindOf：活动类型码仍在 outreach.digest.* 前缀下', () => {
  assert.equal(digestKindOf({ roles: ['activity-owner'] }), 'outreach.digest.activity');
  assert.equal(digestKindOf({ roles: ['liaison', 'activity-owner'] }), 'outreach.digest.both');
  // 只有宣传角色时保持原样，历史发件记录与重试白名单都认这两个。
  assert.equal(digestKindOf({ roles: ['liaison', 'reviewer'] }), 'outreach.digest.mixed');
  assert.equal(digestKindOf({ roles: ['reviewer'] }), 'outreach.digest.reviewer');
  assert.equal(digestKindOf({ roles: ['liaison'] }), 'outreach.digest.liaison');
});

test('sendDigest：活动收件人同样一人一封，幂等键带时段与邮箱', async () => {
  const slot = digestSlot(new Date('2026-11-11T00:00:00.000Z'));
  const recipients = buildActivityDigest({
    events: [event()],
    registrations: [registration()],
    accounts: ACCOUNTS,
  });
  const sent = [];
  const results = await sendDigest({
    mail: async (message) => { sent.push(message); return { ok: true, transport: 'smtp' }; },
    recipients,
    slot,
    baseUrl: 'https://njuredcross.cn',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(sent[0].kind, 'outreach.digest.activity');
  assert.equal(sent[0].idempotencyKey, `outreach-digest-2026-11-11-08-${OWNER.email}`);
  assert.ok(sent[0].subject.includes('活动待办'));
  assert.equal(sent[0].attachments, undefined, '活动待办没有附件');
});

test('beijingTimeLabel：UTC 存储按北京时间展示', () => {
  assert.equal(beijingTimeLabel('2026-11-14T01:20:00.000Z'), '11-14 09:20');
  assert.equal(beijingTimeLabel('2026-11-14T16:05:00.000Z'), '11-15 00:05');
  assert.equal(beijingTimeLabel(''), '');
  assert.equal(beijingTimeLabel('not-a-date'), '');
});
