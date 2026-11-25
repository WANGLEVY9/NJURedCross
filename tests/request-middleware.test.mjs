import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequestMiddleware } from '../lib/http/request-middleware.js';
import { assertRequestBodySize, createRequestConcurrencyGate,
  DEFAULT_JSON_BODY_LIMIT_BYTES, DEFAULT_UPLOAD_BODY_LIMIT_BYTES } from '../lib/http/request-limits.js';
import { livenessProbe, readinessProbe, renderMetrics } from '../lib/http/probes.js';

function dependencyStubs(overrides = {}) {
  const calls = { api: 0, static: 0, marked: 0, telemetry: 0 };
  const noop = () => undefined;
  return {
    calls,
    options: {
      api: async (_req, res) => {
        calls.api++;
        if (!res.writableEnded) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }
        return true;
      },
      staticFile: async (_req, res) => {
        calls.static++;
        if (!res.writableEnded) { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('static'); }
        return true;
      },
      pdfAssets: async () => false,
      backgroundGate: { mark: () => { calls.marked++; } },
      requestGate: createRequestConcurrencyGate({ limit: 2, queueLimit: 1 }),
      createWriteJournal: () => new Set(),
      withWriteJournal: (_journal, task) => task(),
      withHttpRequestBudget: (_req, _res, task) => task(),
      withDisplayReads: task => task(),
      isDisplayRequest: () => false,
      invalidateWrittenSnapshots: noop,
      requestBudgetMsFor: () => 30_000,
      assertApiRequestPath: noop,
      clientTelemetry: async (_req, res) => {
        calls.telemetry++;
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
      },
      enforcePublicLimit: noop,
      handleGame: async (_req, res) => {
        if (!res.writableEnded) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }
        return true;
      },
      latency: { start: noop, snapshot: () => ({ requests: 3, overBudget: 1,
        overBudgetRate: 33.33, trackedRoutes: 1, slowest: [{ route: '/api/public/events', p95: 123.4, errors: 2 }] }) },
      cacheStats: () => ({ hits: 4, misses: 1 }),
      queueStats: () => ({ queued: 2, running: 1, done: 5, failed: 0, runner: { active: 1 } }),
      runtimeStats: () => ({ rssBytes: 1024, heapBytes: 512, active: 1, dropped: 0 }),
      telemetryStats: () => ({ dropped: 0 }),
      readinessChecks: { config: true, failing: () => { throw new Error('synthetic outage'); } },
      metricsAccess: req => {
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return false;
        const forwarded = String(req.headers['x-real-ip'] || '').trim();
        return forwarded ? ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(forwarded) : true;
      },
      ...overrides,
    },
  };
}

function listen(handler) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => { void handler(req, res); });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function close(server) {
  await new Promise(resolve => server.close(resolve));
}

async function request(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(5_000) });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

test('body limits allow upload routes and reject oversized JSON before dispatch', () => {
  assert.doesNotThrow(() => assertRequestBodySize({ headers: { 'content-length': String(DEFAULT_JSON_BODY_LIMIT_BYTES) } }));
  assert.throws(() => assertRequestBodySize({ headers: { 'content-length': String(DEFAULT_JSON_BODY_LIMIT_BYTES + 1) } }),
    error => error.statusCode === 413 && error.code === 'request_body_too_large');
  assert.doesNotThrow(() => assertRequestBodySize({ headers: { 'content-length': String(DEFAULT_UPLOAD_BODY_LIMIT_BYTES) } },
    { allowNonMultipartUpload: true }));
});

test('concurrency gate bounds active work and rejects an overflowing queue', async () => {
  const gate = createRequestConcurrencyGate({ limit: 1, queueLimit: 1 });
  const first = gate.run(() => new Promise(resolve => setTimeout(resolve, 20)));
  const queued = gate.run(() => 'queued');
  assert.equal(gate.stats().active, 1);
  assert.equal(gate.stats().queued, 1);
  await assert.rejects(gate.run(() => 'overflow'), error => error.statusCode === 503);
  assert.equal(await queued, 'queued');
  await first;
  assert.equal(gate.stats().active, 0);
});

