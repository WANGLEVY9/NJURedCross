import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSOLE_PERMISSION_SCOPES,
  normalizePermissions,
  hasPermission,
  isAccountActive,
  scopeForConsolePath,
} from '../lib/permissions.js';

const ALL = [...CONSOLE_PERMISSION_SCOPES];

test('super administrators hold every scope', () => {
  assert.deepEqual(normalizePermissions(null, 'super_admin'), ALL);
  assert.deepEqual(normalizePermissions('events', 'super_admin'), ALL);
});

test('members and unknown roles hold no console scope', () => {
  assert.deepEqual(normalizePermissions('events', 'member'), []);
  assert.deepEqual(normalizePermissions(ALL.join(','), 'student'), []);
  assert.deepEqual(normalizePermissions(ALL, 'guest'), []);
});

test('the role argument defaults to platform_admin, the least-privilege path', () => {
  assert.deepEqual(normalizePermissions('events'), ['events']);
});

test('an unscoped platform administrator keeps full access for backwards compatibility', () => {
  assert.deepEqual(normalizePermissions('', 'platform_admin'), ALL);
  assert.deepEqual(normalizePermissions(null, 'platform_admin'), ALL);
  assert.deepEqual(normalizePermissions('  ', 'platform_admin'), ALL);
});

test('an explicit scope list is honoured, deduplicated and filtered', () => {
  assert.deepEqual(normalizePermissions('events,materials', 'platform_admin'), ['events', 'materials']);
  assert.deepEqual(normalizePermissions('events，materials', 'platform_admin'), ['events', 'materials']);
  assert.deepEqual(normalizePermissions('events  materials', 'platform_admin'), ['events', 'materials']);
  assert.deepEqual(normalizePermissions('events,events,materials', 'platform_admin'), ['events', 'materials']);
  assert.deepEqual(normalizePermissions('EVENTS, bogus', 'platform_admin'), ['events']);
});

test('a populated but entirely unknown scope list grants nothing', () => {
  assert.deepEqual(normalizePermissions('bogus', 'platform_admin'), []);
  assert.deepEqual(normalizePermissions(ALL, 'platform_admin'), ALL);
});

test('hasPermission requires both the role and the scope', () => {
  const admin = { role: 'platform_admin', permissions: 'events,materials' };
  assert.equal(hasPermission(admin, 'events'), true);
  assert.equal(hasPermission(admin, 'materials'), true);
  assert.equal(hasPermission(admin, 'data'), false);
  assert.equal(hasPermission({ role: 'member', permissions: 'events' }, 'events'), false);
  assert.equal(hasPermission({ role: 'super_admin', permissions: '' }, 'accounts'), true);
});

test('an empty scope is granted to every signed-in account', () => {
  assert.equal(hasPermission({ role: 'member' }, ''), true);
  assert.equal(hasPermission({ role: 'platform_admin', permissions: '' }, null), true);
});

test('account activity accepts a missing or 启用 status only', () => {
  assert.equal(isAccountActive({}), true);
  assert.equal(isAccountActive({ status: '启用' }), true);
  assert.equal(isAccountActive({ status: ' 启用 ' }), true);
  assert.equal(isAccountActive({ status: '停用' }), false);
  assert.equal(isAccountActive(null), false);
});

test('console paths map to their permission scope', () => {
  assert.equal(scopeForConsolePath('/api/materials/overview'), 'materials');
  assert.equal(scopeForConsolePath('/api/events/overview'), 'events');
  assert.equal(scopeForConsolePath('/api/event-notices?eventId=1'), 'events');
  assert.equal(scopeForConsolePath('/api/event-attachments'), 'events');
  assert.equal(scopeForConsolePath('/api/volunteer/overview'), 'events');
  assert.equal(scopeForConsolePath('/api/outreach/overview'), 'outreach');
  assert.equal(scopeForConsolePath('/api/community/overview'), 'community');
  assert.equal(scopeForConsolePath('/api/rows'), 'data');
  assert.equal(scopeForConsolePath('/api/audit/recent'), 'settings');
  assert.equal(scopeForConsolePath('/api/state/schema-preview'), 'settings');
  assert.equal(scopeForConsolePath('/api/public/overview'), null);
  assert.equal(scopeForConsolePath(''), null);
});
