/**
 * 宣传审核待办汇总（08:00 / 20:00）——领域层单测。
 *
 * 覆盖：时区与时段判定、按责任环节归集、各类稿件该不该进汇总、
 * 汇总文案与投递幂等键。不触网、不读 SeaTable。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIGEST_ATTACHMENT_LIMITS,
  DIGEST_HOURS,
  buildDigest,
  bytesLabel,
  digestKindOf,
  digestMailText,
  digestSlot,
  digestSubject,
  planDigestAttachments,
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

/* ----------------------------- 附件装填 ----------------------------- */

/** 附件元数据夹具（够 plan 用即可）。 */
function file(id, size, filename = `${id}.png`, contentType = 'image/png') {
  return {
    id, filename, size, contentType,
    objectKey: `/内容投稿/博爱中心/献血周/${id}/${filename}`,
    provider: 'njubox',
  };
}

test('bytesLabel：B / KB / MB 三档，未知大小留空', () => {
  assert.equal(bytesLabel(0), '');
  assert.equal(bytesLabel(undefined), '');
  assert.equal(bytesLabel(900), '900 B');
  assert.equal(bytesLabel(48 * 1024), '48 KB');
  assert.equal(bytesLabel(9 * 1024 * 1024), '9.0 MB');
});

test('planDigestAttachments：三条上限分别生效，超限点名不静默丢弃', () => {
  // 单附件上限 8MB：9MB 的直接不带。
  const single = planDigestAttachments({
    items: [{ id: 'S1', type: 'review', attachments: [file('A1', 2 * 1024 * 1024), file('A2', 9 * 1024 * 1024, 'big.zip')] }],
  });
  assert.deepEqual(single.files.map((item) => item.id), ['A1']);
  assert.deepEqual(single.skipped.map((item) => [item.id, item.reason]), [['A2', 'file']]);

  // 单封总量 20MB：7+7 可放，第三个 7MB 超预算。
  const total = planDigestAttachments({
    items: [{ id: 'S2', attachments: [file('B1', 7 * 1024 * 1024), file('B2', 7 * 1024 * 1024), file('B3', 7 * 1024 * 1024)] }],
  });
  assert.equal(total.files.length, 2);
  assert.deepEqual(total.skipped.map((item) => item.reason), ['mail']);

  // 个数上限 30：第 31 个起不再带。
  const many = planDigestAttachments({
    items: [{ id: 'S3', attachments: Array.from({ length: 32 }, (_, index) => file(`C${index}`, 100)) }],
  });
  assert.equal(many.files.length, DIGEST_ATTACHMENT_LIMITS.maxFiles);
});

test('planDigestAttachments：稿件文档可占满整封预算，配图仍按 8MB 卡', () => {
  // 投稿页允许 20MB 的 PDF；邮件若只收 8MB，最该附的那份反而进不来。
  const pdf = file('D1', 12 * 1024 * 1024, '策划案.pdf', 'application/pdf');
  const image = file('D2', 9 * 1024 * 1024, '现场大图.png', 'image/png');
  const plan = planDigestAttachments({ items: [{ id: 'S1', attachments: [pdf, image] }] });
  assert.deepEqual(plan.files.map((item) => item.id), ['D1']);
  assert.deepEqual(plan.skipped.map((item) => [item.id, item.reason]), [['D2', 'file']]);

  // 扩展名兜底：MIME 被浏览器写成 octet-stream 时仍认得出是 Word 文档。
  const docx = file('D3', 10 * 1024 * 1024, '推文正文.docx', 'application/octet-stream');
  const fallback = planDigestAttachments({ items: [{ id: 'S2', attachments: [docx] }] });
  assert.deepEqual(fallback.files.map((item) => item.id), ['D3']);
});

test('planDigestAttachments：同一条待办内文档排在配图前，预算不够时先保稿子', () => {
  // 先传的是一张大图，后传的是正文 docx：预算只够一份时必须是 docx。
  const plan = planDigestAttachments(
    {
      items: [{
        id: 'S1',
        attachments: [
          file('E1', 3 * 1024 * 1024, '现场图.png', 'image/png'),
          file('E2', 500 * 1024, '推文正文.docx'),
        ],
      }],
    },
    { totalBytes: 3.2 * 1024 * 1024, fileBytes: 8 * 1024 * 1024, documentBytes: 20 * 1024 * 1024, maxFiles: 30 },
  );
  assert.deepEqual(plan.files.map((item) => item.mailName), ['1-推文正文.docx']);
  assert.deepEqual(plan.skipped.map((item) => [item.id, item.reason]), [['E1', 'mail']]);
  // 正文直接引用的原始数组不能被就地改写。
  assert.equal(plan.byItem.get('S1').length, 1);
});

test('planDigestAttachments：附件名加邮件内序号前缀，与正文编号对齐', () => {
  const plan = planDigestAttachments({
    items: [
      { id: 'S1', attachments: [file('A1', 1024, '推文正文.docx'), file('A2', 1024, '配图 1.png')] },
      { id: 'S2', attachments: [file('A3', 1024, 'image.png')] },
    ],
  });
  assert.deepEqual(plan.files.map((item) => item.mailName), ['1-推文正文.docx', '2-配图 1.png', '3-image.png']);
  assert.deepEqual(plan.files.map((item) => item.ordinal), [1, 2, 3]);
  assert.equal(plan.byItem.get('S1').length, 2);
  assert.equal(plan.byItem.get('S2').length, 1);
});

