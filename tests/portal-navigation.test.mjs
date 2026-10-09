import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PORTAL_NAV, portalSection } from '../public/app/portal/navigation.js';

test('legacy action routes remain associated with their new public square', () => {
  assert.equal(portalSection('/events/EVT-123'), '/events');
  assert.equal(portalSection('/workflow-events'), '/events');
  assert.equal(portalSection('/submit'), '/outreach');
  assert.equal(portalSection('/warmth'), '/community');
  assert.equal(portalSection('/morning/comments'), '/community');
  for (const path of ['/status', '/change-password', '/register', '/login']) assert.equal(portalSection(path), '/me');
  for (const item of PORTAL_NAV) assert.equal(portalSection(item.path), item.path);
});
test('square matching does not mark unrelated paths or console navigation', () => {
  for (const path of ['/', '/console/events', '/events-extra', '/about', '/materials-old']) assert.equal(portalSection(path), null);
  assert.equal(new Set(PORTAL_NAV.map(item => item.path)).size, 5);
});
