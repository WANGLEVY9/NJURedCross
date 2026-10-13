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

test('public submission tasks link to the public review tab', () => {
  const id = '投稿 A&tab=board#备注';
  const url = new URL(taskRoute({
    view: 'outreach',
    target: { kind: 'submission', id },
  }), 'http://fixture');

  assert.equal(url.pathname, '/console/outreach');
  assert.equal(url.searchParams.get('tab'), 'public');
  assert.equal(url.searchParams.get('submission'), id);
  assert.equal([...url.searchParams].length, 2);
  assert.equal(url.hash, '');
});

test('invalid submission targets fall back to the outreach page', () => {
  for (const target of [
    undefined,
    { kind: 'submission', id: '' },
    { kind: 'submission', id: '   ' },
    { kind: 'submission', id: 123 },
    { kind: 'unknown', id: 'row' },
  ]) {
    assert.equal(taskRoute({ view: 'outreach', target }), '/console/outreach');
  }
});

test('service targets preserve the hours record identifier', () => {
  for (const view of ['services', 'volunteers']) {
    const id = '合成记录 /?&=';
    const url = new URL(
      taskRoute({ view, target: { kind: 'hours', id } }),
      'http://localhost',
    );
    assert.equal(url.pathname, '/console/volunteers');
    assert.equal(url.searchParams.get('hours'), id);
  }
});

test('invalid service targets fall back to the service page', () => {
  for (const target of [
    undefined,
    { kind: 'hours', id: '' },
    { kind: 'hours', id: '  ' },
    { kind: 'hours', id: 123 },
    { kind: 'submission', id: 'record-1' },
  ]) {
    assert.equal(
      taskRoute({ view: 'services', target }),
      '/console/volunteers',
    );
  }
});

test('activity source routes preserve the source identifier', () => {
  for (const view of ['activities', 'events']) {
    const id = 'managed:合成 /?&=';
    const url = new URL(
      taskRoute({ view, target: { kind: 'source', id } }),
      'http://localhost',
    );
    assert.equal(url.pathname, '/console/events');
    assert.equal(url.searchParams.get('source'), id);
    assert.equal(url.searchParams.get('mode'), 'sources');
    assert.equal(url.searchParams.get('tab'), 'overview');
  }
});

test('invalid activity targets fall back to the activity page', () => {
  for (const target of [
    undefined,
    { kind: 'source', id: '' },
    { kind: 'source', id: 'managed:' },
    { kind: 'source', id: 'managed:  ' },
    { kind: 'source', id: 'wrong:record-1' },
    { kind: 'source', id: 123 },
    { kind: 'hours', id: 'managed:record-1' },
  ]) {
    assert.equal(
      taskRoute({ view: 'activities', target }),
      '/console/events',
    );
  }
});

test('campaign routes open the board with the exact content identifier', () => {
  const id = 'planning:合成 /?&=';
  const url = new URL(
    taskRoute({
      view: 'outreach',
      target: { kind: 'campaign', id },
    }),
    'http://localhost',
  );
  assert.equal(url.pathname, '/console/outreach');
  assert.equal(url.searchParams.get('tab'), 'board');
  assert.equal(url.searchParams.get('campaign'), id);
  assert.equal(url.searchParams.has('submission'), false);
});

test('invalid campaign identifiers fall back to outreach', () => {
  for (const id of ['', '  ', 123, undefined]) {
    assert.equal(
      taskRoute({ view: 'outreach', target: { kind: 'campaign', id } }),
      '/console/outreach',
    );
  }
});

test('activity search results open the exact activity overview', () => {
  const id = '合成活动 /?&=';
  const url = new URL(
    taskRoute({
      view: 'activities',
      target: { kind: 'event', id },
    }),
    'http://localhost',
  );
  assert.equal(url.pathname, '/console/events');
  assert.equal(url.searchParams.get('event'), id);
  assert.equal(url.searchParams.get('mode'), 'all');
  assert.equal(url.searchParams.get('tab'), 'overview');
});

test('archived activity search results open the recycle bin', () => {
  const url = new URL(
    taskRoute({
      view: 'events',
      target: { kind: 'event', id: 'synthetic-archived', mode: 'trash' },
    }),
    'http://localhost',
  );
  assert.equal(url.searchParams.get('mode'), 'trash');
  assert.equal(url.searchParams.get('event'), 'synthetic-archived');
});

test('blank activity search identifiers fall back to the activity page', () => {
  for (const id of ['', '  ', undefined, 123]) {
    assert.equal(
      taskRoute({
        view: 'activities',
        target: { kind: 'event', id },
      }),
      '/console/events',
    );
  }
});