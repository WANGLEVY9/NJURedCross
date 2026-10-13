import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBatchResult } from '../public/app/console/batch-result.js';

const selected = [
  { id: 'a', name: '合成甲' },
  { id: 'b', name: '合成乙' },
];

test('mixed results preserve submitted order and count each outcome', () => {
  const result = summarizeBatchResult(selected, {
    results: [
      { id: 'b', ok: false, message: '名额不足' },
      { id: 'a', ok: true },
    ],
  });

  assert.deepEqual(result.items.map(item => item.id), ['a', 'b']);
  assert.deepEqual(result.items.map(item => item.status), ['succeeded', 'failed']);
  assert.equal(result.items[1].message, '名额不足');
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.unknown, 0);
});

test('missing results require reconciliation instead of reporting failure', () => {
  const result = summarizeBatchResult(selected, {
    results: [{ id: 'a', ok: true }],
  });

  assert.equal(result.items[0].status, 'succeeded');
  assert.equal(result.items[1].status, 'unknown');
  assert.equal(result.unknown, 1);
});

test('invalid, duplicate or foreign results cannot authorize success', () => {
  for (const response of [
    null,
    {},
    { results: 'invalid' },
    { results: [{ id: 'a', ok: true }, { id: 'a', ok: true }] },
    { results: [{ id: 'foreign', ok: true }] },
    { results: [{ id: 'a', ok: 'true' }] },
  ]) {
    const result = summarizeBatchResult(selected, response);
    assert.equal(result.succeeded, 0);
    assert.equal(result.failed, 0);
    assert.equal(result.unknown, 2);
  }
});

test('unsuccessful results without a message receive a usable explanation', () => {
  const result = summarizeBatchResult(
    [{ id: 'a', name: '合成甲' }],
    { results: [{ id: 'a', ok: false }] },
  );

  assert.equal(result.failed, 1);
  assert.ok(result.items[0].message.length > 0);
});

test('invalid or duplicate selections are rejected', () => {
  for (const rows of [
    null,
    [{ id: '' }],
    [{ id: '   ' }],
    [{ id: 1 }],
    [{ id: 'a' }, { id: 'a' }],
  ]) {
    assert.throws(() => summarizeBatchResult(rows, null), TypeError);
  }
});

test('an empty selection produces an empty summary', () => {
  assert.deepEqual(summarizeBatchResult([], { results: [] }), {
    items: [],
    succeeded: 0,
    failed: 0,
    unknown: 0,
  });
});