import test from 'node:test';
import assert from 'node:assert/strict';
import { assertConfigSize, trimDeliveries, CONFIG_LIMIT_CHARS } from '../lib/events/roster-review.js';
import { decodeRosterResult, encodeRosterResult, rosterMailKey } from '../public/app/shared/roster-review.js';

// 真实活动的基础配置（名称、时段、地点、负责人、报名窗口等）约 1400-2200 字符。
const baseConfig = (size = 1800) => ({ name: '11.21 艾滋病日特别讲座', padding: 'x'.repeat(size) });

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

test('150 人的名单审核在紧凑格式下不再撞上限', () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({ _id: `WR-${String(index).padStart(3, '0')}`,
    '报名状态': index % 8 === 0 ? '未入选' : '已确认',
    '处理说明': index % 8 === 0 ? '报名人数已满，欢迎下次参加' : '' }));
  const version = '1a2b3c4d5e6f';
  const published = Object.fromEntries(rows.map(row => [row._id,
    encodeRosterResult({ status: row['报名状态'], reason: row['处理说明'], version }, { withReason: false })]));
  assert.ok(assertConfigSize({ ...baseConfig(), rosterReview: { phase: 'final', published, drafts: {}, deliveries: {} } })
    .length <= CONFIG_LIMIT_CHARS);

  // 发布瞬间 target 带理由（写行要用），published 已清空，两份不再叠加。
  const target = Object.fromEntries(rows.map(row => [row._id,
    encodeRosterResult({ status: row['报名状态'], reason: row['处理说明'], version }, { withReason: true })]));
  assert.ok(assertConfigSize({ ...baseConfig(), rosterReview: { phase: 'publishing', published: {}, target } })
    .length <= CONFIG_LIMIT_CHARS);

  // 改造前的对象格式在同样规模下必然超限，这是现场的复现。
  const legacy = Object.fromEntries(rows.map(row => [row._id,
    { status: row['报名状态'], reason: row['处理说明'], version: 'x'.repeat(36) }]));
  assert.throws(() => assertConfigSize({ ...baseConfig(), rosterReview: { phase: 'final', published: legacy } }), /超过存储上限/);
});

test('紧凑格式与旧对象格式解码一致，邮件幂等键不会因为换格式而重发', () => {
  const row = { _id: 'WR-1', '报名ID': 'REG-0001', '报名状态': '已确认', '处理说明': '' };
  const legacy = { status: '已确认', reason: '', version: 'abc123def456' };
  for (const entry of [legacy, encodeRosterResult({ status: '已确认', reason: '', version: 'abc123def456' })]) {
    assert.equal(rosterMailKey(row, entry), 'WF-RESULT:REG-0001:yes:abc123def456');
    assert.deepEqual(decodeRosterResult(entry, row), { status: '已确认', reason: '', version: 'abc123def456' });
  }
  // 未入选的理由：新格式回落到报名行的处理说明，显式写了就用显式的。
  const rejected = { ...row, '报名状态': '未入选', '处理说明': '名额已满' };
  assert.equal(rosterMailKey(rejected, 'Nabc123def456'), 'WF-RESULT:REG-0001:no:abc123def456');
  assert.equal(decodeRosterResult('Nabc123def456', rejected).reason, '名额已满');
  assert.equal(decodeRosterResult('Nabc123def456|材料不全', rejected).reason, '材料不全');
});
