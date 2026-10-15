import test from 'node:test';
import assert from 'node:assert/strict';
import { materialFieldEqual } from '../lib/materials/value-equality.js';

test('SeaTable midnight representation matches a date-only field', () => {
  for (const key of [
    '操作时间',
    '实际借用日期',
    '实际归还日期',
  ]) {
    assert.equal(materialFieldEqual(
      key,
      '2026-10-07T00:00:00+08:00',
      '2026-10-07',
    ), true);
  }
});

test('a different calendar day remains a conflict', () => {
  assert.equal(materialFieldEqual(
    '操作时间',
    '2026-10-08T00:00:00+08:00',
    '2026-10-07',
  ), false);
});

test('unexpected time and timezone are not silently discarded', () => {
  for (const value of [
    '2026-10-07T12:00:00+08:00',
    '2026-10-07T00:00:00-08:00',
    '2026-02-30T00:00:00+08:00',
  ]) {
    assert.equal(
      materialFieldEqual('操作时间', value, '2026-10-07'),
      false,
    );
  }
});

test('ordinary text fields retain strict comparison', () => {
  assert.equal(materialFieldEqual(
    '异常说明',
    '2026-10-07T00:00:00+08:00',
    '2026-10-07',
  ), false);
  assert.equal(materialFieldEqual('数量', '2', 2), false);
});

test('missing and empty date snapshots keep existing semantics', () => {
  assert.equal(materialFieldEqual('实际归还日期', undefined, null), true);
  assert.equal(materialFieldEqual('实际归还日期', null, '2026-10-07'), false);
});