/** Module-level console permissions shared by account loading and API guards. */
export const CONSOLE_PERMISSION_SCOPES = Object.freeze([
  'materials', 'events', 'outreach', 'community', 'data', 'settings', 'accounts',
]);

export function normalizePermissions(value, role = 'platform_admin') {
  if (role !== 'platform_admin') return [];
  const values = Array.isArray(value) ? value : String(value || '').split(/[,，;；\s]+/);
  const normalized = [...new Set(values.map((item) => String(item || '').trim().toLowerCase()).filter((item) => CONSOLE_PERMISSION_SCOPES.includes(item)))];
  // Backwards compatibility: existing administrators have an empty column and
  // retain full access until an explicit least-privilege scope is configured.
  return normalized.length ? normalized : [...CONSOLE_PERMISSION_SCOPES];
}

export function hasPermission(account, scope) {
  if (!scope) return true;
  return normalizePermissions(account?.permissions, account?.role).includes(scope);
}

export function isAccountActive(account) {
  return Boolean(account) && (!account.status || String(account.status).trim() === '启用');
}

export function scopeForConsolePath(pathname) {
  const path = String(pathname || '');
  if (path.startsWith('/api/materials')) return 'materials';
  if (path.startsWith('/api/events') || path.startsWith('/api/event-notices') || path.startsWith('/api/event-attachments') || path.startsWith('/api/volunteer')) return 'events';
  if (path.startsWith('/api/outreach')) return 'outreach';
  if (path.startsWith('/api/community')) return 'community';
  if (path.startsWith('/api/rows')) return 'data';
  if (path.startsWith('/api/audit') || path.startsWith('/api/state/schema-preview')) return 'settings';
  return null;
}
