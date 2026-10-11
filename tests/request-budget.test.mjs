import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertRequestActive,
  withRequestBudget,
  withHttpRequestBudget,
  withoutRequestBudget,
} from '../lib/http/request-budget.js';
import { runExternalRequest } from '../lib/http/external-request.js';
import { createMutationQueue } from '../lib/events/safety.js';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { createSeaTableAccess } from '../lib/seatable-auth.js';
import { createReadCache } from '../lib/http/read-cache.js';

function waitForAbort(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    });
  });
}

test('external work is cancelled by the shared operation deadline', async () => {
  await assert.rejects(
    withRequestBudget(
      () => runExternalRequest(waitForAbort, { timeoutMs: 5000 }),
      { timeoutMs: 100 },
    ),
    error => error.code === 'external_request_timeout',
  );
});

test('expired operations cannot start subsequent external requests', async () => {
  let calls = 0;

  await withRequestBudget(async () => {
    await delay(100);

    await assert.rejects(
      runExternalRequest(async () => {
        calls++;
      }),
      error => error.code === 'external_request_timeout',
    );
  }, { timeoutMs: 30 });

  assert.equal(calls, 0);
});

test('queued operations cancelled while waiting never execute', async () => {
  const queue = createMutationQueue();
  const release = Promise.withResolvers();
  const started = Promise.withResolvers();
  let calls = 0;

  const first = queue(async () => {
    started.resolve();
    await release.promise;
  });
  await started.promise;

  const controller = new AbortController();
  const second = withRequestBudget(
    () => queue(async () => { calls++; }),
    { signal: controller.signal },
  );
  const rejected = assert.rejects(
    second,
    error => error.code === 'external_request_cancelled',
  );

  controller.abort();
  release.resolve();

  await first;
  await rejected;
  assert.equal(calls, 0);
  assert.equal(await queue(async () => 'next'), 'next');
});

test('queue waits for task cleanup before starting the next operation', async () => {
  const queue = createMutationQueue();
  const started = Promise.withResolvers();
  const cleanupStarted = Promise.withResolvers();
  const allowCleanup = Promise.withResolvers();
  const order = [];

  const first = withRequestBudget(() => queue(async () => {
    started.resolve();
    try {
      await runExternalRequest(waitForAbort, { timeoutMs: 5000 });
    } finally {
      order.push('cleanup-start');
      cleanupStarted.resolve();
      await allowCleanup.promise;
      order.push('cleanup-end');
    }
  }), { timeoutMs: 100 });

  const rejected = assert.rejects(
    first,
    error => error.code === 'external_request_timeout',
  );

  await started.promise;
  const second = queue(async () => {
    order.push('next');
  });

  await cleanupStarted.promise;
  assert.deepEqual(order, ['cleanup-start']);
  allowCleanup.resolve();

  await rejected;
  await second;
  assert.deepEqual(order, ['cleanup-start', 'cleanup-end', 'next']);
});

test('request budgets are isolated between concurrent operations', async () => {
  await Promise.all([
    assert.rejects(
      withRequestBudget(
        () => runExternalRequest(waitForAbort),
        { timeoutMs: 30 },
      ),
      error => error.code === 'external_request_timeout',
    ),
    withRequestBudget(async () => {
      await delay(100);
      assertRequestActive();
    }, { timeoutMs: 2000 }),
  ]);
});

