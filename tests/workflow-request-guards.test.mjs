import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowRoutes } from '../lib/events/workflow-api.js';

function fixture({ authenticated = true, csrf = true } = {}) {
  const calls = {
    workflow: 0,
    body: 0,
    writes: 0,
    csrf: 0,
    audit: 0,
  };

  const ctx = {
    requireConsoleAccess(_req, _res, scope) {
      assert.equal(scope, 'events');
      return authenticated
        ? { username: 'synthetic-admin', role: 'platform_admin' }
        : null;
    },
    requirePortalSession() {
      return authenticated ? { username: 'synthetic-member' } : null;
    },
    requireCsrf() {
      calls.csrf++;
      return csrf;
    },
    async getWorkflow() {
      calls.workflow++;
      return {
        async create() {
          calls.writes++;
          return { _id: 'synthetic-event' };
        },
      };
    },
    async readJson() {
      calls.body++;
      return { name: 'synthetic-event' };
    },
    actor: () => 'synthetic-admin',
    async audit() {
      calls.audit++;
    },
    json: (_res, status, body) => ({ status, body }),
  };

  async function run(origin, path = '/api/volunteer/workflow/events') {
    const headers = { host: 'localhost:3000' };
    if (origin !== undefined) headers.origin = origin;

    return workflowRoutes(
      { method: 'POST', headers },
      null,
      new URL(`http://localhost:3000${path}`),
      ctx,
    );
  }

  return { calls, run };
}

function assertNoBusinessAccess(calls) {
  assert.equal(calls.workflow, 0);
  assert.equal(calls.body, 0);
  assert.equal(calls.writes, 0);
  assert.equal(calls.audit, 0);
}

test('missing console access stops before CSRF and business access', async () => {
  const f = fixture({ authenticated: false });

  assert.equal(await f.run('http://localhost:3000'), undefined);
  assert.equal(f.calls.csrf, 0);
  assertNoBusinessAccess(f.calls);
});

test('missing portal session stops before business access', async () => {
  const f = fixture({ authenticated: false });

  assert.equal(
    await f.run(
      'http://localhost:3000',
      '/api/portal/workflow/events/synthetic/register',
    ),
    undefined,
  );
  assert.equal(f.calls.csrf, 0);
  assertNoBusinessAccess(f.calls);
});

test('CSRF denial blocks console and portal mutations', async () => {
  for (const path of [
    '/api/volunteer/workflow/events',
    '/api/portal/workflow/events/synthetic/register',
  ]) {
    const f = fixture({ csrf: false });

    assert.equal(await f.run('http://localhost:3000', path), undefined);
    assert.equal(f.calls.csrf, 1);
    assertNoBusinessAccess(f.calls);
  }
});

test('foreign and malformed origins stop before business access', async () => {
  for (const origin of [
    'https://other.example.test',
    'http://localhost:3001',
    'null',
    'not-a-url',
  ]) {
    const f = fixture();
    const result = await f.run(origin);

    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'origin_forbidden');
    assertNoBusinessAccess(f.calls);
  }
});

test('matching hosts with unsupported schemes are rejected', async () => {
  for (const origin of [
    'ftp://localhost:3000',
    'ws://localhost:3000',
    'custom://localhost:3000',
  ]) {
    const f = fixture();
    const result = await f.run(origin);

    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'origin_forbidden');
    assertNoBusinessAccess(f.calls);
  }
});

test('matching HTTP and HTTPS origins retain existing behavior', async () => {
  for (const origin of [
    'http://localhost:3000',
    'https://localhost:3000',
  ]) {
    const f = fixture();
    const result = await f.run(origin);

    assert.equal(result.status, 201);
    assert.equal(f.calls.csrf, 1);
    assert.equal(f.calls.workflow, 1);
    assert.equal(f.calls.body, 1);
    assert.equal(f.calls.writes, 1);
  }
});

test('clients without Origin still require a session and CSRF', async () => {
  const allowed = fixture();
  assert.equal((await allowed.run(undefined)).status, 201);

  const denied = fixture({ csrf: false });
  assert.equal(await denied.run(undefined), undefined);
  assertNoBusinessAccess(denied.calls);
});