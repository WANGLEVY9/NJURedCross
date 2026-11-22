import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateTelemetry, parseTelemetryLines } from '../scripts/telemetry-trace-analysis.js';

const base = {
  schema: 1,
  traceId: '11111111-1111-4111-8111-111111111111',
  requestId: '11111111-1111-4111-8111-111111111111',
  route: '/api/events/event-1/approve',
  type: 'dependency',
};
const at = (seconds) => new Date(Date.parse('2026-11-22T04:00:00.000Z') + seconds * 1000).toISOString();
const span = (spanId, parentSpanId, service, operation, start, durationMs) => ({
  ...base, spanId, parentSpanId, service, operation, durationMs, time: at(start + durationMs / 1000),
});
const request = {
  ...base,
  type: 'http',
  method: 'POST',
  status: 200,
  durationMs: 1200,
  dependencies: 4,
  dependencyMs: 1500,
  time: at(1.2),
};
const input = [
  request,
  span('22222222-2222-4222-8222-222222222222', null, 'queue', 'activity-read', 0, 600),
  span('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'seatable', 'read', 0.1, 200),
  span('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'seatable', 'read', 0.1, 100),
  span('55555555-5555-4555-8555-555555555555', null, 'smtp', 'send', 0.2, 400),
  '{"schema":1,"traceId":"not-a-uuid","type":"http","durationMs":9999,"time":"2026-11-22T04:00:10.000Z"}',
  'not telemetry',
].map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n');

test('trace correlation restores intervals, parallelism and the critical span', () => {
  const result = correlateTelemetry(parseTelemetryLines(input.split('\n')), { minMs: 0, limit: 10 });
  assert.equal(result.totalTraces, 1);
  const trace = result.slowestTraces[0];
  assert.equal(trace.route, '/api/events/:id/approve');
  assert.equal(trace.http.durationMs, 1200);
  assert.equal(trace.dependencyCount, 4);
  assert.equal(trace.rootCount, 2);
  assert.equal(trace.wallMs, 1200);
  assert.equal(trace.coveredMs, 600);
  assert.equal(trace.overlapMs, 700);
  assert.equal(trace.sequentialMs, 600);
  assert.equal(trace.parallelMs, 0);
  assert.equal(trace.uncoveredMs, 600);
  assert.equal(trace.longestChainMs, 600);
  assert.equal(trace.exclusiveSpans[0].service, 'queue');
  assert.equal(trace.exclusiveSpans[0].operation, 'activity-read');
  assert.equal(trace.exclusiveSpans[0].selfMs, 400);
  assert.equal(trace.criticalSpans.at(-1).service, 'seatable');
  assert.equal(trace.gaps.reduce((sum, gap) => sum + gap.durationMs, 0), 600);
  assert.deepEqual(trace.exclusiveSpans.map(item => `${item.service}/${item.operation}:${item.selfMs}`).sort(), [
    'queue/activity-read:400',
    'seatable/read:100',
    'seatable/read:200',
    'smtp/send:400',
  ]);
  assert.equal(trace.criticalSpans[0].selfMs, 400);
  assert.equal(trace.criticalSpans.at(-1).selfMs, 200);
  assert.doesNotMatch(JSON.stringify(result), /not telemetry|not-a-uuid|event-1/);
});

test('trace correlation keeps unrelated traces and short traces separate', () => {
  const other = { ...request, traceId: '66666666-6666-4666-8666-666666666666', requestId: '66666666-6666-4666-8666-666666666666', durationMs: 10, time: at(0.01) };
  const records = parseTelemetryLines([JSON.stringify(other), ...input.split('\n')]);
  const result = correlateTelemetry(records, { minMs: 100, limit: 2 });
  assert.equal(result.totalTraces, 1);
  assert.equal(result.slowestTraces[0].traceId, base.traceId);
  assert.equal(result.routeGroups[0].route, '/api/events/:id/approve');
  assert.ok(result.hotspots.some(group => group.key === 'queue/activity-read'));
});

test('browser observations explain client wait without changing the server critical path', () => {
  const client = {
    ...base,
    type: 'browser',
    phase: 'api',
    outcome: 'success',
    durationMs: 1200,
    time: at(1.2),
  };
  const records = parseTelemetryLines([...input.split('\n'), JSON.stringify(client)]);
  const trace = correlateTelemetry(records, { minMs: 0, limit: 1 }).slowestTraces[0];
  assert.equal(trace.browserCount, 1);
  assert.equal(trace.observedCoveredMs, 1200);
  assert.equal(trace.uncoveredMs, 0);
  assert.equal(trace.longestChainMs, 600);
  assert.equal(trace.criticalSpans.at(-1).service, 'seatable');
});
