/** Portal grouping follows the activity catalogue, independently of expense categories. */
import { ACTIVITY_CATEGORY_OPTIONS, activityKind } from './activity-taxonomy.js';
export { ACTIVITY_CATEGORY_OPTIONS as REIMBURSEMENT_ACTIVITY_CATEGORIES };
export function reimbursementCampus(value) {
  const campus = String(value || '').trim().replace(/校区$/, '');
  if (['苏州', '苏州分部', '苏州活动', '苏州地区', 'suzhou'].includes(campus)) return '苏州';
  if (['南京', '南京活动', '南京地区', 'nanjing'].includes(campus)) return '南京';
  const campuses = campus.split(/[/、，,]/).map(value => value.trim().replace(/校区$/, ''));
  return campuses.length && campuses.every(value => ['南京', '仙林', '鼓楼', '浦口'].includes(value)) ? '南京' : '';
}
export const reimbursementActivityCategory = activity => activityKind({ activityCategory: activity?.category || activity?.activityCategory || activity?.center, type: activity?.type });
export function reimbursementCategoryOptions(value = '', { unclassified = false } = {}) {
  return [{ value: '', label: '请选择活动类别' }, ...ACTIVITY_CATEGORY_OPTIONS.map(value => ({ value, label: value })),
    ...(unclassified || value === '未分类' ? [{ value: '未分类', label: '未分类（待核对）' }] : [])];
}
export function recentReimbursementActivities(activities, now = new Date(), { requireCampus = true } = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const first = cutoff.toISOString().slice(0, 10);
  return activities.filter(activity => activity && /^\d{4}-\d{2}-\d{2}$/.test(activity.date || '')
    && activity.date >= first && activity.date <= today && (!requireCampus || reimbursementCampus(activity.campus)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'zh-CN'));
}
