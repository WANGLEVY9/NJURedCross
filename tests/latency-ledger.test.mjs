import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLatencyLedger } from '../lib/http/latency-ledger.js';

/** A controllable clock plus a helper that "runs" one request of a given cost. */
function harness(options = {}) {
  let clock = 0;
  const ledger = createLatencyLedger({ now: () => clock, ...options });

  function run(url, { ms = 0, statusCode = 200 } = {}) {
    const req = { url };
    const res = new EventEmitter();
    res.statusCode = statusCode;
    ledger.start(req, res);
    clock += ms;
    res.emit('finish');
    return ledger;
  }

  return { ledger, run, advance: (ms) => { clock += ms; } };
}

test('non-api traffic is not tracked', () => {
  const { ledger, run } = harness();
  run('/styles/app.css', { ms: 40 });
  run('/app/main.js', { ms: 40 });
  assert.equal(ledger.snapshot().requests, 0);
});

test('an api request is recorded against its route', () => {
  const { ledger, run } = harness();
  run('/api/materials/overview?x=1', { ms: 12 });
  const snap = ledger.snapshot();
  assert.equal(snap.requests, 1);
  assert.equal(snap.slowest[0].route, '/api/materials/overview');
  assert.equal(snap.slowest[0].count, 1);
  assert.equal(snap.slowest[0].p50, 12);
});

test('record ids collapse into the same route', () => {
  const { ledger, run } = harness();
  run('/api/materials/applications/abc123', { ms: 10 });
  run('/api/materials/applications/def456', { ms: 20 });
  const snap = ledger.snapshot();
  assert.equal(snap.trackedRoutes, 1);
  assert.equal(snap.slowest[0].count, 2);
});

test('requests over one second are counted and ranked first', () => {
  const { ledger, run } = harness();
  run('/api/public/overview', { ms: 20 });
  run('/api/console/tasks', { ms: 2400 });
  const snap = ledger.snapshot();
  assert.equal(snap.budgetMs, 1000);
  assert.equal(snap.overBudget, 1);
  assert.equal(snap.overBudgetRate, 50);
  assert.equal(snap.slowest[0].route, '/api/console/tasks', 'the slow route sorts first');
  assert.equal(snap.slowest[0].overBudget, 1);
});

test('exactly one second is within budget', () => {
  const { ledger, run } = harness();
  run('/api/public/events', { ms: 1000 });
  assert.equal(ledger.snapshot().overBudget, 0);
});

test('percentiles come from the recent samples only', () => {
  const { ledger, run } = harness({ sampleLimit: 4 });
  for (const ms of [100, 200, 300, 400, 500, 600]) run('/api/public/events', { ms });
  const entry = ledger.snapshot().slowest[0];
  assert.equal(entry.count, 6, 'every request is counted');
  // The window holds the newest four: 300, 400, 500, 600.
  assert.equal(entry.p50, 400);
  assert.equal(entry.p95, 600);
  assert.equal(entry.max, 600, 'max is kept across the whole life of the route');
});

test('5xx responses are counted per route', () => {
  const { ledger, run } = harness();
  run('/api/outreach/overview', { ms: 30, statusCode: 503 });
  run('/api/outreach/overview', { ms: 30 });
  assert.equal(ledger.snapshot().slowest[0].errors, 1);
});

test('the route table stays bounded but totals keep counting', () => {
  const { ledger, run } = harness({ routeLimit: 3 });
  for (const name of ['overview', 'events', 'checklist', 'submissions', 'interests']) {
    run(`/api/public/${name}`, { ms: 10 });
  }
  const snap = ledger.snapshot({ includeAll: true });
  assert.equal(snap.trackedRoutes, 3, 'oldest routes are evicted');
  assert.equal(snap.requests, 5, 'every request is still counted');
});

test('close without finish still records the request', () => {
  const { ledger } = harness();
  const req = { url: '/api/console/tasks' };
  const res = new EventEmitter();
  res.statusCode = 200;
  ledger.start(req, res);
  res.emit('close');
  assert.equal(ledger.snapshot().requests, 1);
});

test('a snapshot can be limited to one surface', () => {
  const { ledger, run } = harness();
  run('/api/console/tasks', { ms: 800 });
  run('/api/public/overview', { ms: 20 });
  const consoleOnly = ledger.snapshot({ filter: (route) => route.startsWith('/api/console') });
  assert.equal(consoleOnly.slowest.length, 1);
  assert.equal(consoleOnly.slowest[0].route, '/api/console/tasks');
  assert.equal(consoleOnly.requests, 2, 'totals stay process-wide');
});

test('the same route is not recorded twice when finish follows close', () => {
  const { ledger } = harness();
  const req = { url: '/api/console/tasks' };
  const res = new EventEmitter();
  res.statusCode = 200;
  ledger.start(req, res);
  res.emit('close');
  res.emit('finish');
  assert.equal(ledger.snapshot().requests, 1);
});
