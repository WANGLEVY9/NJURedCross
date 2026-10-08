import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { assertApiRequestPath } from '../lib/http/request-path.js';
import { withHttpRequestBudget } from '../lib/http/request-budget.js';
import { apiFailure } from '../lib/http/errors.js';
import { json } from '../lib/http/response.js';

const source = (
  await readFile(new URL('../server.js', import.meta.url), 'utf8')
).replace(/\r\n/g, '\n');

const start = source.indexOf('const server = http.createServer(');
const end = source.indexOf("server.on('error'", start);
assert.ok(start >= 0 && end > start, 'HTTP entry markers must exist');

async function fixture(t) {
  let businessCalls = 0;

  const context = {
    http,
    URL,
    assertApiRequestPath,
    withHttpRequestBudget,
    apiFailure,
    json,
    publicReadCache: { clear() {} },
    clearDisplayReads() {},
    withDisplayReads: operation => operation(),
    api: async (_req, res) => {
      businessCalls++;
      json(res, 200, { ok: true });
    },
    staticFile: async (_req, res) => {
      json(res, 404, { ok: false });
    },
  };

  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\nglobalThis.testServer = server;`,
    context,
  );

  const server = context.testServer;
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