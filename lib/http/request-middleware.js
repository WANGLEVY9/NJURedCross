import { json, securityHeaders } from './response.js';
import { apiFailure } from './errors.js';
import { livenessProbe, readinessProbe, renderMetrics } from './probes.js';
import { assertRequestBodySize, attendanceBodyLimitsFor } from './request-limits.js';

/** Internal request pipeline: probes, body limits, scoped reads and errors. */
export function createRequestMiddleware({
  api,
  staticFile,
  pdfAssets,
  backgroundGate,
  requestGate,
  createWriteJournal,
  withWriteJournal,
  withHttpRequestBudget,
  withDisplayReads,
  isDisplayRequest,
  invalidateWrittenSnapshots,
  requestBudgetMsFor,
  assertApiRequestPath,
  clientTelemetry,
  enforcePublicLimit,
  handleGame,
  latency,
  cacheStats,
  queueStats,
  runtimeStats,
  telemetryStats,
  readinessChecks,
  metricsAccess,
  bodyLimitFor,
} = {}) {
  for (const [name, value] of Object.entries({ api, staticFile, pdfAssets,
    createWriteJournal, withWriteJournal, withHttpRequestBudget, withDisplayReads,
    isDisplayRequest, invalidateWrittenSnapshots, requestBudgetMsFor, assertApiRequestPath,
    clientTelemetry, enforcePublicLimit, handleGame })) {
    if (typeof value !== 'function') throw new TypeError(`Invalid request middleware dependency: ${name}`);
  }
  if (!requestGate || typeof requestGate.run !== 'function' || typeof requestGate.stats !== 'function') {
    throw new TypeError('Invalid request middleware dependency: requestGate');
  }
  if (!backgroundGate || typeof backgroundGate.mark !== 'function') {
    throw new TypeError('Invalid request middleware dependency: backgroundGate');
  }

  function sendJson(res, status, payload, headers = {}) {
    return json(res, status, payload, headers);
  }

  function sendFailure(req, res, error) {
    if (res.destroyed || res.writableEnded) return;
    if (!res.headersSent && !res.destroyed) {
      const failure = apiFailure(error, { method: req.method });
      sendJson(res, failure.status, failure.payload);
    } else res.destroy();
  }

  function sendText(res, status, body, contentType) {
    if (res.writableEnded || res.destroyed) return;
    const bytes = Buffer.from(body);
    res.writeHead(status, { ...securityHeaders(), 'Content-Type': contentType,
      'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
    res.end(bytes);
  }

  async function probes(req, res, url) {
    if (req.method !== 'GET') return false;
    if (url.pathname === '/healthz') {
      sendJson(res, 200, livenessProbe());
      return true;
    }
    if (url.pathname === '/readyz') {
      const result = readinessProbe({ checks: readinessChecks || {} });
      sendJson(res, result.ok ? 200 : 503, result);
      return true;
    }
    if (url.pathname === '/metrics') {
      if (typeof metricsAccess === 'function' && !metricsAccess(req)) {
        sendJson(res, 403, { ok: false, code: 'metrics_forbidden' });
        return true;
      }
      sendText(res, 200, renderMetrics({ latency: latency?.snapshot(), cache: cacheStats?.(),
        queue: queueStats?.(), concurrency: requestGate.stats(), runtime: runtimeStats?.(),
        telemetry: telemetryStats?.() }), 'text/plain; version=0.0.4; charset=utf-8');
      return true;
    }
    return false;
  }

  async function dispatch(req, res, url) {
    if (await probes(req, res, url)) return;
    assertRequestBodySize(req, attendanceBodyLimitsFor(req.method, url.pathname)
      ?? (typeof bodyLimitFor === 'function' ? bodyLimitFor(req, url) : undefined));
    if (String(req.url || '').startsWith('/api/games/uno/')) return handleGame(req, res, url);
    backgroundGate.mark();
    if (url.pathname.startsWith('/api/')) {
      assertApiRequestPath(url.pathname);
      if (url.pathname === '/api/telemetry/client') {
        return clientTelemetry(req, res, { json: sendJson,
          limit: request => enforcePublicLimit(request, 'telemetry', 12_000) });
      }
      const journal = createWriteJournal();
      const display = isDisplayRequest(req.method, url.pathname);
      try {
        return await withWriteJournal(journal, () => withHttpRequestBudget(req, res, () =>
          display ? withDisplayReads(() => api(req, res, url)) : api(req, res, url),
        { timeoutMs: requestBudgetMsFor(req.method, url.pathname) }));
      } finally {
        if (journal.size) for (const table of journal) invalidateWrittenSnapshots(table);
      }
    }
    if (await pdfAssets(req, res, url)) return;
    return staticFile(req, res, url);
  }

  return async function handle(req, res) {
    latency?.start(req, res);
    let handled;
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/healthz' || url.pathname === '/readyz' || url.pathname === '/metrics') {
        handled = await requestGate.run(() => dispatch(req, res, url));
      } else if (url.pathname.startsWith('/api/games/uno/')) {
        // SSE streams stay open for a room's lifetime; the game has its own
        // room cap, per-IP limiter and action token bucket.
        handled = await dispatch(req, res, url);
      } else if (url.pathname.startsWith('/api/')) {
        handled = await requestGate.run(() => dispatch(req, res, url));
      } else {
        handled = await dispatch(req, res, url);
      }
    } catch (error) {
      sendFailure(req, res, error);
      return;
    }
    if (handled === false && !res.writableEnded && !res.destroyed) {
      sendJson(res, 404, { ok: false, code: 'route_not_found', message: '接口不存在或请求方法不受支持。' });
    }
  };
}
