import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeActivityChange, reviewActivityChange, activityChangeDigest } from '../lib/events/activity-change.js';
const event = () => ({ _id: 'row-1', 活动ID: 'event-1', 状态: '报名中', 活动名称: '合成活动', 地点: '原地点', 申请版本: 1 });
const proposal = row => proposeActivityChange(row, { 地点: '新地点' }, { actor: 'owner', requestId: 'change-1' });
const reviewer = { actor: 'reviewer', canReview: true, decision: 'approve' };
test('proposing a change leaves the formal event unchanged', () => {
 const row = event(), before = structuredClone(row), change = proposal(row);
 assert.deepEqual(row, before);
 assert.equal(change.status, 'pending');
 assert.deepEqual(change.changes, [{ field: '地点', before: '原地点', after: '新地点' }]);
});
test('identical values cannot create an empty request', () => {
 assert.throws(() => proposeActivityChange(event(), { 活动名称: '合成活动' }, { actor: 'owner', requestId: 'id' }), /未发现/);
});
test('identity, approval and association fields cannot be changed', () => {
 for (const field of ['活动ID', '_id', '批准摘要', '报名页配置', '负责人账号ID']) assert.throws(() => proposeActivityChange(event(), { [field]: 'replacement' }, { actor: 'owner', requestId: 'id' }), /不允许/);
});
test('approval requires permission and prohibits unauthorized self-review', () => {
 const row = event(), change = proposal(row);
 assert.throws(() => reviewActivityChange(row, change, { ...reviewer, canReview: false }), /无权/);
 assert.throws(() => reviewActivityChange(row, change, { ...reviewer, actor: 'owner' }), /自己/);
});
test('stale requests cannot overwrite a newer formal version', () => {
 const row = event(), change = proposal(row);
 for (const patch of [{ 地点: '第三地点' }, { 申请版本: 2 }, { 状态: '进行中' }]) assert.throws(() => reviewActivityChange({ ...row, ...patch }, change, reviewer), /已变化/);
});
test('returning a request preserves the event and requires a reason', () => {
 const row = event(), change = proposal(row), before = structuredClone(row);
 assert.throws(() => reviewActivityChange(row, change, { ...reviewer, decision: 'return' }), /退回原因/);
 const result = reviewActivityChange(row, change, { ...reviewer, decision: 'return', reason: '补充地点说明' });
 assert.deepEqual(result.patch, {});
 assert.equal(result.proposal.status, 'returned');
 assert.deepEqual(row, before);
 assert.equal(change.status, 'pending');
});
test('approval returns a patch without modifying event or proposal', () => {
 const row = event(), change = proposal(row), result = reviewActivityChange(row, change, reviewer);
 assert.deepEqual(result.patch, { 地点: '新地点' });
 assert.equal(row.地点, '原地点');
 assert.equal(change.status, 'pending');
 assert.throws(() => reviewActivityChange(row, result.proposal, reviewer), /已处理/);
});
test('mismatched activity cannot receive the change', () => {
 const row = event();assert.throws(() => reviewActivityChange({ ...row, 活动ID: 'other' }, proposal(row), reviewer), /不匹配/);
});
test('snapshot digest does not depend on object key insertion order', () => {
 assert.equal(activityChangeDigest({ a: 1, b: { x: 2, y: 3 } }), activityChangeDigest({ b: { y: 3, x: 2 }, a: 1 }));
});