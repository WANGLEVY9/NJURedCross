import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import {
  withHttpRequestBudget,
} from '../lib/http/request-budget.js';
import { runExternalRequest } from '../lib/http/external-request.js';
import { createPasswordWorkQueue } from '../lib/identity/password-work.js';

test('HTTP disconnect cancels external work and releases queue capacity', {
  timeout: 5000,
}, async t => {
  const queue = createPasswordWorkQueue({
    concurrency: 1,
    maxWaiting: 1,
  });

  const started = Promise.withResolvers();
  const finished = Promise.withResolvers();
  let externalAborted = false;

  const server = http.createServer(async (req, res) => {
    try {
      await withHttpRequestBudget(req, res, () =>
        queue(() => runExternalRequest(signal => {
          return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
              externalAborted = true;
              reject(signal.reason);
            }, { once: true });
            started.resolve();
          });
        })),
      );
      finished.resolve({ unexpectedSuccess: true });
    } catch (error) {
      finished.resolve({ code: error.code });
    }
  });

  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const client = http.request({
    hostname: '127.0.0.1',
    port: server.address().port,
    path: '/synthetic',
    method: 'GET',
    agent: false,
  });

  // A deliberate client disconnect may emit ECONNRESET.
  client.on('error', () => {});
  t.after(() => client.destroy());
  client.end();

  await started.promise;
  client.destroy();

  const outcome = await finished.promise;
  assert.equal(outcome.code, 'external_request_cancelled');
  assert.equal(externalAborted, true);

  // This must run after the interrupted operation releases its slot.
  const next = await queue(() => 'next operation completed');
  assert.equal(next, 'next operation completed');
});