test('caller cancellation reaches external work through the budget', async () => {
  const controller = new AbortController();
  const started = Promise.withResolvers();

  const operation = withRequestBudget(
    () => runExternalRequest(signal => {
      started.resolve();
      return waitForAbort(signal);
    }),
    { signal: controller.signal },
  );
  const rejected = assert.rejects(
    operation,
    error => error.code === 'external_request_cancelled',
  );

  await started.promise;
  controller.abort();
  await rejected;
});
test('HTTP client disconnect cancels work and removes lifecycle listeners', async t => {
  const started = Promise.withResolvers();
  const settled = Promise.withResolvers();

  const server = http.createServer(async (req, res) => {
    try {
      await withHttpRequestBudget(req, res, () =>
        runExternalRequest(signal => {
          started.resolve();
          return waitForAbort(signal);
        }),
      );
      settled.resolve({ unexpectedSuccess: true });
    } catch (error) {
      settled.resolve({
        code: error.code,
        requestListeners: req.listenerCount('aborted'),
        responseListeners: res.listenerCount('close'),
      });
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });

  const controller = new AbortController();
  const request = fetch(
    `http://127.0.0.1:${server.address().port}/synthetic`,
    { signal: controller.signal },
  );
  const rejected = assert.rejects(request);

  await started.promise;
  controller.abort();

  await rejected;
  const result = await settled.promise;
  assert.equal(result.code, 'external_request_cancelled');
  assert.equal(result.requestListeners, 0);
  assert.equal(result.responseListeners, 0);
});

test('normal response closure does not cancel the request budget', async () => {
  const req = new EventEmitter();
  const res = new EventEmitter();
  req.aborted = false;
  res.destroyed = false;
  res.writableFinished = false;

  const result = await withHttpRequestBudget(req, res, async () => {
    res.writableFinished = true;
    res.emit('close');
    assertRequestActive();
    return 'completed';
  });

  assert.equal(result, 'completed');
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});
test('cancelling one caller does not cancel shared authentication', async () => {
  const started = Promise.withResolvers();
  const complete = Promise.withResolvers();
  const controller = new AbortController();
  let calls = 0;
  let transportSignal;

  const base = {
    async auth() {
      calls++;
      await runExternalRequest(signal => {
        transportSignal = signal;
        started.resolve();
        return complete.promise;
      });
      this.accessToken = 'synthetic-opaque-token';
    },
  };
  const access = createSeaTableAccess(base);

  const first = withRequestBudget(
    () => access(),
    { signal: controller.signal },
  );
  const rejected = assert.rejects(
    first,
    error => error.code === 'external_request_cancelled',
  );

  await started.promise;
  const second = withRequestBudget(() => access());
  controller.abort();

  await rejected;
  assert.equal(transportSignal.aborted, false);

  complete.resolve();
  assert.equal(await second, base);
  assert.equal(calls, 1);
});

test('cancelling one caller does not cancel a shared cache load', async () => {
  const cache = createReadCache();
  const started = Promise.withResolvers();
  const complete = Promise.withResolvers();
  const controller = new AbortController();
  let calls = 0;
  let transportSignal;

  const load = async () => {
    calls++;
    return runExternalRequest(signal => {
      transportSignal = signal;
      started.resolve();
      return complete.promise;
    });
  };

  const first = withRequestBudget(
    () => cache.get('synthetic', load),
    { signal: controller.signal },
  );
  const rejected = assert.rejects(
    first,
    error => error.code === 'external_request_cancelled',
  );

  await started.promise;
  const second = withRequestBudget(
    () => cache.get('synthetic', load),
  );
  controller.abort();

  await rejected;
  assert.equal(transportSignal.aborted, false);

  complete.resolve('shared-result');
  assert.equal(await second, 'shared-result');
  assert.equal(await cache.get('synthetic', load), 'shared-result');
  assert.equal(calls, 1);
});
test('background work uses its own budget after the caller cancels', async () => {
  const controller = new AbortController();
  const started = Promise.withResolvers();
  const complete = Promise.withResolvers();
  let background;

  await withRequestBudget(async () => {
    background = withoutRequestBudget(() =>
      withRequestBudget(async () => {
        started.resolve();
        await complete.promise;
        assertRequestActive();
        return 'background-completed';
      }),
    );

    await started.promise;
    controller.abort();
  }, { signal: controller.signal });

  complete.resolve();
  assert.equal(await background, 'background-completed');
});