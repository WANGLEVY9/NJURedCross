import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  registerShutdownSignals,
} from '../lib/http/shutdown-signals.js';

test('SIGTERM stops scheduling before HTTP shutdown', async () => {
  const server = new EventEmitter();
  const processTarget = new EventEmitter();
  const calls = [];

  server.on('shutdown', () => calls.push('background'));
  const registration = registerShutdownSignals({
    server,
    processTarget,
    shutdown: {
      stop: async () => {
        calls.push('http');
        return { forced: false };
      },
    },
  });

  try {
    processTarget.emit('SIGTERM');
    assert.deepEqual(await registration.stop(), { forced: false });
    assert.deepEqual(calls, ['background', 'http']);
    assert.equal(processTarget.exitCode, undefined);
  } finally {
    registration.dispose();
  }
});

test('SIGINT and repeated signals share one shutdown operation', async () => {
  const server = new EventEmitter();
  const processTarget = new EventEmitter();
  let calls = 0;

  const registration = registerShutdownSignals({
    server,
    processTarget,
    shutdown: {
      stop: async () => {
        calls++;
        return { forced: false };
      },
    },
  });

  try {
    processTarget.emit('SIGINT');
    processTarget.emit('SIGTERM');
    processTarget.emit('SIGINT');

    const first = registration.stop();
    assert.equal(registration.stop(), first);
    await first;
    assert.equal(calls, 1);
  } finally {
    registration.dispose();
  }
});

test('forced HTTP closure sets a nonzero exit code', async () => {
  const processTarget = new EventEmitter();
  const registration = registerShutdownSignals({
    server: new EventEmitter(),
    processTarget,
    shutdown: {
      stop: async () => ({ forced: true }),
    },
  });

  try {
    assert.deepEqual(await registration.stop(), { forced: true });
    assert.equal(processTarget.exitCode, 1);
  } finally {
    registration.dispose();
  }
});

test('disposing registration removes its signal listeners', () => {
  const processTarget = new EventEmitter();
  const registration = registerShutdownSignals({
    server: new EventEmitter(),
    processTarget,
    shutdown: {
      stop: async () => ({ forced: false }),
    },
  });

  assert.equal(processTarget.listenerCount('SIGTERM'), 1);
  assert.equal(processTarget.listenerCount('SIGINT'), 1);

  registration.dispose();
  registration.dispose();

  assert.equal(processTarget.listenerCount('SIGTERM'), 0);
  assert.equal(processTarget.listenerCount('SIGINT'), 0);
});

test('invalid signal registration arguments are rejected', () => {
  assert.throws(() => registerShutdownSignals(), TypeError);
  assert.throws(() => registerShutdownSignals({
    server: new EventEmitter(),
    processTarget: new EventEmitter(),
    shutdown: {},
  }), TypeError);
});