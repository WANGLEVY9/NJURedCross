import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once, EventEmitter } from 'node:events';
import {
  createHttpShutdown,
  registerShutdownCleanup,
} from '../lib/http/shutdown.js';

async function listen(t, server) {
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(() => resolve()));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

function get(port) {
  const completed = Promise.withResolvers();

  const client = http.get({
    hostname: '127.0.0.1',
    port,
    path: '/synthetic',
    agent: false,
  }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => completed.resolve({ body }));
    res.on('error', () => completed.resolve({ disconnected: true }));
    res.on('aborted', () => completed.resolve({ disconnected: true }));
  });

  client.on('error', () => completed.resolve({ disconnected: true }));
  return { client, completed: completed.promise };
}

test('invalid shutdown options are rejected', () => {
  assert.throws(() => createHttpShutdown(null), TypeError);

  const server = http.createServer();
  for (const timeoutMs of [0, -1, NaN, 1.5, 2147483648]) {
    assert.throws(
      () => createHttpShutdown(server, { timeoutMs }),
      TypeError,
    );
  }
});

test('a server that never started can be stopped repeatedly', async () => {
  const server = http.createServer();
  const shutdown = createHttpShutdown(server);
  const first = shutdown.stop();

  assert.equal(shutdown.stop(), first);
  assert.deepEqual(await first, { forced: false });
});

test('shutdown allows an active HTTP response to finish', {
  timeout: 5000,
}, async t => {
  const received = Promise.withResolvers();
  const server = http.createServer((req, res) => {
    received.resolve(res);
  });
  const shutdown = createHttpShutdown(server, { timeoutMs: 3000 });
  const port = await listen(t, server);
  const request = get(port);
  t.after(() => request.client.destroy());

  const response = await received.promise;
  const stopping = shutdown.stop();

  assert.equal(shutdown.stop(), stopping);
  response.end('synthetic response');

  assert.deepEqual(await request.completed, {
    body: 'synthetic response',
  });
  assert.deepEqual(await stopping, { forced: false });
  assert.equal(server.listening, false);
});

test('shutdown closes an unfinished connection after its deadline', {
  timeout: 5000,
}, async t => {
  const received = Promise.withResolvers();
  const server = http.createServer(() => {
    received.resolve();
    // Intentionally leave this synthetic request unfinished.
  });
  const shutdown = createHttpShutdown(server, { timeoutMs: 100 });
  const port = await listen(t, server);
  const request = get(port);
  t.after(() => request.client.destroy());

  await received.promise;
  const result = await shutdown.stop();

  assert.deepEqual(result, { forced: true });
  assert.deepEqual(await request.completed, { disconnected: true });
  assert.equal(server.listening, false);
});

test('shutdown cleanup runs once when shutdown starts', () => {
  const server = new EventEmitter();
  let calls = 0;
  registerShutdownCleanup(server, () => { calls++; });

  server.emit('shutdown');
  server.emit('shutdown');
  server.emit('close');

  assert.equal(calls, 1);
  assert.equal(server.listenerCount('shutdown'), 0);
  assert.equal(server.listenerCount('close'), 0);
});

test('ordinary server closure also runs cleanup once', () => {
  const server = new EventEmitter();
  let calls = 0;
  registerShutdownCleanup(server, () => { calls++; });

  server.emit('close');
  server.emit('shutdown');

  assert.equal(calls, 1);
  assert.equal(server.listenerCount('shutdown'), 0);
  assert.equal(server.listenerCount('close'), 0);
});

test('invalid shutdown cleanup arguments are rejected', () => {
  assert.throws(
    () => registerShutdownCleanup(null, () => {}),
    TypeError,
  );
  assert.throws(
    () => registerShutdownCleanup(new EventEmitter(), null),
    TypeError,
  );
});