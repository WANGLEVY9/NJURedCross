import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowRoutes } from '../lib/events/workflow-api.js';

function fixture() {
  const calls = [], audits = [];
  const session = { username: 'server-actor', role: 'platform_admin' };
  const service = {
    context: async () => ({ event: { 活动ID: 'event-1' }, expectedDigest: 'a'.repeat(64), canSubmit: true }),
    preview: async (...args) => { calls.push(['preview', ...args]); return { patch: args[1], changes: [] }; },
    active: async (...args) => { calls.push(['active', ...args]); return null; },
    submit: async (...args) => { calls.push(['submit', ...args]); return { status: 'pending', version: 1 }; },
    get: async (...args) => {
      calls.push(['get', ...args]);
      if (args[0] === 'foreign') throw Object.assign(new Error('此活动没有对应的变更申请'), { statusCode: 404 });
      return { status: 'pending', version: 1 };
    },
    review: async (...args) => { calls.push(['review', ...args]); return { status: 'approved', version: 3 }; },
  };
  const ctx = {
    json: (_, status, body) => ({ status, body }),
    requireConsoleAccess: () => session,
    requirePortalSession: () => session,
    requireCsrf: req => req.headers['x-csrf-token'] === 'valid',
    getWorkflow: async () => ({ activityChanges: service }),
    actor: s => s.username,
    readJson: async req => req.body,
    audit: async (...args) => audits.push(args),
  };
  const run = (method, path = '', body, headers = {}) => workflowRoutes({ method, body, headers: { host: 'fixture', 'x-csrf-token': 'valid', ...headers } }, {}, new URL(`http://fixture/api/volunteer/workflow/events/event-1/change-request${path}`), ctx);
  return { calls, audits, service, ctx, run };
}
test('submission uses the session actor and records a private audit', async () => {
  const f = fixture();
  const result = await f.run('POST', '', { expectedDigest: 'a'.repeat(64), requestId: 'request-1', patch: { 地点: '合成地点' } });
  assert.equal(result.status, 201);
  assert.deepEqual(f.calls, [['submit', 'event-1', { 地点: '合成地点' }, { actor: 'server-actor', requestId: 'request-1', expectedDigest: 'a'.repeat(64) }]]);
  assert.equal(f.audits.length, 1);
});
test('unauthenticated requests cannot read or submit changes', async () => {
  const f = fixture(); f.ctx.requireConsoleAccess = () => null;
  await f.run('GET'); await f.run('POST', '', { expectedDigest: 'a'.repeat(64), requestId: 'request-1', patch: {} });
  assert.equal(f.calls.length, 0);
});
test('CSRF failure and untrusted origins stop mutations before the service', async () => {
  const f = fixture();
  await f.run('POST', '', {}, { 'x-csrf-token': 'invalid' });
  assert.equal((await f.run('POST', '', {}, { origin: 'https://foreign.example' })).status, 403);
  assert.equal(f.calls.length, 0);
});
test('invalid input and actor or role overrides are rejected', async () => {
  const f = fixture();
  for (const body of [null, [], {}, { requestId: '../invalid', patch: {} }, { requestId: 'id', patch: [] }, { expectedDigest: 'a'.repeat(64), requestId: 'id', patch: {}, actor: 'super' }, { expectedDigest: 'a'.repeat(64), requestId: 'id', patch: {}, role: 'super_admin' }]) assert.equal((await f.run('POST', '', body)).status, 400);
  assert.equal(f.calls.length, 0);
});
test('review validates version and decision and requires a return reason', async () => {
  const f = fixture();
  for (const body of [{ version: 0, decision: 'approve' }, { version: 1, decision: 'unknown' }, { version: 1, decision: 'return' }, { version: 1, decision: 'approve', canReview: true }, { version: 1, decision: 'approve', reason: 9 }]) assert.equal((await f.run('POST', '/request-1/review', body)).status, 400);
  assert.equal(f.calls.length, 0);
});
test('review binds the request to its event before mutation', async () => {
  const f = fixture();
  await assert.rejects(() => f.run('POST', '/foreign/review', { version: 1, decision: 'approve' }), { statusCode: 404 });
  assert.equal(f.calls.filter(call => call[0] === 'review').length, 0);
  const result = await f.run('POST', '/request-1/review', { version: 1, decision: 'approve' });
  assert.equal(result.status, 200);
  assert.deepEqual(f.calls.at(-2), ['get', 'request-1', 'server-actor', 'event-1']);
  assert.deepEqual(f.calls.at(-1), ['review', 'request-1', { actor: 'server-actor', version: 1, decision: 'approve', reason: '' }]);
});
test('read routes use activity scope and invalid request identifiers never reach storage', async () => {
  const f = fixture();
  assert.equal((await f.run('GET')).status, 200);
  assert.equal((await f.run('GET', '?request=request-1')).status, 200);
  assert.deepEqual(f.calls, [['active', 'event-1', 'server-actor'], ['get', 'request-1', 'server-actor', 'event-1']]);
  assert.equal((await f.run('GET', '?request=../invalid')).status, 400);
  assert.equal(f.calls.length, 2);
});
test('organization activity scope is checked before reading a request', async () => {
  const f = fixture();
  f.ctx.getEventAuthority = async () => ({ canEnter: true, assertEvent: () => { throw Object.assign(new Error('无此活动权限'), { statusCode: 403 }); } });
  await assert.rejects(() => f.run('GET'), { statusCode: 403 });
  assert.equal(f.calls.length, 0);
});
test('service permissions are not bypassed by the route', async () => {
  const f = fixture(); f.service.review = async () => { throw Object.assign(new Error('不是审核人'), { statusCode: 403 }); };
  await assert.rejects(() => f.run('POST', '/request-1/review', { version: 1, decision: 'approve' }), { statusCode: 403 });
  assert.equal(f.audits.length, 0);
});
test('disabled service and unsupported methods report explicit errors', async () => {
  const f = fixture();
  assert.equal((await f.run('DELETE')).status, 405);
  f.ctx.getWorkflow = async () => ({ activityChanges: null });
  assert.equal((await f.run('GET')).status, 503);
});
test('server preview requires a version snapshot and cannot submit an application', async () => {
  const f = fixture();
  assert.equal((await f.run('POST', '/preview', { patch: { 地点: '新地点' } })).status, 400);
  assert.equal((await f.run('POST', '/preview', { patch: { 地点: '新地点' }, expectedDigest: 'a'.repeat(64) })).status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], 'preview');
  assert.equal(f.audits.length, 0);
});
