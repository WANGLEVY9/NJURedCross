import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeRosterDraftResult,
} from '../public/app/console/batch-result.js';

const selected = [
  { id: 'a', name: '合成甲' },
  { id: 'b', name: '合成乙' },
];

test('completed IDs represent saved drafts, not published results', () => {
  const result = summarizeRosterDraftResult(selected, {
    ok: true,
    result: { completed: ['a', 'b'] },
  });

  assert.equal(result.succeeded, 2);
  assert.equal(result.unknown, 0);
  assert.ok(result.items.every(
    item => item.message.includes('尚未最终公布或发送通知'),
  ));
});

test('unreported records remain unknown', () => {
  const result = summarizeRosterDraftResult(selected, {
    ok: true,
    result: { completed: ['a'] },
  });

  assert.equal(result.succeeded, 1);
  assert.equal(result.unknown, 1);
  assert.equal(result.failed, 0);
});

test('invalid acknowledgements cannot report draft success', () => {
  for (const response of [
    null,
    { ok: true },
    { ok: false, result: { completed: ['a'] } },
    { ok: true, result: { completed: ['a', 'a'] } },
    { ok: true, result: { completed: ['foreign'] } },
  ]) {
    const result = summarizeRosterDraftResult(selected, response);
    assert.equal(result.succeeded, 0);
    assert.equal(result.unknown, 2);
  }
});