/** Organization evidence must come from a complete, server-read membership source.
 * Account profile.department is the academic faculty, never an authorization claim.
 */
import {isAccountActive} from '../permissions.js';
import {ACTIVITY_CATEGORY_OPTIONS,canonicalActivityCategory} from '../../public/app/shared/activity-taxonomy.js';

export const EVENT_CATEGORIES = ACTIVITY_CATEGORY_OPTIONS;
const directorCategories = new Map([
  ['博爱中心主任团', '博爱中心'],
  ['生命中心主任团', '生命中心'],
  ['综事中心主任团', '综事中心'],
]);
const text = value => typeof value === 'string' ? value.trim() : '';
const empty = () => ({verified:false, global:false, categories:[], reviewer:false});

export function organizationAccess(account, profiles, {complete = false} = {}) {
  if (!complete || !Array.isArray(profiles) || !isAccountActive(account)
    || account.emailVerified !== true || !/^\d{6,20}$/.test(text(account.studentId))
    || !text(account.realName)) return empty();
  const matches = profiles.filter(row => text(row['学号']) === account.studentId);
  // Duplicate identities fail closed even when both rows happen to carry the same title.
  if (matches.length !== 1 || text(matches[0]['姓名']) !== text(account.realName)) return empty();
  const department = text(matches[0]['部门']);
  const global = department === '主席团 & 指导组';
  const center = directorCategories.get(department);
  const categories = global ? [...EVENT_CATEGORIES] : center ? [center] : [];
  return {verified:true, global, categories, reviewer:global};
}

/** Approval is intentionally separate from management delegated to an event owner. */
export function eventAccess({account, organization, category, ownerIds = []}) {
  category=canonicalActivityCategory(category);
  const id = account?.accountId || account?.username;
  const active = isAccountActive(account);
  const global = active && (account.role === 'super_admin' || organization?.global === true);
  const categoryManager = active && EVENT_CATEGORIES.includes(category)
    && organization?.verified === true && organization.categories.some(value=>canonicalActivityCategory(value)===category);
  const owner = active && Boolean(id) && ownerIds.includes(id);
  return {
    create: EVENT_CATEGORIES.includes(category) && category !== '献血车专项' && Boolean(global || categoryManager),
    approve: Boolean(global),
    manage: Boolean(global || categoryManager || owner),
    manageOwners: Boolean(global || categoryManager || owner),
    recordHours: Boolean(global || categoryManager || owner),
    exportHours: Boolean(global || categoryManager || owner),
  };
}
