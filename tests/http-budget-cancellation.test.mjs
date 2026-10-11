import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  currentRequestBudget,
  withHttpRequestBudget,
} from '../lib/http/request-budget.js';
import { runExternalRequest } from '../lib/http/external-request.js';

function connection() {
  const req = new EventEmitter();
  const res = new EventEmitter();
  req.aborted = false;
  res.destroyed = false;
  res.writableFinished = false;
  return { req, res };
}

function waitForAbort(signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    });
  });
}

const cancelled = error =>
  error.code === 'external_request_cancelled';

function assertListenersRemoved(req, res) {
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
}

test('caller cancellation reaches the HTTP request budget', async () => {
  const { req, res } = connection();
  const controller = new AbortController();

  const operation = withHttpRequestBudget(req, res, () => {
    const signal = currentRequestBudget().signal;
    controller.abort();
    return waitForAbort(signal);
  }, { signal: controller.signal });

  await assert.rejects(operation, cancelled);
  assertListenersRemoved(req, res);
});

test('an already cancelled caller never starts business work', async () => {
  const { req, res } = connection();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  await assert.rejects(withHttpRequestBudget(req, res, () => {
    calls++;
  }, { signal: controller.signal }), cancelled);

  assert.equal(calls, 0);
  assertListenersRemoved(req, res);
});

test('client request abortion cancels the active operation', async () => {
  const { req, res } = connection();

  await assert.rejects(withHttpRequestBudget(req, res, () => {
    const signal = currentRequestBudget().signal;
    req.emit('aborted');
    return waitForAbort(signal);
  }), cancelled);

  assertListenersRemoved(req, res);
});

test('unfinished response closure cancels the active operation', async () => {
  const { req, res } = connection();

  await assert.rejects(withHttpRequestBudget(req, res, () => {
    const signal = currentRequestBudget().signal;
    res.emit('close');
    return waitForAbort(signal);
  }), cancelled);

  assertListenersRemoved(req, res);
});

test('normal response closure does not cancel the budget', async () => {
  const { req, res } = connection();

  const result = await withHttpRequestBudget(req, res, () => {
    res.writableFinished = true;
    res.emit('close');
    assert.equal(currentRequestBudget().signal.aborted, false);
    return 'completed';
  });

  assert.equal(result, 'completed');
  assertListenersRemoved(req, res);
});

test('client disconnect reaches an active external operation', async () => {
  const { req, res } = connection();
  let externalStarted = false;

  await assert.rejects(withHttpRequestBudget(req, res, () =>
    runExternalRequest(signal => {
      externalStarted = true;
      const pending = waitForAbort(signal);
      res.emit('close');
      return pending;
    }),
  ), cancelled);

  assert.equal(externalStarted, true);
  assertListenersRemoved(req, res);
});

test('business failure removes connection listeners', async () => {
  const { req, res } = connection();
  const failure = new Error('synthetic failure');

  await assert.rejects(withHttpRequestBudget(req, res, () => {
    throw failure;
  }), error => error === failure);

  assertListenersRemoved(req, res);
});

test('completed requests no longer react to connection events', async () => {
  const { req, res } = connection();
  let signal;

  await withHttpRequestBudget(req, res, () => {
    signal = currentRequestBudget().signal;
  });

  req.emit('aborted');
  res.emit('close');

  assert.equal(signal.aborted, false);
  assertListenersRemoved(req, res);
});