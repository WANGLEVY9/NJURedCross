import { telemetryRoute } from '../public/app/shared/telemetry-route.js';

const uuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
const label = value => typeof value === 'string' && /^[a-z][a-z-]{0,40}$/i.test(value)
  ? value.toLowerCase().slice(0, 41) : '';
const finite = value => Number.isFinite(value) && value >= 0 ? value : 0;

function intervalsOf(rows) {
  return rows.map(row => [row.start, row.end]).filter(([start, end]) => end > start);
}

function coveredMs(rows) {
  const intervals = intervalsOf(rows).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current = null;
  for (const [start, end] of intervals) {
    if (!current) current = [start, end];
    else if (start > current[1]) {
      total += current[1] - current[0];
      current = [start, end];
    } else current[1] = Math.max(current[1], end);
  }
  if (current) total += current[1] - current[0];
  return total;
}

function gapsOf(rows, from, to) {
  const gaps = [];
  let cursor = from;
  for (const [start, end] of intervalsOf(rows).sort((a, b) => a[0] - b[0])) {
    const left = Math.max(from, start);
    const right = Math.min(to, end);
    if (left > cursor) gaps.push([cursor, left]);
    cursor = Math.max(cursor, right);
  }
  if (cursor < to) gaps.push([cursor, to]);
  return gaps.map(([start, end]) => ({ startMs: Math.round(start - from), durationMs: Math.round(end - start) }))
    .filter(gap => gap.durationMs > 0);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function describeSpan(row, extra = {}) {
  const result = {
    spanId: row.spanId,
    service: row.service,
    operation: row.operation,
    durationMs: round(row.durationMs),
    ...extra,
  };
  Object.keys(result).forEach(key => result[key] === undefined && delete result[key]);
  return result;
}

export function analyzeTrace(traceId, sourceRows) {
  const rows = [];
  for (const record of sourceRows) {
    if (record?.schema !== 1 || !['http', 'dependency', 'browser'].includes(record.type)) continue;
    const row = {
      type: record.type,
      traceId: uuid(record.traceId) || uuid(record.requestId) || uuid(record.clientTrace),
      requestId: uuid(record.requestId),
      clientTrace: uuid(record.clientTrace),
      spanId: uuid(record.spanId),
      parentSpanId: uuid(record.parentSpanId),
      route: telemetryRoute(record.route),
      method: label(record.method),
      service: label(record.service),
      operation: label(record.operation),
      phase: label(record.phase),
      durationMs: finite(record.durationMs),
      status: Number.isFinite(record.status) ? record.status : null,
      ok: record.ok === true,
      aborted: record.aborted === true,
      dependencies: finite(record.dependencies),
      dependencyMs: finite(record.dependencyMs),
      end: typeof record.time === 'string' ? Date.parse(record.time) : NaN,
      outcome: label(record.outcome),
    };
    if (!row.traceId || row.traceId !== traceId || !Number.isFinite(row.end)) continue;
    row.start = row.end - row.durationMs;
    if (row.type === 'dependency' && !row.spanId) continue;
    rows.push(row);
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.start - b.start || a.end - b.end);

  const http = rows.find(row => row.type === 'http') || null;
  const browser = rows.filter(row => row.type === 'browser');
  const dependencies = rows.filter(row => row.type === 'dependency');
  const observed = [...dependencies, ...browser];
  const bySpan = new Map(dependencies.map(row => [row.spanId, row]));
  const children = new Map();
  for (const row of dependencies) {
    const parent = row.parentSpanId && bySpan.has(row.parentSpanId) ? row.parentSpanId : '__root__';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(row);
  }
  const roots = children.get('__root__') || [];
  const bounds = observed.length ? observed : [http].filter(Boolean);
  const wallFrom = http ? http.start : Math.min(...bounds.map(row => row.start));
  const wallTo = http ? http.end : Math.max(...bounds.map(row => row.end));
  const wallMs = Math.max(0, wallTo - wallFrom);
  const dependencyCoveredMs = coveredMs(dependencies);
  const observedCoveredMs = coveredMs(observed);
  const overlappingMs = dependencies.reduce((sum, row) => sum + row.durationMs, 0) - dependencyCoveredMs;
  const gaps = gapsOf(observed, wallFrom, wallTo);
  const gapsMs = Math.max(0, wallMs - observedCoveredMs);

  const exclusive = new Map();
  const critical = new Map();
  const paths = new Map();
  const criticalPath = row => {
    if (critical.has(row.spanId)) return critical.get(row.spanId);
    const kids = children.get(row.spanId) || [];
    const self = Math.max(0, row.durationMs - coveredMs(kids));
    exclusive.set(row.spanId, self);
    let best = 0;
    let path = [];
    for (const child of kids) {
      const candidate = criticalPath(child);
      if (candidate > best) {
        best = candidate;
        path = [child.spanId, ...paths.get(child.spanId)];
      }
    }
    critical.set(row.spanId, self + best);
    paths.set(row.spanId, path);
    return self + best;
  };
  for (const root of roots) criticalPath(root);

  // Sequential dependency windows are the union of top-level spans. Gaps
  // between those windows are either application work or unobserved waiting.
  const rootIntervals = intervalsOf(roots).sort((a, b) => a[0] - b[0]);
  const sequentialMs = coveredMs(roots);
  const parallelMs = Math.max(0, dependencyCoveredMs - sequentialMs);
  const exclusiveSpans = [...exclusive]
    .map(([spanId, selfMs]) => describeSpan(bySpan.get(spanId), { selfMs: round(selfMs) }))
    .filter(span => span.selfMs > 0)
    .sort((a, b) => b.selfMs - a.selfMs);
  const longestChain = roots.reduce((best, root) => {
    const value = critical.get(root.spanId) || 0;
    return value > best.value ? { value, path: [root.spanId, ...paths.get(root.spanId)] } : best;
  }, { value: 0, path: [] });
  const criticalSpans = longestChain.path
    .filter(spanId => bySpan.has(spanId))
    .map(spanId => describeSpan(bySpan.get(spanId), { selfMs: round(exclusive.get(spanId) || 0) }));

  return {
    traceId,
    route: http?.route || dependencies.find(row => row.route)?.route || browser.find(row => row.route)?.route || '',
    http: http ? {
      durationMs: round(http.durationMs),
      status: http.status,
      aborted: http.aborted,
      dependencies: http.dependencies,
      dependencyMs: round(http.dependencyMs),
    } : null,
    browserCount: browser.length,
    dependencyCount: dependencies.length,
    rootCount: roots.length,
    wallMs: round(wallMs),
    coveredMs: round(dependencyCoveredMs),
    observedCoveredMs: round(observedCoveredMs),
    uncoveredMs: round(gapsMs),
    overlapMs: round(overlappingMs),
    sequentialMs: round(sequentialMs),
    parallelMs: round(parallelMs),
    longestChainMs: round(longestChain.value),
    gaps: gaps.sort((a, b) => b.durationMs - a.durationMs).slice(0, 8),
    exclusiveSpans: exclusiveSpans.slice(0, 10),
    criticalSpans,
    rootIntervals: rootIntervals.length,
  };
}

export function parseTelemetryLines(lines) {
  const rows = [];
  for (const line of lines) {
    try {
      let record = JSON.parse(line);
      if (typeof record.MESSAGE === 'string') record = JSON.parse(record.MESSAGE);
      if (record?.schema === 1) rows.push(record);
    } catch { /* Ignore non-telemetry application messages. */ }
  }
  return rows;
}

export function correlateTelemetry(records, options = {}) {
  const minMs = Number.isFinite(options.minMs) ? options.minMs : 0;
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : 20;
  const byTrace = new Map();
  for (const record of records) {
    const id = uuid(record.traceId) || uuid(record.requestId) || uuid(record.clientTrace);
    if (!id) continue;
    if (!byTrace.has(id)) byTrace.set(id, []);
    byTrace.get(id).push(record);
  }
  const traces = [];
  for (const [traceId, rows] of byTrace) {
    const analysis = analyzeTrace(traceId, rows);
    if (analysis && analysis.wallMs >= minMs) traces.push(analysis);
  }
  traces.sort((a, b) => b.wallMs - a.wallMs || b.longestChainMs - a.longestChainMs);
  const routes = new Map();
  for (const trace of traces) {
    const key = trace.route || '(no-route)';
    const group = routes.get(key) || { route: key, traces: 0, maxWallMs: 0, totalUncoveredMs: 0, totalParallelMs: 0, topSpan: null, topSpanMs: 0 };
    group.traces++;
    group.maxWallMs = Math.max(group.maxWallMs, trace.wallMs);
    group.totalUncoveredMs += trace.uncoveredMs;
    group.totalParallelMs += trace.parallelMs;
    const top = trace.exclusiveSpans[0];
    if (top && top.selfMs > group.topSpanMs) {
      group.topSpanMs = top.selfMs;
      group.topSpan = `${top.service}/${top.operation}`;
    }
    routes.set(key, group);
  }
  const hotspots = new Map();
  for (const trace of traces) {
    for (const span of trace.exclusiveSpans.slice(0, 3)) {
      const key = `${span.service}/${span.operation}`;
      const group = hotspots.get(key) || { key, traces: 0, totalSelfMs: 0, maxSelfMs: 0 };
      group.traces++;
      group.totalSelfMs += span.selfMs;
      group.maxSelfMs = Math.max(group.maxSelfMs, span.selfMs);
      hotspots.set(key, group);
    }
  }
  return {
    totalTraces: traces.length,
    returnedTraces: Math.min(limit, traces.length),
    slowestTraces: traces.slice(0, limit),
    routeGroups: [...routes.values()]
      .map(group => ({ ...group, totalUncoveredMs: round(group.totalUncoveredMs), totalParallelMs: round(group.totalParallelMs) }))
      .sort((a, b) => b.maxWallMs - a.maxWallMs).slice(0, 20),
    hotspots: [...hotspots.values()]
      .map(group => ({ ...group, totalSelfMs: round(group.totalSelfMs) }))
      .sort((a, b) => b.totalSelfMs - a.totalSelfMs).slice(0, 20),
  };
}
