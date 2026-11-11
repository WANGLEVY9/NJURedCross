/**
 * 宣传审核待办汇总（08:00 / 20:00）——领域层单测。
 *
 * 覆盖：时区与时段判定、按责任环节归集、各类稿件该不该进汇总、
 * 汇总文案与投递幂等键。不触网、不读 SeaTable。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIGEST_HOURS,
  buildDigest,
  digestKindOf,
  digestMailText,
  digestSlot,
  digestSubject,
  sendDigest,
  waitingLabel,
} from '../lib/attachment/digest.js';

/* ------------------------------- 夹具 ------------------------------- */

const LIAISON = {
  对接人ID: 'LIA-1', 姓名: '王诺', 负责栏目: '活动预热',
  角色: '对接人', 邮箱: 'wang@example.invalid', 启用: '是',
};
const REVIEWER = {
  对接人ID: 'LIA-2', 姓名: '汤艺暄', 负责栏目: '活动预热',
  角色: '审核人', 邮箱: 'tang@example.invalid', 启用: '是',
};
const ASSIGNEES = [LIAISON, REVIEWER];

/** 待初审：还没走过任何一级。 */
function pendingRow(overrides = {}) {
  return {
    投稿ID: 'SUB-1',
    来源: '公众投稿',
    标题: '献血周预热',
    类别: '文字稿件',
    推文类别: '活动预热',
    审核状态: '待审核',
    审核层级: '0',
    审核轨迹: '[]',
    提交时间: '2026-11-10T00:00:00.000Z',
    联系邮箱: 'reader@example.invalid',
    ...overrides,
  };
}

/* ----------------------------- 时段判定 ----------------------------- */

test('digestSlot：只在北京时间 08 点与 20 点这一小时命中', () => {
  assert.deepEqual([...DIGEST_HOURS], [8, 20]);

  // 服务器是 UTC，08:00 北京时间 = 00:00Z。
  const morning = digestSlot(new Date('2026-11-11T00:00:00.000Z'));
  assert.equal(morning.key, '2026-11-11-08');
  assert.equal(morning.label, '早间汇总');
  assert.equal(morning.at, '2026-11-11 08:00');

  const evening = digestSlot(new Date('2026-11-11T12:30:00.000Z'));
  assert.equal(evening.key, '2026-11-11-20');
  assert.equal(evening.label, '晚间汇总');

  // 北京时间 07:59 与 21:00 都不发。
  assert.equal(digestSlot(new Date('2026-11-10T23:59:00.000Z')), null);
  assert.equal(digestSlot(new Date('2026-11-11T13:00:00.000Z')), null);
  assert.equal(digestSlot(new Date('invalid')), null);
});

test('digestSlot：日期按北京日归段，不按 UTC 日', () => {
  // 北京 11-10 20:00 = UTC 11-10 12:00（同一天，容易掩盖时区错误）
  assert.equal(digestSlot(new Date('2026-11-10T12:00:00.000Z')).key, '2026-11-10-20');
  // 北京 11-11 00:30 = UTC 11-10 16:30：UTC 还在 10 号，北京已经翻到 11 号，但不属于汇总时点
  assert.equal(digestSlot(new Date('2026-11-10T16:30:00.000Z')), null);
  // 北京 11-11 08:00 = UTC 11-11 00:00
  assert.equal(digestSlot(new Date('2026-11-11T00:00:00.000Z')).date, '2026-11-11');
});

/* ----------------------------- 待办归集 ----------------------------- */

test('buildDigest：待初审进对接人，待复核进审核人', () => {
  const first = buildDigest({ rows: [pendingRow()], assignees: ASSIGNEES });
  assert.equal(first.length, 1);
  assert.equal(first[0].email, LIAISON.邮箱);
  assert.equal(first[0].name, '王诺');
  assert.deepEqual(first[0].roles, ['liaison']);
  assert.equal(first[0].items[0].type, 'review');
  assert.equal(first[0].items[0].level, 1);
  assert.equal(first[0].items[0].category, '活动预热');

  // 初审通过后，待办移到审核人，对接人这一封不该再出现这条。
  const second = buildDigest({
    rows: [pendingRow({
      审核层级: '1',
      审核轨迹: JSON.stringify([{ level: 1, name: '对接人初审', decision: 'approve', at: '2026-11-10T02:00:00.000Z' }]),
    })],
    assignees: ASSIGNEES,
  });
  assert.equal(second.length, 1);
  assert.equal(second[0].email, REVIEWER.邮箱);
  assert.deepEqual(second[0].roles, ['reviewer']);
  assert.equal(second[0].items[0].level, 2);
});

