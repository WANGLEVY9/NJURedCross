import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { assertApiRequestPath } from '../lib/http/request-path.js';
import { requestBudgetMsFor, withHttpRequestBudget } from '../lib/http/request-budget.js';
import { json } from '../lib/http/response.js';
import { isDisplayRequest } from '../lib/http/display-reads.js';
import { createRequestMiddleware } from '../lib/http/request-middleware.js';
import { createRequestConcurrencyGate } from '../lib/http/request-limits.js';

async function fixture(t) {
  let businessCalls = 0;
  const middleware = createRequestMiddleware({
    api: async (_req, res) => {
      businessCalls++;
      json(res, 200, { ok: true });
    },
    staticFile: async (_req, res) => json(res, 404, { ok: false }),
    pdfAssets: async () => false,
    backgroundGate: { mark() {} },
    requestGate: createRequestConcurrencyGate({ limit: 8, queueLimit: 8 }),
    assertApiRequestPath,
    isDisplayRequest,
    invalidateWrittenSnapshots: () => {},
    requestBudgetMsFor,
    withHttpRequestBudget,
    withDisplayReads: operation => operation(),
    createWriteJournal: () => new Set(),
    withWriteJournal: (_journal, operation) => operation(),
    clientTelemetry: async (_req, res) => json(res, 204, { ok: true }),
    enforcePublicLimit: () => {},
    handleGame: async (_req, res) => json(res, 200, { ok: true }),
    latency: { start() {}, snapshot: () => ({ requests: 0, overBudget: 0,
      overBudgetRate: 0, trackedRoutes: 0, slowest: [] }) },
  });
  const server = http.createServer((req, res) => {
    void middleware(req, res).catch(() => { if (!res.writableEnded) res.destroy(); });
  });
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  function request(path, method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path,
        method,
        agent: false,
      }, res => {
        const chunks = [];
        res.on('error', reject);
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  return { request, businessCalls: () => businessCalls };
}

test('actual HTTP entry rejects broken escapes before dispatch', async t => {
  const f = await fixture(t);

  for (const path of [
    '/api/events/%',
    '/api/events/%2',
    '/api/events/%GG',
  ]) {
    const result = await f.request(path, 'POST');
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'invalid_request_path');
  }

  assert.equal(f.businessCalls(), 0);
});

test('actual HTTP entry rejects invalid UTF-8 before dispatch', async t => {
  const f = await fixture(t);

  for (const path of [
    '/api/events/%C3%28',
    '/api/events/%E4%B8',
    '/api/events/%FF',
  ]) {
    const result = await f.request(path);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'invalid_request_path');
  }

  assert.equal(f.businessCalls(), 0);
});

test('actual HTTP entry rejects encoded controls before dispatch', async t => {
  const f = await fixture(t);

  for (const suffix of ['%00', '%0A', '%0D', '%7F']) {
    const result = await f.request(`/api/events/${suffix}`, 'POST');
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'invalid_request_path');
  }

  assert.equal(f.businessCalls(), 0);
});

test('valid encoded paths still dispatch after rejected requests', async t => {
  const f = await fixture(t);

  assert.equal((await f.request('/api/events/%')).status, 400);

  for (const id of ['合成活动', 'notice%', 'notice%41']) {
    const result = await f.request(
      `/api/events/${encodeURIComponent(id)}`,
      'POST',
    );
    assert.equal(result.status, 200);
  }

  assert.equal(f.businessCalls(), 3);
});
