/* ==========================================================================
   schema.js — table and frozen value sets for platform problem feedback.
   One table, distinct from the outreach "活动反馈表". Status/category columns
   are plain text; the service enforces the 待处理→处理中→已回复→已关闭 machine.
   ========================================================================== */

import { planTableShapes, ensureTableShapes } from '../schema/ensure.js';

export const FEEDBACK_TABLE = '平台问题反馈表';

export const FEEDBACK_COLUMNS = Object.freeze({
  '分类': 'text',
  '描述': 'long-text',
  '截图': 'text',
  '联系方式': 'text',
  '提交人姓名': 'text',
  '提交人账号': 'text',
  '提交来源': 'text',
  '业务域': 'text',
  '状态': 'text',
  '处理人': 'text',
  '处理说明': 'long-text',
  '提交时间': 'text',
  '开始处理时间': 'text',
  '回复时间': 'text',
  '关闭时间': 'text',
});

export const FEEDBACK_STATUS = Object.freeze({
  PENDING: '待处理',
  PROCESSING: '处理中',
  REPLIED: '已回复',
  CLOSED: '已关闭',
});

/** 关闭是终态；已关闭的问题拒绝一切写操作。 */
export const FEEDBACK_TRANSITIONS = Object.freeze({
  [FEEDBACK_STATUS.PENDING]: new Set([FEEDBACK_STATUS.PROCESSING, FEEDBACK_STATUS.CLOSED]),
  [FEEDBACK_STATUS.PROCESSING]: new Set([FEEDBACK_STATUS.REPLIED, FEEDBACK_STATUS.CLOSED]),
  [FEEDBACK_STATUS.REPLIED]: new Set([FEEDBACK_STATUS.CLOSED]),
  [FEEDBACK_STATUS.CLOSED]: new Set(),
});

export function feedbackFailure(statusCode, message, code = 'feedback_invalid') {
  return Object.assign(new Error(message), { statusCode, code });
}

export function planFeedbackSchema(metadata) {
  return planTableShapes(metadata, { [FEEDBACK_TABLE]: FEEDBACK_COLUMNS }, feedbackFailure);
}

export async function ensureFeedbackSchema(client, { expectedUuid, apply = false, confirmation = '' } = {}) {
  return ensureTableShapes(client, {
    expectedUuid, apply, confirmation,
    tables: { [FEEDBACK_TABLE]: FEEDBACK_COLUMNS },
    failure: feedbackFailure,
    confirmationPhrase: 'ADD-FEEDBACK',
  });
}
