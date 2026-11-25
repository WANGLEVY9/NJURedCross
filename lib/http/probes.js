/** Lightweight process probes and a sanitized Prometheus text exposition. */

function finite(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function line(name, value, help = '') {
  return `${help ? `# HELP ${name} ${help}\n# TYPE ${name} gauge\n` : ''}${name} ${value}\n`;
}

export function livenessProbe({ now = () => new Date().toISOString() } = {}) {
  return { ok: true, status: 'alive', checkedAt: now() };
}

/**
 * Readiness checks configuration and local runtime state only. Upstream data
 * services are intentionally left to the existing /api/health diagnostics.
 */
export function readinessProbe({ checks = {}, now = () => new Date().toISOString() } = {}) {
  const results = Object.fromEntries(Object.entries(checks).map(([name, check]) => {
    let ok = false;
    try { ok = typeof check === 'function' ? Boolean(check()) : Boolean(check); } catch { ok = false; }
    return [name, ok];
  }));
  const ready = Object.values(results).every(Boolean);
  return { ok: ready, status: ready ? 'ready' : 'degraded', checks: results, checkedAt: now() };
}

export function renderMetrics({ latency, cache, queue, concurrency, runtime, telemetry } = {}) {
  const snapshot = latency || { requests: 0, overBudget: 0, overBudgetRate: 0,
    trackedRoutes: 0, slowest: [] };
  const totals = cache || {};
  const jobs = queue || {};
  const gate = concurrency || {};
  const processStats = runtime || {};
  const observerStats = telemetry || {};
  let text = line('njuredcross_http_requests_total', snapshot.requests || 0, 'HTTP requests sampled since process start');
  text += line('njuredcross_http_requests_over_budget_total', snapshot.overBudget || 0);
  text += line('njuredcross_http_over_budget_ratio', finite(snapshot.overBudgetRate || 0));
  text += line('njuredcross_http_tracked_routes', snapshot.trackedRoutes || 0);
  for (const row of (snapshot.slowest || []).slice(0, 20)) {
    const route = String(row.route || '').replace(/[^A-Za-z0-9_:/-]/g, '_');
    if (!route) continue;
    text += `njuredcross_http_route_p95_ms{route="${route}"} ${finite(row.p95)}\n`;
    text += `njuredcross_http_route_errors_total{route="${route}"} ${finite(row.errors)}\n`;
  }
  for (const key of ['hits', 'staleHits', 'misses', 'loads', 'invalidations', 'evictions', 'entries']) {
    text += line(`njuredcross_display_cache_${key}_total`, finite(totals[key] || 0));
  }
  for (const key of ['queued', 'running', 'done', 'failed']) {
    text += line(`njuredcross_jobs_${key}`, finite(jobs[key] || 0));
  }
  text += line('njuredcross_jobs_runner_active', finite(jobs.runner?.active || 0));
  text += line('njuredcross_http_active_requests', finite(gate.active || 0));
  text += line('njuredcross_http_queued_requests', finite(gate.queued || 0));
  text += line('njuredcross_process_rss_bytes', finite(processStats.rssBytes || 0));
  text += line('njuredcross_process_heap_bytes', finite(processStats.heapBytes || 0));
  text += line('njuredcross_telemetry_dropped_total', finite(observerStats.dropped || 0));
  return text;
}
