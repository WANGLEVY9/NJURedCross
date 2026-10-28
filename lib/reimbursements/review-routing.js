import { isAccountActive } from '../permissions.js';

export const FINANCE_REVIEWERS = Object.freeze({
  'initial-suzhou': '李婉荣', 'initial-other': '邹孟窈', final: '顾语涵',
});
/** Resolve the user's fixed names against server-owned login accounts only. */
export function resolveFinanceReviewerBindings(accounts, overrides = {}) {
  const rows = [...accounts].filter(isAccountActive), result = {};
  for (const [key, name] of Object.entries(FINANCE_REVIEWERS)) {
    const matches = rows.filter(account => String(account.realName || '').trim() === name);
    const id = matches.length === 1 ? matches[0].accountId : '';
    result[key] = typeof id === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(id)
      && (!overrides[key] || overrides[key] === id) ? id : '';
  }
  for (const key of Object.keys(result)) {
    if (result[key] && Object.values(result).filter(id => id === result[key]).length > 1) {
      const duplicated = result[key]; for (const other of Object.keys(result)) if (result[other] === duplicated) result[other] = '';
    }
  }
  return result;
}
export const ACTIVITY_CAMPUSES = Object.freeze(['苏州', '南京', '仙林', '鼓楼', '浦口']);
export function activityCampus(value) {
  const campus = String(value || '').trim().replace(/校区$/, '');
  return ACTIVITY_CAMPUSES.includes(campus) ? campus : '';
}
export function initialAssignment(activity) {
  const campus = activityCampus(activity?.campus);
  if (!campus) throw Object.assign(new Error('请先补齐活动举办校区，再提交报销申请。'), { statusCode: 400 });
  const key = campus === '苏州' ? 'initial-suzhou' : 'initial-other';
  return { key, name: FINANCE_REVIEWERS[key], campus };
}
export const mayReadFinanceRequest = (actor, item, permissions) =>
  permissions.some(p => ['final', 'view'].includes(p))
  || permissions.includes('initial') && (!actor.financeRegion || actor.financeRegion === item.initialAssignment?.key)
  || permissions.includes('payment') && item.status === 'approved';
export function assertInitialAssignment(actor, item) {
  if (item.workflowVersion >= 3 && actor.financeRegion && actor.financeRegion !== item.initialAssignment?.key)
    throw Object.assign(new Error('该活动不属于你的初审范围。'), { statusCode: 403 });
}
