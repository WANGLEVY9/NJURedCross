import test from 'node:test';
import assert from 'node:assert/strict';
import { assertConfigSize, CONFIG_LIMIT_BYTES } from '../lib/events/roster-review.js';

// 生产事故：名单审核结果全量写进报名页配置，撞上 NJUTable 10000 字符上限被静默截断，
// 整行配置从此不可解析，报名通知整批停发。写入前必须先过尺寸校验。
test('config over the storage limit is rejected instead of being silently truncated', () => {
  const published = {};
  for (let index = 0; index < 60; index += 1) {
    published[`WR-${index}`] = { status: '已确认', reason: '合成说明'.repeat(20), version: 'x'.repeat(36) };
  }
  assert.throws(
    () => assertConfigSize({ rosterReview: { phase: 'final', published } }),
    /超过存储上限/,
  );
});

test('config within the limit is serialized compactly', () => {
  const encoded = assertConfigSize({ rosterReview: { phase: 'draft', published: { 'WR-1': { status: '已确认', reason: '' } } } });
  assert.ok(Buffer.byteLength(encoded, 'utf8') < CONFIG_LIMIT_BYTES);
  assert.deepEqual(JSON.parse(encoded).rosterReview.published['WR-1'].status, '已确认');
});
