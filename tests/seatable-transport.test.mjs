import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { Base } from 'seatable-api';
import { installSeaTableTransport } from '../lib/http/seatable-transport.js';
import { createSeaTableAccess } from '../lib/seatable-auth.js';
import { apiFailure } from '../lib/http/errors.js';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('seatable-api'));
const axios = sdkRequire('axios');

installSeaTableTransport();
// Short deadline only in this isolated test process.
axios.defaults.timeout = 1000;

async function fixture(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });

  return `http://127.0.0.1:${server.address().port}`;
}

function authResponse(res, endpoint) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    app_name: 'synthetic',
    access_token: 'synthetic-access',
    dtable_uuid: 'synthetic-base',
    dtable_server: `${endpoint}/`,
  }));
}

test('SDK authentication timeout closes the connection and permits retry', async t => {
  let endpoint;
  let hang = true;
  let requests = 0;
  const disconnected = Promise.withResolvers();

  endpoint = await fixture(t, (_req, res) => {
    requests++;
    if (hang) {
      res.on('close', () => disconnected.resolve());
      return;
    }
    authResponse(res, endpoint);
  });

  const base = new Base({
    server: endpoint,
    APIToken: 'synthetic-token',
  });
  const access = createSeaTableAccess(base);

  await assert.rejects(
    access(),
    error => error.code === 'external_request_timeout'
      && apiFailure(error).status === 503,
  );
  await disconnected.promise;

  hang = false;
  assert.equal(await access(), base);
  assert.equal(requests, 2);
});

test('SDK row reads abort unfinished response bodies', async t => {
  let endpoint;
  const disconnected = Promise.withResolvers();

  endpoint = await fixture(t, (req, res) => {
    if (req.url.startsWith('/api/v2.1/dtable/app-access-token/')) {
      return authResponse(res, endpoint);
    }

    res.on('close', () => disconnected.resolve());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"rows":[');
  });

  const base = new Base({
    server: endpoint,
    APIToken: 'synthetic-token',
  });
  await base.auth();

  await assert.rejects(
    base.listRows('fixture', '', '', false, 0, 100),
    error => error.code === 'external_request_timeout',
  );
  await disconnected.promise;
});

test('SDK upstream authentication status remains available', async t => {
  const endpoint = await fixture(t, (_req, res) => {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'synthetic denial' }));
  });

  const base = new Base({
    server: endpoint,
    APIToken: 'synthetic-token',
  });

  await assert.rejects(base.auth(), error => {
    assert.equal(error.response.status, 403);
    assert.equal(apiFailure(error).status, 503);
    assert.equal(apiFailure(error).payload.code, 'seatable_auth_failed');
    return true;
  });
});

test('SDK writes time out without automatic retry', async t => {
  let endpoint;
  let writes = 0;
  const disconnected = Promise.withResolvers();

  endpoint = await fixture(t, async (req, res) => {
    if (req.url.startsWith('/api/v2.1/dtable/app-access-token/')) {
      return authResponse(res, endpoint);
    }

    writes++;
    for await (const chunk of req) {
      void chunk;
    }
    res.on('close', () => disconnected.resolve());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"success":');
  });

  const base = new Base({
    server: endpoint,
    APIToken: 'synthetic-token',
  });
  await base.auth();

  await assert.rejects(
    base.appendRow('fixture', { label: 'synthetic' }),
    error => error.code === 'external_request_timeout',
  );
  await disconnected.promise;
  assert.equal(writes, 1);
});
test('SDK API Gateway requests also enforce the deadline', async t => {
  let endpoint;
  const disconnected = Promise.withResolvers();

  endpoint = await fixture(t, (req, res) => {
    if (req.url.startsWith('/api/v2.1/dtable/app-access-token/')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        app_name: 'synthetic',
        access_token: 'synthetic-access',
        dtable_uuid: 'synthetic-base',
        use_api_gateway: true,
      }));
    }

    assert.ok(req.url.startsWith('/api-gateway/'));
    res.on('close', () => disconnected.resolve());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"rows":[');
  });

  const base = new Base({
    server: endpoint,
    APIToken: 'synthetic-token',
  });
  await base.auth();

  await assert.rejects(
    base.listRows('fixture', '', '', false, 0, 100),
    error => error.code === 'external_request_timeout',
  );
  await disconnected.promise;
});

test('SDK HTTP client honours caller cancellation', async t => {
  let endpoint;
  const received = Promise.withResolvers();
  const disconnected = Promise.withResolvers();

  endpoint = await fixture(t, (req, res) => {
    if (req.url.startsWith('/api/v2.1/dtable/app-access-token/')) {
      return authResponse(res, endpoint);
    }

    res.on('close', () => disconnected.resolve());
    received.resolve();
  });

  const base = new Base({
    server: endpoint,
    APIToken: 'synthetic-token',
  });
  await base.auth();

  const controller = new AbortController();
  const operation = base.req.get('/synthetic-cancellation', {
    signal: controller.signal,
  });
  const rejection = assert.rejects(
    operation,
    error => error.code === 'ERR_CANCELED'
    && apiFailure(error).status === 503
    && apiFailure(error).payload.code === 'external_request_cancelled',
  );

  await received.promise;
  controller.abort();
  await rejection;
  await disconnected.promise;
});