test('buildDigest：终审通过且未排期 → 对接人「待排期」；已排期/已退回不发', () => {
  const approved = pendingRow({
    审核状态: '已通过',
    审核层级: '2',
    审核轨迹: JSON.stringify([
      { level: 1, name: '对接人初审', decision: 'approve', at: '2026-11-09T02:00:00.000Z' },
      { level: 2, name: '审核人终审', decision: 'approve', at: '2026-11-10T02:00:00.000Z' },
    ]),
  });

  const waiting = buildDigest({ rows: [approved], assignees: ASSIGNEES });
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].email, LIAISON.邮箱);
  assert.equal(waiting[0].items[0].type, 'schedule');
  assert.equal(waiting[0].items[0].level, 0);

  // 已有发布任务 → 不再催排期。
  const scheduled = buildDigest({
    rows: [approved],
    assignees: ASSIGNEES,
    publications: { 'SUB-1': { taskId: 'PUB-1', status: '待发布' } },
  });
  assert.equal(scheduled.length, 0);

  // 已退回：球在作者脚下，对接人这里没有动作。
  const returned = buildDigest({
    rows: [pendingRow({ 审核状态: '已退回' })],
    assignees: ASSIGNEES,
  });
  assert.equal(returned.length, 0);
});

test('buildDigest：文创设计不挂栏目也能找到对接人；无邮箱的人直接跳过', () => {
  const design = buildDigest({
    rows: [pendingRow({ 投稿ID: 'DSN-1', 类别: '文创设计', 推文类别: '' })],
    assignees: ASSIGNEES,
  });
  assert.equal(design.length, 1, '栏目为空时按「该角色唯一在岗者」兜底');
  assert.equal(design[0].items[0].category, '文创设计（不挂栏目）');

  const noMail = buildDigest({
    rows: [pendingRow()],
    assignees: [{ ...LIAISON, 邮箱: '' }, { ...REVIEWER, 邮箱: '' }],
  });
  assert.equal(noMail.length, 0, '对接人表没邮箱时不能凭空造一个收件人');
});

test('buildDigest：选人走 reviewScopeOf，文创设计与「全部」通配都要能命中（#69 对齐）', () => {
  // 对接人表补了「文创设计」作用域行 → 必须精确命中那一行，而不是「唯一在岗者」兜底。
  const designOwner = {
    ...LIAISON, 对接人ID: 'LIA-9', 姓名: '文创对接', 负责栏目: '文创设计', 邮箱: 'design@example.invalid',
  };
  const exact = buildDigest({
    rows: [pendingRow({ 投稿ID: 'DSN-2', 类别: '文创设计', 推文类别: '' })],
    assignees: [...ASSIGNEES, designOwner],
  });
  assert.deepEqual(exact.map((item) => item.email), ['design@example.invalid']);

  // 「全部」通配行接住任意栏目，不能被精确行挤掉或反过来挤掉精确行。
  const wildcard = {
    ...LIAISON, 对接人ID: 'LIA-ALL', 姓名: '总值', 负责栏目: '全部', 邮箱: 'all@example.invalid',
  };
  const viaAny = buildDigest({
    rows: [pendingRow({ 推文类别: '今日节日' })],
    assignees: [...ASSIGNEES, wildcard],
  });
  assert.deepEqual(viaAny.map((item) => item.email), ['all@example.invalid']);
});

test('buildDigest：既有内容的审核结论不算待办（不走 v3 审核链）', () => {
  const legacy = pendingRow({
    投稿ID: 'planning:abc',
    来源: '遗留内容',
    类别: '策划案',
    推文类别: '活动预热',
    审核状态: '已通过',
  });
  assert.equal(buildDigest({ rows: [legacy], assignees: ASSIGNEES }).length, 0);
  // 老数据没有「来源」列时按公众投稿处理，不能因此漏掉真实待办。
  const noSource = { ...pendingRow() };
  delete noSource.来源;
  assert.equal(buildDigest({ rows: [noSource], assignees: ASSIGNEES }).length, 1);
});

