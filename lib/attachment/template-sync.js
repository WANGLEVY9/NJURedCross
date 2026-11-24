/**
 * 稿件终审通过 → 自动在「新媒体审核表」建一行（2026-11-24 用户需求）。
 *
 * 背景：这张表原本是宣传部门在 SeaTable 里**人工维护**的台账，与网站的
 * 「投稿 → 两级审核」是两条互不相通的线。用户要求：文字稿件终审结束即自动
 * 录入文编/美编信息与排期，免去人工二次抄写。
 *
 * 只写**有权威来源**的字段，其余留空由人推进：
 *   类别 ← 推文类别（11 栏目，全部落在表内 12 个选项上）
 *   预期发布时间 ← 终审弹窗必填
 *   推文标题 ← 投稿标题
 *   文编姓名/学号/邮箱 ← 投稿人（联系人/学号/联系邮箱）
 *   美编姓名/学号/邮箱 ← 初审登记（审核轨迹第 1 级 manualEditor 快照）
 *   美编初审/对接人 ← 第 1 级审核人实名
 *   美编终审人 ← 终审账号实名
 * **不写**：类型（贴图/总结推文/共创推文需人判断）、阶段（选项是
 * 「某人-待美编-某栏目」的复合值，属人工推进）、部门（名册只有「院系」，
 * 没有「综事/生命/博爱/苏州」口径）、美编作品链接与审核状态（美编还没做）。
 */

import { parseReviewTrail } from './store.js';

/** 目标台账表名（生产业务库）。 */
export const TEMPLATE_TABLE = '新媒体审核表';

