/**
 * 退回意见的溯源与重发（2026-11-25）。
 *
 * 现场：投稿人在微信里问「看不到修改意见的附件」，审核人只能整篇再退一次，
 * 而制度同一级只允许一轮意见（409 review_opinion_round_exceeded）。这里锁死：
 *   1. 逐条意见随审核轨迹落库，历史退回归档后仍能还原原文；
 *   2. 投递结果（发给了谁、何时、失败原因）写进同一轮条目，可追溯；
 *   3. 重发同一轮意见不新增轨迹条目、不改变 canReturnAtLevel 的已用次数；
 *   4. 重发的幂等键必须带次数，否则会被投递层按「已发过」静默跳过；
 *   5. 意见邮件只允许挂系统生成的 .docx，且正文始终能独立读完全部意见。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceReview,
  normalizeOpinions,
  deliverOpinion,
  deliveryRecord,
  deliveryOutcome,
  opinionMailText,
} from '../lib/attachment/review.js';
import {
  parseReviewTrail,
  mergeReviewTrailEntry,
  canReturnAtLevel,
  REVIEW_STATUS,
} from '../lib/attachment/store.js';
import { authorizeOpinionResend } from '../lib/attachment/review-policy.js';
import { mailAttachments } from '../lib/mail/attachments.js';

const PENDING = {
  kind: 'article',
  category: '文字稿件',
  articleCategory: '活动总结',
  reviewLevel: '',
  reviewTrail: '',
  status: REVIEW_STATUS.pending,
};

const RETURNED = {
  ...PENDING,
  status: REVIEW_STATUS.returned,
  reviewTrail: JSON.stringify([{
    level: 1, name: '对接人初审（含美编招募）', decision: 'return',
    note: '地点名称前后不一致', reviewer: 'wangnuo', at: '2026-11-24T03:01:23.683Z',
    checklist: ['CHK-03'],
  }]),
};

const ROWS = [
  { 对接人ID: 'L1', 姓名: '王诺', 负责栏目: '活动总结', 角色: '对接人', 邮箱: 'w@example.invalid', 启用: '是' },
  { 对接人ID: 'R1', 姓名: '金中宸', 负责栏目: '活动总结', 角色: '审核人', 邮箱: 'j@example.invalid', 启用: '是' },
];

test('逐条意见随轨迹落库：去空行、截断、上限 20 条', () => {
  const result = advanceReview(PENDING, {
    decision: 'return', note: '需要改', reviewer: 'wangnuo',
    opinions: [
      { position: ' 第 1 段 ', problem: ' 人数不符 ', requirement: ' 改为 120 人 ' },
      { position: '', problem: '', requirement: '' },
      { position: 'x'.repeat(200), problem: 'p'.repeat(700), requirement: 'r'.repeat(700) },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.entry.opinions.length, 2, '空行被过滤');
  assert.deepEqual(result.entry.opinions[0], {
    position: '第 1 段', problem: '人数不符', requirement: '改为 120 人', fixed: '',
  });
  assert.equal(result.entry.opinions[1].position.length, 120);
  assert.equal(result.entry.opinions[1].problem.length, 600);
  assert.equal(result.entry.opinions[1].requirement.length, 600);

  const many = Array.from({ length: 25 }, (_, i) => ({ problem: `问题 ${i}` }));
  assert.equal(normalizeOpinions(many).length, 20, '单条轨迹最多 20 条意见');

  // 落库的 JSON 必须能原样解析回来（管理端回溯与重发都读它）。
  const trail = parseReviewTrail(result.patch.审核轨迹);
  assert.equal(trail.at(-1).opinions.length, 2);
});

test('投递结果合并回同一轮条目，不新增轨迹条目', () => {
  const merged = mergeReviewTrailEntry(RETURNED.reviewTrail, {
    level: 1, at: '2026-11-24T03:01:23.683Z', decision: 'return',
  }, {
    delivery: {
      status: 'sent', at: '2026-11-24T03:01:24.561Z',
      recipients: [{ to: '251880319@smail.nju.edu.cn', tag: 'submitter' }],
      failures: [],
    },
  });
  const trail = parseReviewTrail(merged);
  assert.equal(trail.length, 1, '合并而不是追加');
  assert.equal(trail[0].note, '地点名称前后不一致', '原有意见不丢');
  assert.equal(trail[0].delivery.status, 'sent');
  assert.equal(trail[0].delivery.recipients[0].to, '251880319@smail.nju.edu.cn');

  // 定位不到（历史行被清理）时原样返回，不制造空条目。
  const untouched = mergeReviewTrailEntry(RETURNED.reviewTrail, {
    level: 2, at: '2026-11-24T03:01:23.683Z', decision: 'return',
  }, { delivery: { status: 'sent' } });
  assert.deepEqual(parseReviewTrail(untouched), parseReviewTrail(RETURNED.reviewTrail));
});

test('重发不占用新一轮退回：同一级仍只有 1 条 return', () => {
  const before = canReturnAtLevel(RETURNED.reviewTrail, 1);
  assert.equal(before.allowed, false, '同一级限一轮，已用掉');

  // 重发只往该条目的 delivery.resends 里追加，不新增 return 条目。
  const resent = mergeReviewTrailEntry(RETURNED.reviewTrail, {
    level: 1, at: '2026-11-24T03:01:23.683Z', decision: 'return',
  }, {
    delivery: {
      status: 'sent', at: '2026-11-25T01:00:00.000Z',
      recipients: [{ to: '251880319@smail.nju.edu.cn', tag: 'submitter' }],
      failures: [],
      resends: [{ at: '2026-11-25T01:00:00.000Z', by: 'wangnuo', attempt: 1, status: 'sent' }],
    },
  });
  const after = canReturnAtLevel(resent, 1);
  assert.equal(after.allowed, false, '重发不产生第二轮退回');
  assert.equal(after.used, 1);
  assert.equal(parseReviewTrail(resent)[0].delivery.resends.length, 1);
});

test('重发幂等键带次数，附件原样随邮件发出', async () => {
  const seen = [];
  const attachment = {
    filename: '审核意见-献血周总结.docx',
    content: Buffer.from('synthetic-docx'),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  const base = {
    submission: { id: 'SUB-1', title: '献血周总结', submitterEmail: 's@example.invalid' },
    entry: { level: 1, name: '对接人初审', decision: 'return', at: '2026-11-24T03:01:23.683Z', note: '改标题' },
    opinions: [{ position: '第 1 段', problem: '人数不符', requirement: '改为 120 人' }],
    audience: ['submitter'],
    attachments: [attachment],
    attachmentName: attachment.filename,
    mail: async (message) => { seen.push(message); return { ok: true, transport: 'smtp' }; },
  };

  const first = await deliverOpinion({ ...base, attempt: 0 });
  const again = await deliverOpinion({ ...base, attempt: 2 });
  assert.equal(deliveryOutcome(first), 'sent');
  assert.equal(deliveryOutcome(again), 'sent');

  assert.equal(seen.length, 2);
  assert.ok(seen[0].idempotencyKey.endsWith('-submitter'), '首次不带 -r');
  assert.ok(seen[1].idempotencyKey.endsWith('-submitter-r2'), '第 2 次重发必须换键');
  assert.notEqual(seen[0].idempotencyKey, seen[1].idempotencyKey);
  assert.equal(seen[1].attachments[0].filename, attachment.filename);
  assert.equal(seen[1].to, 's@example.invalid');
  // 附件只是副本：正文必须能独立读到全部意见。
  assert.match(seen[1].text, /人数不符/);
  assert.match(seen[1].text, /若附件未显示，上方正文即完整审核意见/);
});

test('投递摘要：送达人、失败原因与状态口径', () => {
  const partial = deliveryRecord([
    { tag: 'submitter', to: 's@example.invalid', ok: true },
    { tag: 'liaison', to: 'l@example.invalid', ok: false, reason: 'smtp 550' },
  ], { at: '2026-11-25T01:00:00.000Z' });
  assert.equal(partial.status, 'sent', '至少一封送达即 sent');
  assert.deepEqual(partial.recipients, [{ to: 's@example.invalid', tag: 'submitter' }]);
  assert.deepEqual(partial.failures, [{ tag: 'liaison', reason: 'smtp 550' }]);

  const failed = deliveryRecord([
    { tag: 'submitter', to: 's@example.invalid', ok: false, reason: 'timeout' },
  ]);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failures[0].reason, 'timeout');
});

test('意见邮件附件白名单：只收 1 个系统生成的 .docx', () => {
  const kind = 'outreach.review.opinion.submitter';
  const docx = {
    filename: '审核意见-标题.docx',
    content: Buffer.from('synthetic'),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  assert.equal(mailAttachments({ kind, attachments: [docx] }).length, 1);

  assert.throws(() => mailAttachments({ kind, attachments: [{ ...docx, filename: '意见.pdf' }] }), /邮件附件无效/);
  assert.throws(() => mailAttachments({ kind, attachments: [docx, { ...docx, filename: '2.docx' }] }), /邮件附件无效/);
  assert.throws(() => mailAttachments({ kind, attachments: [{ ...docx, content: Buffer.alloc(2 * 1024 * 1024 + 1) }] }), /邮件附件无效/);
  assert.throws(() => mailAttachments({ kind, attachments: [{ ...docx, path: '/etc/passwd' }] }), /邮件附件无效/);
  assert.throws(() => mailAttachments({ kind, attachments: [{ ...docx, filename: '../x.docx' }] }), /邮件附件无效/);

  // 意见正文本身不依赖附件：无附件时也要能生成完整文本。
  const text = opinionMailText({
    submission: { title: '标题' },
    entry: { level: 1, name: '初审', decision: 'return', note: '改标题', reviewer: 'wangnuo', at: '2026-11-25T00:00:00.000Z' },
    opinions: [{ position: '第 1 段', problem: '问题', requirement: '要求' }],
  });
  assert.match(text, /审核意见：改标题/);
  assert.match(text, /第 1 段/);
});

test('重发鉴权：栏目对接人/审核人可补发，无关账号 403', () => {
  assert.equal(authorizeOpinionResend(RETURNED, { email: 'w@example.invalid' }, ROWS), null);
  assert.equal(authorizeOpinionResend(RETURNED, { email: 'j@example.invalid' }, ROWS), null);
  assert.throws(
    () => authorizeOpinionResend(RETURNED, { email: 'x@example.invalid' }, ROWS),
    (error) => error.statusCode === 403 && error.code === 'review_not_assigned',
  );
});