test('planDigestAttachments：路径分隔符与控制字符被清洗，超长名保留扩展名', () => {
  const plan = planDigestAttachments({
    items: [{
      id: 'S1',
      attachments: [
        file('A1', 1, '../../etc/passwd'),
        file('A2', 1, `${'长'.repeat(120)}.docx`),
      ],
    }],
  });
  // 文档排在前，序号会变，所以按 id 取结果而不是按数组下标。
  const byId = new Map(plan.files.map((item) => [item.id, item.mailName]));
  assert.equal(byId.get('A1').replace(/^\d+-/, ''), '.._.._etc_passwd');
  const long = byId.get('A2');
  assert.ok(long.endsWith('.docx'));
  assert.ok(long.length <= 84, `前缀 + 80 字符内，实际 ${long.length}`);
});

test('buildDigest：附件挂到对应待办，没附件的稿件不受影响', () => {
  const recipients = buildDigest({
    rows: [pendingRow({ 投稿ID: 'SUB-1' }), pendingRow({ 投稿ID: 'SUB-2', 标题: '无附件稿' })],
    assignees: ASSIGNEES,
    attachments: { 'SUB-1': [file('ATT-9', 1024, '正文.docx')] },
  });
  const items = recipients[0].items;
  assert.equal(items.find((item) => item.id === 'SUB-1').attachments.length, 1);
  assert.deepEqual(items.find((item) => item.id === 'SUB-2').attachments, []);
});

test('汇总文案：列出已附附件编号，超限与读取失败分别说明', () => {
  const slot = digestSlot(new Date('2026-11-11T12:00:00.000Z'));
  const recipient = {
    email: LIAISON.邮箱, name: '王诺', roles: ['liaison'],
    items: [{
      id: 'S1', type: 'review', title: '献血周预热', category: '活动预热',
      level: 1, levelName: '对接人初审（含美编招募）', waiting: '已等待 2 小时', waitingSince: '',
      attachments: [file('ATT-1', 48 * 1024, '正文.docx'), file('ATT-2', 9 * 1024 * 1024, '大图.png')],
    }],
  };
  const plan = planDigestAttachments(recipient);
  const text = digestMailText({ recipient, slot, plan, missing: new Set(['ATT-1']) });
  assert.ok(text.includes('随本邮件附上 1 个附件（合计 48 KB）'));
  assert.ok(text.includes('另有 1 个附件超过邮件体积上限未附'));
  assert.ok(text.includes('附件 [1] 正文.docx（48 KB） · 读取失败，请登录控制台查看'));
  assert.ok(text.includes('附件 大图.png（9.0 MB）· 超出单附件上限，请登录控制台查看'));
});

test('sendDigest：附件随信附上，取不到内容的降级为正文点名，引用只留已附的', async () => {
  const slot = digestSlot(new Date('2026-11-11T00:00:00.000Z'));
  const recipients = [{
    email: LIAISON.邮箱, name: '王诺', roles: ['liaison'],
    items: [{
      id: 'S1', type: 'review', title: '献血周预热', category: '活动预热',
      level: 1, levelName: '初审', waiting: '', waitingSince: '',
      attachments: [file('ATT-1', 4, 'ok.txt'), file('ATT-2', 4, 'bad.txt')],
    }],
  }];
  const asked = [];
  const sent = [];
  const results = await sendDigest({
    mail: async (message) => { sent.push(message); return { ok: true }; },
    recipients,
    slot,
    loadAttachment: async (item) => {
      asked.push(item.id);
      if (item.id === 'ATT-2') throw new Error('njubox_not_found');
      return Buffer.from('data');
    },
  });
  assert.equal(results[0].attached, 1);
  assert.deepEqual(asked, ['ATT-1', 'ATT-2'], '两个都尝试过');
  assert.equal(sent[0].attachments.length, 1);
  assert.equal(sent[0].attachments[0].filename, '1-ok.txt');
  assert.equal(sent[0].attachments[0].attachmentId, 'ATT-1');
  assert.ok(sent[0].text.includes('读取失败'));
  assert.deepEqual(sent[0].attachmentRefs.map((ref) => ref.attachmentId), ['ATT-1'], '只给真附上的留引用');
  assert.equal(sent[0].attachmentRefs[0].objectKey, '/内容投稿/博爱中心/献血周/ATT-1/ok.txt');
});

test('sendDigest：同一附件出现在多人待办时只下载一次', async () => {
  const slot = digestSlot(new Date('2026-11-11T00:00:00.000Z'));
  const item = {
    id: 'S1', type: 'review', title: 'T', category: '活动预热',
    level: 1, levelName: '初审', waiting: '', waitingSince: '',
    attachments: [file('ATT-1', 4, 'a.txt')],
  };
  const recipients = [
    { email: 'a@example.invalid', name: 'A', roles: ['liaison'], items: [item] },
    { email: 'b@example.invalid', name: 'B', roles: ['reviewer'], items: [item] },
  ];
  let loads = 0;
  const results = await sendDigest({
    mail: async () => ({ ok: true }),
    recipients,
    slot,
    loadAttachment: async () => { loads += 1; return Buffer.from('data'); },
  });
  assert.equal(loads, 1);
  assert.deepEqual(results.map((item) => item.attached), [1, 1]);
});
