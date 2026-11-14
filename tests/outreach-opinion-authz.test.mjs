/**
 * 审核意见 Word 导出的鉴权（2026-11-14 第 69 轮）。
 *
 * 背景：`POST /api/outreach/reviews/:contentId/opinion` 原先只校验「投稿存在」，
 * 凡持 outreach 权限的账号都能给任意栏目的任意稿件导出一份意见 Word，等于把
 * 标题、编辑、清单勾选与修改意见整篇外泄。这里锁死三条契约：
 *   1. 链未走完时，只有「当前层级」责任人能出意见（与 approve/return 同源）；
 *   2. 链已走完时没有当前层级可判，退化为该栏目的对接人或审核人；
 *   3. 无关账号一律 403，且错误码可被 apiFailure 直通给前端。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { authorizeOpinionExport } from '../lib/attachment/review-policy.js';
import { REVIEW_STATUS } from '../lib/attachment/store.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 一个栏目两人：对接人（初审）+ 审核人（复核）。 */
const ROWS = [
  { 对接人ID: 'L1', 姓名: '王诺', 负责栏目: '活动总结', 角色: '对接人', 邮箱: 'w@example.invalid', 启用: '是' },
  { 对接人ID: 'R1', 姓名: '金中宸', 负责栏目: '活动总结', 角色: '审核人', 邮箱: 'j@example.invalid', 启用: '是' },
];

const LIAISON = { username: 'wangnuo', email: 'w@example.invalid' };
const REVIEWER = { username: 'jinzhongchen', email: 'j@example.invalid' };
const OUTSIDER = { username: 'someone', email: 'x@example.invalid' };

/** 两级链、一级都还没过。 */
const PENDING = {
  kind: 'article',
  category: '文字稿件',
  articleCategory: '活动总结',
  reviewLevel: '',
  reviewTrail: '',
  status: REVIEW_STATUS.pending,
};

/** 两级都通过：链已走完，没有「当前层级」。 */
const DONE = {
  kind: 'article',
  category: '文字稿件',
  articleCategory: '活动总结',
  reviewLevel: '2',
  reviewTrail: JSON.stringify([{ level: 1, decision: 'approve' }, { level: 2, decision: 'approve' }]),
  status: REVIEW_STATUS.approved,
};

test('意见导出：链未走完时只放行当前层级责任人', () => {
  const level = authorizeOpinionExport(PENDING, LIAISON, ROWS);
  assert.equal(level?.level, 1, '初审阶段放行对接人并回传层级');

  assert.throws(
    () => authorizeOpinionExport(PENDING, REVIEWER, ROWS),
    (error) => error.statusCode === 403 && error.code === 'review_not_assigned',
    '复核人不能在初审阶段抢先出意见',
  );
  assert.throws(
    () => authorizeOpinionExport(PENDING, OUTSIDER, ROWS),
    (error) => error.statusCode === 403 && error.code === 'review_not_assigned',
    '无关账号必须 403',
  );
});

test('意见导出：链未走完且栏目无责任人时 503，不静默放行', () => {
  assert.throws(
    () => authorizeOpinionExport(PENDING, LIAISON, []),
    (error) => error.statusCode === 503 && error.code === 'review_assignment_required',
    '空名单不能当成「谁都可以」',
  );
});

test('意见导出：链已走完退化为栏目的对接人或审核人', () => {
  assert.equal(authorizeOpinionExport(DONE, LIAISON, ROWS), null, '对接人可补出留痕');
  assert.equal(authorizeOpinionExport(DONE, REVIEWER, ROWS), null, '审核人可补出留痕');
  assert.throws(
    () => authorizeOpinionExport(DONE, OUTSIDER, ROWS),
    (error) => error.statusCode === 403 && error.code === 'review_not_assigned',
    '链走完不等于全员可读',
  );
});

test('意见导出：链已走完但名单为空时也拒绝，不因缺配置而放行', () => {
  assert.throws(
    () => authorizeOpinionExport(DONE, LIAISON, []),
    (error) => error.statusCode === 403 && error.code === 'review_not_assigned',
  );
});

test('意见导出：文创设计按内容类型作用域取人，不受 11 栏目限制', () => {
  const designRows = [
    { 对接人ID: 'L2', 姓名: '杨一诺', 负责栏目: '文创设计', 角色: '对接人', 邮箱: 'y@example.invalid', 启用: '是' },
    { 对接人ID: 'R2', 姓名: '袁金雨', 负责栏目: '文创设计', 角色: '审核人', 邮箱: 'yj@example.invalid', 启用: '是' },
  ];
  const design = {
    kind: 'design',
    category: '文创设计',
    articleCategory: '',
    reviewLevel: '3',
    reviewTrail: JSON.stringify([1, 2, 3].map((level) => ({ level, decision: 'approve' }))),
    status: REVIEW_STATUS.approved,
  };
  assert.equal(authorizeOpinionExport(design, { email: 'y@example.invalid' }, designRows), null);
  assert.throws(
    () => authorizeOpinionExport(design, OUTSIDER, designRows),
    (error) => error.statusCode === 403,
  );
});

test('路由守卫：opinion 路由必须调用 authorizeOpinionExport', () => {
  const source = readFileSync(resolve(ROOT, 'server.js'), 'utf8');
  const start = source.indexOf("reviewOpinion = url.pathname.match(");
  assert.ok(start > 0, '找不到 opinion 路由');
  const segment = source.slice(start, start + 2200);
  assert.match(
    segment,
    /authorizeOpinionExport\(shape, accountsByUsername\.get\(session\.username\), assignees\)/,
    '鉴权必须在读清单与拼 Word 之前发生',
  );
  assert.ok(
    segment.indexOf('authorizeOpinionExport') < segment.indexOf('buildOpinionDocx'),
    '先鉴权再生成文档，顺序不可颠倒',
  );
});
