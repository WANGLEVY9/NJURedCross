import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/summarize-telemetry.mjs', import.meta.url));
const base = { schema: 1, time: '2026-11-22T04:00:00.000Z', route: '/api/events/event-1/approve' };
const input = [
  { ...base, type: 'dependency', service: 'queue', operation: 'wait', durationMs: 120 },
  { ...base, type: 'dependency', service: 'queue', operation: 'wait', durationMs: 240 },
  { ...base, type: 'dependency', service: 'queue', operation: 'activity-mutation', durationMs: 900 },
  { ...base, type: 'dependency', service: 'queue', operation: 'activity-read', durationMs: 300 },
  { ...base, type: 'dependency', service: 'queue', operation: 'activity-external-write', durationMs: 180 },
  { ...base, type: 'dependency', service: 'background', operation: 'skipped', durationMs: 0 },
  { ...base, type: 'http', durationMs: 1200, status: 200, dependencies: 5 },
  'not telemetry',
].map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n';

test('telemetry summary separates queue phases instead of merging all queue dependencies', () => {
  const result = spawnSync(process.execPath, [script], { input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  const keys = summary.groups.map(group => group.key);
  assert.ok(keys.includes('dependency queue wait /api/events/:id/approve'));
  assert.ok(keys.includes('dependency queue activity-mutation /api/events/:id/approve'));
  assert.ok(keys.includes('dependency queue activity-read /api/events/:id/approve'));
  assert.ok(keys.includes('dependency queue activity-external-write /api/events/:id/approve'));
  assert.ok(keys.includes('dependency background skipped /api/events/:id/approve'));
  const wait = summary.groups.find(group => group.key.includes('queue wait'));
  assert.equal(wait.count, 2);
  assert.equal(wait.p50Ms, 120);
  assert.equal(wait.p95Ms, 240);
  assert.equal(summary.accepted, 7);
  assert.doesNotMatch(result.stdout, /not telemetry/);
});
