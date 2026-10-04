import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refreshSession, request, getSessionState } from '../public/app/core/api.js';

test('upstream outage/permission denial retain session; only CSRF rejection retries; 401 clears session', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const session = { ok: true, authenticated: true, csrfToken: 'synthetic', user: { username: 'fixture' } };
  let calls = [];
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async path => { calls.push(path); return path === '/api/auth/session' ? response(session) : response({ ok: false, code: 'seatable_auth_failed' }, 503); };
  await refreshSession();
  await assert.rejects(request('/synthetic-outage'));
  assert.equal(getSessionState().user.username, 'fixture');
  calls = [];
  globalThis.fetch = async path => { calls.push(path); return response({ ok: false, code: 'scope_denied' }, 403); };
  await assert.rejects(request('/synthetic-denied', { method: 'POST', body: {} }));
  assert.equal(calls.length, 1); assert.equal(getSessionState().user.username, 'fixture');
  calls = []; let writes = 0;
  globalThis.fetch = async path => {
    calls.push(path);
    if (path === '/api/auth/session') return response(session);
    return ++writes === 1 ? response({ ok: false, code: 'csrf_failed' }, 403) : response({ ok: true });
  };
  assert.equal((await request('/synthetic-csrf', { method: 'POST', body: {} })).ok, true);
  assert.equal(writes, 2); assert.equal(calls.filter(path => path === '/api/auth/session').length, 1);
  globalThis.fetch = async () => response({ ok: false }, 401);
  await assert.rejects(request('/synthetic-expired'));
  assert.equal(getSessionState().authenticated, false);
});
