import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import { collectRequestBody } from '../lib/http/request-body.js';
import { withRequestBudget } from '../lib/http/request-budget.js';
import http from 'node:http';
import { once } from 'node:events';
import { withHttpRequestBudget } from '../lib/http/request-budget.js';
import { createMutationQueue } from '../lib/events/safety.js';

test('body collector preserves complete request content', async () => {
  const req = Readable.from([
    Buffer.from('first'),
    Buffer.from('-second'),
  ]);

  const result = await withRequestBudget(
    () => collectRequestBody(req, 100),
  );

  assert.equal(result.toString(), 'first-second');
});

test('body collector rejects content beyond the limit', async () => {
  const req = Readable.from([Buffer.from('too-large')]);

  await assert.rejects(
    withRequestBudget(() => collectRequestBody(req, 3)),
    error => error.statusCode === 413,
  );
});

test('deadline destroys a stalled request body stream', async () => {
  const req = new PassThrough();
  req.write('unfinished');

  await assert.rejects(
    withRequestBudget(
      () => collectRequestBody(req, 100),
      { timeoutMs: 100 },
    ),
    error => error.code === 'external_request_timeout',
  );

  assert.equal(req.destroyed, true);
});

test('caller cancellation terminates body reading', async () => {
  const req = new PassThrough();
  const controller = new AbortController();

  const operation = withRequestBudget(
    () => collectRequestBody(req, 100),
    { signal: controller.signal },
  );
  const rejected = assert.rejects(
    operation,
    error => error.code === 'external_request_cancelled',
  );

  controller.abort();

  await rejected;
  assert.equal(req.destroyed, true);
});

test('completed body reading removes its abort listener', async () => {
  const controller = new AbortController();
  const req = Readable.from([Buffer.from('complete')]);

  await withRequestBudget(
    () => collectRequestBody(req, 100),
    { signal: controller.signal },
  );

  controller.abort();
  assert.equal(req.errored, null);
});
test('stalled HTTP upload ends and releases the mutation queue', async t => {
  const queue = createMutationQueue();
  const started = Promise.withResolvers();
  const settled = Promise.withResolvers();
  let writes = 0;

  const server = http.createServer(async (req, res) => {
    try {
      await withHttpRequestBudget(req, res, () =>
        queue(async () => {
          started.resolve();
          await collectRequestBody(req, 1000);
          writes++;
          res.end('unexpected');
        }),
        { timeoutMs: 1000 },
      );
      settled.resolve({ unexpectedSuccess: true });
    } catch (error) {
      settled.resolve({ code: error.code });
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });

  const request = http.request({
    hostname: '127.0.0.1',
    port: server.address().port,
    path: '/synthetic-upload',
    method: 'POST',
    headers: { 'Content-Length': '100' },
  });
  request.on('error', () => {});
  const clientClosed = new Promise(resolve =>
    request.once('close', resolve),
  );
  t.after(() => request.destroy());

  // Send only part of the advertised body and never finish it.
  request.write('partial');
  await started.promise;

  const next = queue(async () => 'next-operation');
  const result = await settled.promise;

  assert.equal(result.code, 'external_request_timeout');
  assert.equal(await next, 'next-operation');
  assert.equal(writes, 0);
  await clientClosed;
});