test('buildDigest：同一条稿件的同一类提醒只出现一次，且按等待时间排序', () => {
  // 同一人在多行里负责不同栏目（重复行），不能把同一条稿件算两遍。
  const assignees = [LIAISON, { ...LIAISON, 对接人ID: 'LIA-3', 负责栏目: '红会新闻' }];
  const recipients = buildDigest({
    rows: [
      pendingRow({ 投稿ID: 'SUB-A', 提交时间: '2026-11-11T00:00:00.000Z' }),
      pendingRow({ 投稿ID: 'SUB-B', 提交时间: '2026-11-09T00:00:00.000Z' }),
    ],
    assignees,
  });
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].items.length, 2, '两条不同稿件各一条');
  assert.deepEqual(recipients[0].items.map((item) => item.id), ['SUB-B', 'SUB-A'], '等得久的排前面');
});

/* ----------------------------- 文案与投递 ----------------------------- */

test('汇总文案：写明条数、栏目、环节与截止说明，且带控制台入口', () => {
  const slot = digestSlot(new Date('2026-11-11T12:00:00.000Z'));
  const [recipient] = buildDigest({ rows: [pendingRow()], assignees: ASSIGNEES });
  const subject = digestSubject({ slot, count: recipient.items.length });
  assert.match(subject, /【宣传待办·晚间汇总】1 条（11-11 20:00）/);

  const text = digestMailText({ recipient, slot, baseUrl: 'https://njuredcross.cn/' });
  assert.ok(text.includes('王诺，你好：'));
  assert.ok(text.includes('《献血周预热》'));
  assert.ok(text.includes('栏目：活动预热'));
  assert.ok(text.includes('【待你审核】'));
  assert.ok(text.includes('第 1 级 · 对接人初审（含美编招募）'));
  assert.ok(text.includes('https://njuredcross.cn/console/outreach'));
  assert.ok(text.includes('每日 08:00 与 20:00 各汇总一次'));
});

test('waitingLabel：刚刚 / 小时 / 天', () => {
  const now = new Date('2026-11-11T12:00:00.000Z');
  assert.equal(waitingLabel('2026-11-11T11:40:00.000Z', now), '刚刚');
  assert.equal(waitingLabel('2026-11-11T09:00:00.000Z', now), '已等待 3 小时');
  assert.equal(waitingLabel('2026-11-08T12:00:00.000Z', now), '已等待 3 天');
  assert.equal(waitingLabel('', now), '');
});

test('sendDigest：一人一封，幂等键带时段与邮箱，角色决定邮件类型码', async () => {
  const slot = digestSlot(new Date('2026-11-11T00:00:00.000Z'));
  const recipients = buildDigest({ rows: [pendingRow()], assignees: ASSIGNEES });
  const sent = [];
  const mail = async (message) => { sent.push(message); return { ok: true, transport: 'smtp' }; };

  const results = await sendDigest({ mail, recipients, slot, baseUrl: 'https://njuredcross.cn' });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, LIAISON.邮箱);
  assert.equal(sent[0].kind, 'outreach.digest.liaison');
  assert.equal(sent[0].idempotencyKey, `outreach-digest-2026-11-11-08-${LIAISON.邮箱}`);
  assert.ok(sent[0].subject.includes('早间汇总'));

  assert.equal(digestKindOf({ roles: ['liaison', 'reviewer'] }), 'outreach.digest.mixed');
  assert.equal(digestKindOf({ roles: ['reviewer'] }), 'outreach.digest.reviewer');
  assert.equal(digestKindOf({}), 'outreach.digest.liaison');
});

test('sendDigest：邮件未配置时不尝试投递，但逐人给出原因', async () => {
  const slot = digestSlot(new Date('2026-11-11T00:00:00.000Z'));
  const recipients = buildDigest({ rows: [pendingRow()], assignees: ASSIGNEES });
  const results = await sendDigest({ mail: null, configured: false, recipients, slot });
  assert.equal(results.length, 1);
  assert.equal(results[0].skipped, true);
  assert.equal(results[0].reason, 'not_configured');

  // 单个收件人发信抛错不能中断其他人的投递。
  const broken = await sendDigest({
    mail: async () => { throw new Error('smtp 550'); },
    recipients: [...recipients, { ...recipients[0], email: 'other@example.invalid' }],
    slot,
  });
  assert.equal(broken.length, 2);
  assert.ok(broken.every((item) => item.ok === false && item.reason === 'smtp 550'));
});
