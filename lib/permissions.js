/** Module-level console permissions shared by account loading and API guards. */
import { hasMaterialsFinanceAccess } from './identity/materials-finance-access.js';
export const CONSOLE_PERMISSION_SCOPES = Object.freeze([
  'materials', 'events', 'outreach', 'community', 'data', 'settings', 'accounts',
]);

export function normalizePermissions(value, role = 'platform_admin', account = null, {
  legacyEmptyAdminPermissions = process.env.PLATFORM_LEGACY_EMPTY_ADMIN_PERMISSIONS === 'true',
} = {}) {
  if (role === 'super_admin') return [...CONSOLE_PERMISSION_SCOPES];
  if (role !== 'platform_admin') return [];
  const values = Array.isArray(value) ? value : String(value || '').split(/[,，;；\s]+/);
  const normalized = [...new Set(values.map((item) => String(item || '').trim().toLowerCase()).filter((item) => CONSOLE_PERMISSION_SCOPES.includes(item)))];
  const blank = (Array.isArray(value) ? value : [value]).every(item => !String(item ?? '').trim());
  // Only a genuinely blank field uses the transition switch. An explicit
  // empty grant ('none') or invalid non-blank value never grants any scopes.
  const scopes = blank && legacyEmptyAdminPermissions ? [...CONSOLE_PERMISSION_SCOPES] : normalized;
  return account?.role === role && hasMaterialsFinanceAccess(account) ? [...new Set([...scopes, 'materials'])] : scopes;
}

export function consoleScopeError(scope) {
  return Object.assign(new Error(`当前账号缺少 ${scope} 模块权限。请核对账号的「权限范围」。`), {
    statusCode: 403,
    code: 'permission_denied',
    requiredScope: scope,
  });
}

export function hasPermission(account, scope) {
  if (!scope) return true;
  return normalizePermissions(account?.permissions, account?.role, account).includes(scope);
}

export function isAccountActive(account) {
  return Boolean(account) && (!account.status || String(account.status).trim() === '启用');
}

export function scopeForConsolePath(pathname) {
  const path = String(pathname || '');
  if (path.startsWith('/api/materials')) return 'materials';
  if (path.startsWith('/api/events') || path.startsWith('/api/event-notices') || path.startsWith('/api/event-attachments') || path.startsWith('/api/volunteer')) return 'events';
  if (path.startsWith('/api/outreach')) return 'outreach';
  // v3 S5：任务发布与技能审核归入宣传中心（同一批内容生产者）。
  if (path.startsWith('/api/console/tasks') || path.startsWith('/api/console/skills')) return 'outreach';
  // v3 S7：宣传展示维护（半自动导入 + 列表管理）同属宣传中心。
  if (path.startsWith('/api/console/showcase')) return 'outreach';
  if (path.startsWith('/api/community')) return 'community';
  if (path.startsWith('/api/rows')) return 'data';
  if (path.startsWith('/api/audit') || path.startsWith('/api/state/schema-preview')) return 'settings';
  return null;
}
