import test from 'node:test';
import assert from 'node:assert/strict';
import { taskRoute } from '../public/app/console/task-route.js';

test('material application tasks link to the application tab and record', () => {
  const url = new URL(taskRoute({
    view: 'materials',
    target: { kind: 'application', id: 'row-application' },
  }), 'http://fixture');

  assert.equal(url.pathname, '/console/materials');
  assert.equal(url.searchParams.get('tab'), 'applications');
  assert.equal(url.searchParams.get('application'), 'row-application');
  assert.equal(url.searchParams.has('inventory'), false);
});

test('inventory tasks link to the inventory tab and record', () => {
  const url = new URL(taskRoute({
    view: 'materials',
    target: { kind: 'inventory', id: 'row-inventory' },
  }), 'http://fixture');

  assert.equal(url.searchParams.get('tab'), 'inventory');
  assert.equal(url.searchParams.get('inventory'), 'row-inventory');
  assert.equal(url.searchParams.has('application'), false);
});

test('record IDs cannot inject additional query parameters', () => {
  const id = '记录 A&tab=tasks#fragment?';
  const url = new URL(taskRoute({
    view: 'materials',
    target: { kind: 'application', id },
  }), 'http://fixture');

  assert.equal(url.searchParams.get('application'), id);
  assert.equal(url.searchParams.get('tab'), 'applications');
  assert.equal([...url.searchParams].length, 2);
  assert.equal(url.hash, '');
});

test('missing or invalid targets fall back to the materials page', () => {
  for (const target of [
    undefined,
    null,
    { kind: 'application', id: '' },
    { kind: 'application', id: '   ' },
    { kind: 'application', id: 123 },
    { kind: 'unknown', id: 'row' },
  ]) {
    assert.equal(
      taskRoute({ view: 'materials', target }),
      '/console/materials',
    );
  }
});

test('other modules retain their routes and unknown views are rejected', () => {
  assert.equal(taskRoute({ view: 'activities' }), '/console/events');
  assert.equal(taskRoute({ view: 'services' }), '/console/volunteers');
  assert.equal(taskRoute({ view: 'outreach' }), '/console/outreach');
  assert.equal(taskRoute({ view: 'community' }), '/console/community');

  for (const item of [undefined, null, {}, { view: 'unknown' }, { view: '__proto__' }]) {
    assert.equal(taskRoute(item), null);
  }
});