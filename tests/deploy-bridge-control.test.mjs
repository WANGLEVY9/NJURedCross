import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isReadyPage, waitForReady, run, READY_TIMEOUT_MS, READY_STREAK } from '../scripts/deploy-bridge-control.mjs';

const page = { status: 200, body: '<!doctype html><div id="root"></div>' };
const healthy = async () => page;

test('readiness window is long enough for a cold 1 GiB instance', () => {
  // 10 秒窗口在 2026-11-14 把「部署慢」放大成 6 分钟全站 503。
  assert.ok(READY_TIMEOUT_MS >= 180000, `ready timeout is ${READY_TIMEOUT_MS}ms`);
  assert.equal(READY_STREAK, 2);
});

test('a page without the application shell is not treated as ready', () => {
  assert.equal(isReadyPage(page), true);
  assert.equal(isReadyPage({ status: 200, body: '<h1>502 Bad Gateway</h1>' }), false);
  assert.equal(isReadyPage({ status: 502, body: '<div id="root"></div>' }), false);
  assert.equal(isReadyPage({}), false);
  assert.equal(isReadyPage(), false);
});

test('readiness requires two consecutive good responses and tolerates a failed probe', async () => {
  const answers = [new Error('ECONNREFUSED'), { status: 200, body: '<div id="root"></div>' }, { status: 503, body: '' }, page, page];
  let calls = 0;
  const result = await waitForReady({ probe: async () => { const next = answers[calls++]; if (next instanceof Error) throw next; return next; }, timeoutMs: 5000, pollMs: 1 });
  assert.equal(result.ready, true);
  assert.equal(calls, 5);
  assert.equal(result.lastError, null);
});

test('a backend that never answers gives up inside the window and reports why', async () => {
  let calls = 0;
  const started = Date.now();
  const result = await waitForReady({ probe: async () => { calls++; return { status: 503, body: '' }; }, timeoutMs: 40, pollMs: 5 });
  assert.equal(result.ready, false);
  assert.equal(result.lastError, 'http 503');
  assert.ok(result.waitedMs >= 40 && result.waitedMs < 5000, `waited ${result.waitedMs}ms`);
  assert.ok(calls > 1);
  assert.ok(Date.now() - started < 5000);
});

test('resume releases the queue even when the backend is still starting', async () => {
  const sent = [];
  const receipt = await run('resume', { probe: async () => ({ status: 502, body: 'Upstream unavailable' }), timeoutMs: 30, send: async action => { sent.push(action); return '{"paused":false,"active":0,"queued":4}'; } });
  assert.deepEqual(sent, ['resume']);
  assert.equal(receipt.action, 'resume');
  assert.equal(receipt.ready, false);
  assert.equal(receipt.lastError, 'http 502');
  assert.deepEqual(receipt.bridge, { paused: false, active: 0, queued: 4 });
});

test('resume reports a genuinely ready backend without extra probing', async () => {
  const sent = [];
  const receipt = await run('resume', { probe: healthy, timeoutMs: 5000, send: async action => { sent.push(action); return '{"paused":false,"active":0,"queued":0}'; } });
  assert.deepEqual(sent, ['resume']);
  assert.equal(receipt.ready, true);
  assert.equal(receipt.lastError, null);
});

test('pause and status never wait for the backend', async () => {
  const sent = [];
  let probed = 0;
  const send = async action => { sent.push(action); return '{"paused":true,"active":0,"queued":0}'; };
  const probe = async () => { probed++; return page; };
  assert.equal((await run('pause', { probe, send })).bridge.paused, true);
  assert.equal((await run('status', { probe, send })).bridge.paused, true);
  assert.deepEqual(sent, ['pause', 'status']);
  assert.equal(probed, 0);
});

test('a broken control channel still fails loudly', async () => {
  await assert.rejects(run('resume', { probe: healthy, timeoutMs: 5000, send: async () => { throw Error('Deployment bridge control timed out'); } }), /timed out/);
  await assert.rejects(run('pause', { send: async () => { throw Error('Deployment bridge rejected pause'); } }), /rejected pause/);
});
