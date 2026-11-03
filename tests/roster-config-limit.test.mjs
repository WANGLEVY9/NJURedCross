import test from 'node:test';
import assert from 'node:assert/strict';
import { assertConfigSize, trimDeliveries, CONFIG_LIMIT_CHARS } from '../lib/events/roster-review.js';

// 生产事故：名单审核结果全量写进报名页配置，撞上 NJUTable 10000 字符上限被静默截断，
// 整行配置从此不可解析，报名通知整批停发。写入前必须先过尺寸校验。
test('config over the storage limit is rejected instead of being silently truncated', () => {
  const published = {};
  for (let index = 0; index < 80; index += 1) {
    published[`WR-${index}`] = { status: '已确认', reason: '合成说明'.repeat(20), version: 'x'.repeat(36) };
  }
  assert.throws(
    () => assertConfigSize({ rosterReview: { phase: 'final', published } }),
    /超过存储上限/,
  );
});

test('config within the limit is serialized compactly', () => {
  const encoded = assertConfigSize({ rosterReview: { phase: 'draft', published: { 'WR-1': { status: '已确认', reason: '' } } } });
  assert.ok(encoded.length < CONFIG_LIMIT_CHARS);
  assert.deepEqual(JSON.parse(encoded).rosterReview.published['WR-1'].status, '已确认');
});

test('超限时优先丢弃最旧的已发送回执，待核对状态一律保留', () => {
  const deliveries = {};
  for (let index = 0; index < 200; index += 1) {
    deliveries[`KEY-${index}`] = { status: 'sent', sentAt: `2026-10-${String(1 + (index % 28)).padStart(2, '0')}T00:00:00.000Z` };
  }
  deliveries['KEY-pending'] = { status: 'sending' };
  deliveries['KEY-unknown'] = { status: 'unknown' };
  const review = { phase: 'final', published: {}, deliveries };
  const base = {};
  const trimmed = trimDeliveries(base, review);
  assert.ok(trimmed, '应当能裁剪到上限以内');
  const encoded = JSON.stringify({ ...base, rosterReview: trimmed });
  assert.ok(encoded.length <= CONFIG_LIMIT_CHARS);
  assert.equal(trimmed.deliveries['KEY-pending'].status, 'sending');
  assert.equal(trimmed.deliveries['KEY-unknown'].status, 'unknown');
  assert.ok(Object.values(trimmed.deliveries).filter(item => item.status === 'sent').length < 200);
});
