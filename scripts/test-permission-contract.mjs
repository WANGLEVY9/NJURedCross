import assert from 'node:assert/strict';
import { CONSOLE_PERMISSION_SCOPES, normalizePermissions, hasPermission, isAccountActive, scopeForConsolePath } from '../lib/permissions.js';

assert.deepEqual(normalizePermissions('', 'platform_admin'), CONSOLE_PERMISSION_SCOPES);
assert.deepEqual(normalizePermissions('materials，events materials unknown', 'platform_admin'), ['materials', 'events']);
assert.deepEqual(normalizePermissions('materials', 'member'), []);
assert.deepEqual(normalizePermissions('event_typo', 'platform_admin'), []);
assert.deepEqual(normalizePermissions(['unknown'], 'platform_admin'), []);
assert.equal(hasPermission({ role: 'platform_admin', permissions: ['unknown'] }, 'accounts'), false);
assert.deepEqual(normalizePermissions([' ', ''], 'platform_admin'), CONSOLE_PERMISSION_SCOPES);
assert.equal(hasPermission({ role: 'platform_admin', permissions: ['materials'] }, 'materials'), true);
assert.equal(hasPermission({ role: 'platform_admin', permissions: ['materials'] }, 'events'), false);
assert.equal(isAccountActive({ status: '启用' }), true);
assert.equal(isAccountActive({ status: '停用' }), false);
assert.equal(isAccountActive(null), false);
assert.equal(scopeForConsolePath('/api/materials/overview'), 'materials');
assert.equal(scopeForConsolePath('/api/events/overview'), 'events');
assert.equal(scopeForConsolePath('/api/event-attachments/njubox-status'), 'events');
assert.equal(scopeForConsolePath('/api/volunteer/overview'), 'events');
assert.equal(scopeForConsolePath('/api/outreach/overview'), 'outreach');
assert.equal(scopeForConsolePath('/api/community/overview'), 'community');
assert.equal(scopeForConsolePath('/api/rows?table=x'), 'data');
assert.equal(scopeForConsolePath('/api/audit/recent'), 'settings');
assert.equal(scopeForConsolePath('/api/health'), null);

console.log('PASS 权限词表、账号状态与 API 路由映射: 21/21');
