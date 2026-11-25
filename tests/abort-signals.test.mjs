import test from 'node:test';
import assert from 'node:assert/strict';
import { combineSignals } from '../public/app/core/abort-signals.js';

test('combineSignals propagates the first abort reason', () => {
  const first = new AbortController();
  const second = new AbortController();
  const combined = combineSignals([first.signal, second.signal]);
  assert.equal(combined.aborted, false);
  const reason = new Error('caller cancelled');
  second.abort(reason);
  assert.equal(combined.aborted, true);
  assert.equal(combined.reason, reason);
});

test('combineSignals works when AbortSignal.any is unavailable', () => {
  const original = AbortSignal.any;
  try {
    delete AbortSignal.any;
    const caller = new AbortController();
    const deadline = new AbortController();
    const combined = combineSignals([caller.signal, deadline.signal]);
    const reason = new DOMException('deadline', 'TimeoutError');
    deadline.abort(reason);
    assert.equal(combined.aborted, true);
    assert.equal(combined.reason, reason);
    const already = new AbortController();
    already.abort('early');
    assert.equal(combineSignals([already.signal, new AbortController().signal]).aborted, true);
  } finally {
    AbortSignal.any = original;
  }
});

test('combineSignals returns a single signal unchanged', () => {
  const controller = new AbortController();
  assert.equal(combineSignals([controller.signal]), controller.signal);
});