test('probes and metrics are wired into the request pipeline', async () => {
  const { options } = dependencyStubs();
  const middleware = createRequestMiddleware(options);
  const { server, base } = await listen(async (req, res) => {
    try { await middleware(req, res); } catch { if (!res.writableEnded) res.destroy(); }
  });
  try {
    const live = await request(base, '/healthz');
    assert.equal(live.status, 200);
    assert.equal(JSON.parse(live.text).status, 'alive');
    const ready = await request(base, '/readyz');
    assert.equal(ready.status, 503);
    assert.equal(JSON.parse(ready.text).checks.failing, false);
    const metrics = await request(base, '/metrics');
    assert.equal(metrics.status, 200);
    assert.match(metrics.headers.get('content-type'), /text\/plain/);
    assert.match(metrics.text, /njuredcross_http_requests_total 3/);
    assert.match(metrics.text, /njuredcross_display_cache_hits_total 4/);
    assert.doesNotMatch(metrics.text, /student|token|cookie|password/i);
    const proxied = await request(base, '/metrics', { headers: { 'x-real-ip': '203.0.113.5' } });
    assert.equal(proxied.status, 403);
  } finally {
    await close(server);
  }
});

test('oversized API requests return 413 without reaching the business dispatcher', async () => {
  const { options, calls } = dependencyStubs();
  const middleware = createRequestMiddleware(options);
  const req = { method: 'POST', url: '/api/public/events', headers: {
    host: 'localhost', 'content-length': String(DEFAULT_JSON_BODY_LIMIT_BYTES + 1),
    'content-type': 'application/json' } };
  const res = { writableEnded: false, destroyed: false, headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; return this; },
    end(body) { this.body = body; this.writableEnded = true; return this; },
    destroy() { this.destroyed = true; return this; } };
  await middleware(req, res);
  assert.equal(res.status, 413);
  assert.equal(JSON.parse(res.body).code, 'request_body_too_large');
  assert.equal(calls.api, 0);
});

test('game, API and static dispatch preserve their middleware scopes', async () => {
  const { options, calls } = dependencyStubs();
  const middleware = createRequestMiddleware(options);
  const { server, base } = await listen(async (req, res) => {
    try { await middleware(req, res); } catch { if (!res.writableEnded) res.destroy(); }
  });
  try {
    const game = await request(base, '/api/games/uno/rooms');
    assert.equal(game.status, 200);
    const api = await request(base, '/api/public/events');
    assert.equal(api.status, 200);
    const telemetry = await request(base, '/api/telemetry/client', { method: 'POST', body: '{}' });
    assert.equal(telemetry.status, 204);
    const asset = await request(base, '/styles/base.css');
    assert.equal(asset.status, 200);
    assert.equal(calls.api, 1);
    assert.equal(calls.telemetry, 1);
    assert.equal(calls.static, 1);
  } finally {
    await close(server);
  }
});

test('rendered metrics use only fixed metric names and numeric values', () => {
  const text = renderMetrics({ latency: { requests: 10, overBudget: 2, overBudgetRate: 20,
    trackedRoutes: 1, slowest: [{ route: '/api/public/events?secret=x', p95: 40, errors: 1 }] },
  queue: { queued: 1, runner: { active: 1 } }, concurrency: { active: 2, queued: 0 },
  runtime: { rssBytes: 100, heapBytes: 50 }, telemetry: { dropped: 0 } });
  assert.match(text, /njuredcross_http_requests_total 10/);
  assert.match(text, /njuredcross_http_route_p95_ms\{route="\/api\/public\/events_secret_x"\} 40/);
  assert.doesNotMatch(text, /secret=x/);
});

test('probe responses contain no dynamic credentials or request data', () => {
  const live = livenessProbe({ now: () => '2026-11-24T00:00:00.000Z' });
  assert.deepEqual(live, { ok: true, status: 'alive', checkedAt: '2026-11-24T00:00:00.000Z' });
  const ready = readinessProbe({ checks: { ok: () => true }, now: () => 'now' });
  assert.equal(ready.status, 'ready');
  assert.deepEqual(Object.keys(ready.checks), ['ok']);
});
