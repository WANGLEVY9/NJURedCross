import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePortalNext } from '../public/app/portal/auth-flow.js';

test('same-origin portal paths survive the redirect', () => {
  assert.equal(safePortalNext('/me'), '/me');
  assert.equal(safePortalNext('/events'), '/events');
  assert.equal(safePortalNext('/events?tab=1'), '/events?tab=1');
  assert.equal(safePortalNext('/materials#history'), '/materials#history');
});

test('empty and missing values fall back to the member centre', () => {
  assert.equal(safePortalNext(''), '/me');
  assert.equal(safePortalNext(null), '/me');
  assert.equal(safePortalNext(undefined), '/me');
});

test('protocol-relative and absolute URLs are rejected', () => {
  assert.equal(safePortalNext('//evil.test/me'), '/me');
  assert.equal(safePortalNext('///evil.test'), '/me');
  assert.equal(safePortalNext('https://evil.test/me'), '/me');
  assert.equal(safePortalNext('me'), '/me');
});

test('backslash and encoded-backslash tricks are rejected', () => {
  assert.equal(safePortalNext('/\\evil.test'), '/me');
  assert.equal(safePortalNext('/%5cevil.test'), '/me');
  assert.equal(safePortalNext('/%5Cevil.test'), '/me');
});

test('control characters are rejected', () => {
  assert.equal(safePortalNext('/m\ne'), '/me');
  assert.equal(safePortalNext(`/m${String.fromCharCode(1)}e`), '/me');
});

test('console and admin destinations are rejected so a member cannot be sent there', () => {
  assert.equal(safePortalNext('/console'), '/me');
  assert.equal(safePortalNext('/console/overview'), '/me');
  assert.equal(safePortalNext('/console?next=/me'), '/me');
  assert.equal(safePortalNext('/admin'), '/me');
  assert.equal(safePortalNext('/admin?view=status'), '/me');
});

test('a caller-supplied fallback is honoured', () => {
  assert.equal(safePortalNext('//evil.test', '/events'), '/events');
  assert.equal(safePortalNext('/console', '/events'), '/events');
});
