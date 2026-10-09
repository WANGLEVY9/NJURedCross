export const MORNING_CARD_TABLE = '早安晚安名片表';
export const MORNING_COMMENT_TABLE = '早安晚安评论表';
export const MORNING_TAG_TABLE = '早安晚安兴趣标签表';
export const MORNING_BLACKLIST_TABLE = '早安晚安黑名单表';
export const MORNING_PLAZA_PATH = '/morning/plaza';
export const MORNING_PLAZA_API_PATH = '/api/morning/cards';
export const MORNING_CARD_STATUS = Object.freeze({
  PENDING: '待审核',
  PUBLISHED: '已发布',
  RETURNED: '需修改',
  REJECTED: '已拒绝',
  WITHDRAWN: '已退出',
  DELETED: '已删除',
});
export const MORNING_CAMPUS_OPTIONS = Object.freeze(['鼓楼', '仙林', '苏州', '浦口']);
export const MORNING_INTEREST_TAG_LIMIT = 5;
export const MORNING_NOTE_MAX_LENGTH = 200;
export const MORNING_COMMENT_MAX_LENGTH = 300;
export const MORNING_COMMENT_REPORT_REASON_MAX_LENGTH = 500;
export const MORNING_COMMENT_REPORT_STATUS = Object.freeze({
  PENDING: '待处理',
  RESOLVED: '已处理',
  DISMISSED: '已驳回',
});

export const MORNING_PROTECTED_TABLES = Object.freeze([
  [MORNING_CARD_TABLE, '早安晚安名片必须经过报名和审核流程'],
  [MORNING_COMMENT_TABLE, '早安晚安评论必须经过评论接口写入'],
  [MORNING_TAG_TABLE, '早安晚安兴趣标签必须经过标签接口维护'],
  [MORNING_BLACKLIST_TABLE, '早安晚安黑名单必须经过管理员操作写入'],
]);

const LEGACY_WITHDRAWN_STATUS = '已下架';
const INACTIVE_CARD_STATUSES = new Set([
  MORNING_CARD_STATUS.WITHDRAWN,
  MORNING_CARD_STATUS.DELETED,
  LEGACY_WITHDRAWN_STATUS,
]);
const morningCardLocks = new Map();

export function text(value) {
  return String(value ?? '').trim();
}

export function parseTags(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function isActiveMorningCardStatus(value) {
  return !INACTIVE_CARD_STATUSES.has(String(value || MORNING_CARD_STATUS.PENDING));
}

export function normalizeMorningCardStatus(value) {
  const status = String(value || MORNING_CARD_STATUS.PENDING);
  return status === LEGACY_WITHDRAWN_STATUS ? MORNING_CARD_STATUS.WITHDRAWN : status;
}

export async function withMorningCardLock(accountId, task) {
  const key = `morning-card:${accountId}`;
  const prior = morningCardLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const chained = prior.then(() => gate);
  morningCardLocks.set(key, chained);
  await prior;
  try {
    return await task();
  } finally {
    release();
    if (morningCardLocks.get(key) === chained) morningCardLocks.delete(key);
  }
}
