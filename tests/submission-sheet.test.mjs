/**
 * 表格数据投稿（2026-11-17 新增类型）。
 *
 * 覆盖四件事：
 *   1. 类别「表格数据」能被正确推断成 kind=sheet（而不是退回 article）；
 *   2. 审核链是 2 级、末级=2，作用域退化为内容类型「表格数据」；
 *   3. 归档落点固定为 /内容投稿/表格数据工作组/<附件ID>，且不进入发布排期；
 *   4. 对接人 seed 里有「表格数据」的精确责任人（对接人 + 审核人各一）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  REVIEW_CHAINS,
  SHEET_ARCHIVE_TARGET,
  SHEET_MIME_PATTERN,
  SHEET_WORKGROUP_PATH,
  SUBMISSION_KINDS,
  SUBMISSION_SUBDIRS,
  canSchedule,
  finalReviewLevel,
  isSheetMime,
  reviewChainFor,
  submissionKindFor,
  submissionStoragePath,
} from '../lib/attachment/store.js';
import { SHEET_REVIEW_SCOPE, reviewScopeOf } from '../lib/attachment/review.js';
import { assigneeTiers } from '../lib/attachment/review.js';

test('表格数据：类别推断为 sheet，不退回 article', () => {
  assert.ok(SUBMISSION_KINDS.includes('sheet'));
  assert.equal(submissionKindFor({ category: '表格数据' }), 'sheet');
  // 显式 kind 优先，便于以后从控制台补录/迁移时指定。
  assert.equal(submissionKindFor({ category: '', kind: 'sheet' }), 'sheet');
  // 不误伤既有两类。
  assert.equal(submissionKindFor({ category: '文字稿件' }), 'article');
  assert.equal(submissionKindFor({ category: '文创设计' }), 'design');
});

test('表格数据：两级审核链，末级为 2', () => {
  assert.equal(REVIEW_CHAINS.sheet.length, 2);
  assert.equal(reviewChainFor('sheet').length, 2);
  assert.equal(finalReviewLevel('sheet'), 2);
  assert.equal(reviewChainFor('sheet')[0].role, 'outreach_liaison');
  assert.equal(reviewChainFor('sheet')[1].role, 'outreach_reviewer');
});

test('表格数据：审核作用域退化为内容类型「表格数据」', () => {
  assert.equal(SHEET_REVIEW_SCOPE, '表格数据');
  assert.equal(reviewScopeOf({ category: '表格数据' }), '表格数据');
  // 11 栏目投稿仍按栏目定作用域。
  assert.equal(reviewScopeOf({ category: '文字稿件', articleCategory: '红会新闻' }), '红会新闻');
  assert.equal(reviewScopeOf({ category: '文创设计' }), '文创设计');
});

test('表格数据：固定归档到 /内容投稿/表格数据工作组/<附件ID>', () => {
  assert.equal(SUBMISSION_SUBDIRS.sheet, '表格数据');
  const path = submissionStoragePath({
    center: SHEET_ARCHIVE_TARGET.center,
    activity: SHEET_ARCHIVE_TARGET.activity,
    attachmentId: 'ATT-TEST-1',
  });
  assert.equal(SHEET_WORKGROUP_PATH, '/内容投稿/表格数据工作组');
  assert.equal(path.dir, `${SHEET_WORKGROUP_PATH}/ATT-TEST-1`);
  // 与文创设计工作组并列，不互相覆盖。
  assert.notEqual(path.dir, '/内容投稿/文创设计工作组/ATT-TEST-1');
});

test('表格数据：不进入发布排期，也不产生待排期提醒', () => {
  assert.equal(canSchedule({ kind: 'sheet', status: '已通过', reviewTrail: JSON.stringify([
    { level: 1, decision: 'approve' },
    { level: 2, decision: 'approve' },
  ]) }), false);
  // 文字稿件终审通过后仍可排期（守住原行为）。
  assert.equal(canSchedule({ kind: 'article', status: '已通过', reviewTrail: JSON.stringify([
    { level: 1, decision: 'approve' },
    { level: 2, decision: 'approve' },
  ]) }), true);
});

test('表格数据：对接人 seed 里两角色都有精确责任人', async () => {
  const { LIAISON_SEED } = await import('../lib/attachment/store.js');
  const rows = LIAISON_SEED.flatMap((row) =>
    row.categories.map((category) => ({ 姓名: row.name, 负责栏目: category, 角色: row.role === 'liaison' ? '对接人' : '审核人', 邮箱: `${row.name}@nju.edu.cn`, 启用: '是' })),
  );
  const liaison = assigneeTiers(rows, '表格数据', 'liaison');
  const reviewer = assigneeTiers(rows, '表格数据', 'reviewer');
  assert.equal(liaison.tier, 'exact');
  assert.equal(liaison.matches.length, 1);
  assert.equal(reviewer.tier, 'exact');
  assert.equal(reviewer.matches.length, 1);
});

test('表格数据：只认 xlsx / xls / csv（含 WPS 与大小写）', () => {
  const accepted = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/wps-office.xlsx',
    'application/wps-office.xls',
    'text/csv',
    'application/csv',
    '  APPLICATION/VND.MS-EXCEL  ',
  ];
  for (const mime of accepted) assert.equal(isSheetMime(mime), true, mime);
  const rejected = ['application/pdf', 'image/png', 'text/plain', 'application/zip', '', null, undefined];
  for (const mime of rejected) assert.equal(isSheetMime(mime), false, String(mime));
});

test('表格数据：前端上传白名单与服务端同一份正则（防漂移）', async () => {
  const source = await readFile(new URL('../public/app/portal/pages/submit.js', import.meta.url), 'utf8');
  const match = source.match(/const SHEET_MIME = \/(.+?)\/;/);
  assert.ok(match, '未找到前端 SHEET_MIME 常量');
  assert.equal(match[1], SHEET_MIME_PATTERN.source, '前后端表格 MIME 正则不一致');
});