/** 「类别」列的 12 个选项（与 SeaTable 现状一致；写入前必须命中，否则会污染选项列表）。 */
export const TEMPLATE_CATEGORIES = Object.freeze([
  '活动预热', '心灵慢车', '今日节日', '红会新闻', '健康小蓝鲸', '南小红月报',
  '活动总结', '红会招新', '南男女侣', '人道法言', '小红帮推', '高校多病共防',
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 是否「文字稿件」。
 *
 * 不能直接用 `submissionKindFor() === 'article'`：那个函数把所有非文创设计、
 * 非小绿书的类别都归为 article（包括历史脏数据里的栏目名），会把美编登记
 * 和台账写入带到不该触发的稿件上。用户的需求明确限定「文字稿件」。
 */
export function isWrittenArticleSubmission(submission = {}) {
  const category = String(submission.category || '').trim();
  const publishForm = String(submission.publishForm || '').trim();
  return category === '文字稿件' && publishForm !== '小绿书';
}

/** 只接受 YYYY-MM-DD，并做真实日期反查（拦掉 2026-02-30）。 */
export function normalizePublishDate(raw) {
  const text = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return '';
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return '';
  return text;
}

/** 从审核轨迹取第 1 级通过记录（初审）。 */
export function initialApprovalOf(trail) {
  const entries = parseReviewTrail(trail);
  return entries.find(entry => Number(entry?.level) === 1 && entry?.decision === 'approve') || null;
}

/**
 * 组装台账行。
 * @param {{title?:string, articleCategory?:string, publishDate?:string,
 *          writer?:{name?:string, studentId?:string, email?:string},
 *          editor?:{name?:string, studentId?:string, email?:string},
 *          initialReviewer?:string, finalReviewer?:string}} input
 * @returns {{row:object, missing:string[], categorySkipped:string}}
 */
export function buildTemplateRow({
  title = '', articleCategory = '', publishDate = '',
  writer = {}, editor = {}, initialReviewer = '', finalReviewer = '',
} = {}) {
  const row = {};
  const missing = [];

  const heading = String(title || '').trim();
  if (!heading) missing.push('推文标题');
  else row['推文标题'] = heading;

  const category = String(articleCategory || '').trim();
  const categorySkipped = category && !TEMPLATE_CATEGORIES.includes(category) ? category : '';
  if (category && !categorySkipped) row['类别'] = category;

  const date = normalizePublishDate(publishDate);
  if (!date) missing.push('预期发布时间');
  else row['预期发布时间'] = date;

  const writerName = String(writer.name || '').trim();
  const writerStudentId = String(writer.studentId || '').trim();
  if (!writerName) missing.push('文编姓名');
  else row['文编姓名'] = writerName;
  if (!writerStudentId) missing.push('文编学号');
  else row['文编学号'] = writerStudentId;
  const writerEmail = String(writer.email || '').trim().toLowerCase();
  if (EMAIL_PATTERN.test(writerEmail)) row['文编邮箱'] = writerEmail;

  const editorName = String(editor.name || '').trim();
  const editorStudentId = String(editor.studentId || '').trim();
  if (!editorName) missing.push('美编姓名');
  else row['美编姓名'] = editorName;
  if (!editorStudentId) missing.push('美编学号');
  else row['美编学号'] = editorStudentId;
  const editorEmail = String(editor.email || '').trim().toLowerCase();
  if (EMAIL_PATTERN.test(editorEmail)) row['美编邮箱'] = editorEmail;

  const initial = String(initialReviewer || '').trim();
  if (initial) row['美编初审/对接人'] = initial;
  const final = String(finalReviewer || '').trim();
  if (final) row['美编终审人'] = final;

  return { row, missing, categorySkipped };
}

/**
 * 幂等写入：以「推文标题 + 文编学号」判重。
 * 同一篇稿子重复走终审（或网络重试）不会产生两行。
 */
export async function syncTemplateRow({ client, trail, submission = {}, publishDate = '', finalReviewer = '' } = {}) {
  const initial = initialApprovalOf(trail);
  const editor = initial?.manualEditor || {};
  const { row, missing, categorySkipped } = buildTemplateRow({
    title: submission.title,
    articleCategory: submission.articleCategory,
    publishDate,
    writer: {
      name: submission.contactName,
      studentId: submission.studentId,
      email: submission.submitterEmail,
    },
    editor: { name: editor.name, studentId: editor.studentId, email: editor.email },
    initialReviewer: initial?.reviewerName || initial?.reviewer || '',
    finalReviewer,
  });

  if (missing.length) {
    return {
      ok: false, skipped: false, reason: 'incomplete',
      message: `台账未写入：缺少 ${missing.join('、')}。`,
      missing, row,
    };
  }
  if (!client || typeof client.insertRow !== 'function') {
    return { ok: false, skipped: false, reason: 'unavailable', message: '台账未写入：数据库连接不可用。', row };
  }

  // 判重：标题可能被不同期复用，必须带文编学号一起比。
  const title = row['推文标题'], studentId = row['文编学号'];
  let duplicates;
  try {
    duplicates = await client.query([
      `SELECT \`_id\` FROM \`${TEMPLATE_TABLE}\``,
      `WHERE \`推文标题\` = '${title.replace(/'/g, "''")}' AND \`文编学号\` = '${studentId.replace(/'/g, "''")}'`,
      'LIMIT 2',
    ].join(' '));
  } catch {
    // 查重失败不当作「没有重复」——宁可拒写，也不制造重复行。
    return { ok: false, skipped: false, reason: 'dedupe_failed', message: '台账未写入：查重失败，请稍后手工补录。', row };
  }
  if (Array.isArray(duplicates) && duplicates.length) {
    return {
      ok: true, skipped: true, reason: 'exists',
      rowId: String(duplicates[0]?._id || ''),
      message: '台账已存在同一行，未重复写入。',
      row,
    };
  }

  try {
    const result = await client.insertRow(TEMPLATE_TABLE, row);
    const rowId = String(result?._id || result?.row_id || result || '');
    return {
      ok: true, skipped: false, reason: 'created', rowId,
      message: categorySkipped ? `台账已写入（类别「${categorySkipped}」不在表选项内，已留空）。` : '台账已写入。',
      categorySkipped,
      row,
    };
  } catch (error) {
    return {
      ok: false, skipped: false, reason: 'write_failed',
      message: `台账写入失败：${error?.message || String(error)}`,
      row,
    };
  }
}
