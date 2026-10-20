import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActivityChangeStore } from '../lib/events/activity-change-store.js';
import { proposeActivityChange } from '../lib/events/activity-change.js';
const proposal = (id = 'change-1', eventId = 'event-1') => proposeActivityChange({ 活动ID: eventId, 状态: '报名中', 地点: '旧地点' }, { 地点: '新地点' }, { actor: 'owner', requestId: id });
function memory(t) { const store = createActivityChangeStore(':memory:'); t.after(() => store.close()); return store; }
test('saved proposals return independent copies and identical retries are idempotent', t => {
 const store = memory(t), input = proposal();
 const saved = store.create(input); input.changes[0].after = '篡改'; saved.proposal.changes[0].after = '另一个值';
 assert.equal(store.get(input.id).proposal.changes[0].after, '新地点');
 assert.equal(store.create(proposal()).version, 1);
 assert.throws(() => store.create(input), /编号/);
});
test('one event has at most one pending or applying request', t => {
 const store = memory(t); store.create(proposal());
 assert.throws(() => store.create(proposal('change-2')), /已有/);
 store.beginReview('change-1', 1, 'reviewer');
 assert.throws(() => store.create(proposal('change-3')), /已有/);
 assert.equal(store.active('event-1').status, 'applying');
});
test('a stale reviewer cannot acquire a request already being processed', t => {
 const store = memory(t); store.create(proposal());
 const lease = store.beginReview('change-1', 1, 'reviewer');
 assert.equal(lease.entry.version, 2);
 assert.throws(() => store.beginReview('change-1', 1, 'other'), /已更新/);
});
test('finalization requires the exact review token and cannot be repeated', t => {
 const store = memory(t); store.create(proposal());
 const lease = store.beginReview('change-1', 1, 'reviewer');
 assert.throws(() => store.finishReview('change-1', 'wrong', 'approved'), /失效/);
 assert.equal(store.get('change-1').status, 'applying');
 assert.equal(store.finishReview('change-1', lease.token, 'approved').status, 'approved');
 assert.throws(() => store.finishReview('change-1', lease.token, 'approved'), /失效/);
 assert.equal(store.active('event-1'), null);
});
test('returning requires a reason and frees the event for a new proposal', t => {
 const store = memory(t); store.create(proposal());
 const lease = store.beginReview('change-1', 1, 'reviewer');
 assert.throws(() => store.finishReview('change-1', lease.token, 'returned'), /原因/);
 const result = store.finishReview('change-1', lease.token, 'returned', '请补充');
 assert.equal(result.reason, '请补充');
 assert.equal(store.create(proposal('change-2')).status, 'pending');
});
test('pending and uncertain applying states survive a process restart', () => {
 const directory = mkdtempSync(join(tmpdir(), 'activity-change-'));
 let store;
 try {
  const file = join(directory, 'changes.sqlite'); store = createActivityChangeStore(file);
  store.create(proposal()); store.create(proposal('change-2', 'event-2'));
  store.beginReview('change-1', 1, 'reviewer'); store.close(); store = createActivityChangeStore(file);
  assert.equal(store.get('change-1').status, 'applying');
  assert.equal(store.get('change-2').status, 'pending');
  assert.throws(() => store.beginReview('change-1', 1, 'other'), /已更新/);
 } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('independent connections cannot both acquire the same pending version', () => {
 const directory = mkdtempSync(join(tmpdir(), 'activity-change-')); let first, second;
 try {
  const file = join(directory, 'changes.sqlite'); first = createActivityChangeStore(file); second = createActivityChangeStore(file);
  first.create(proposal()); first.beginReview('change-1', 1, 'reviewer');
  assert.throws(() => second.beginReview('change-1', 1, 'other'), /已更新/);
 } finally { first?.close(); second?.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('invalid storage paths and malformed proposals are rejected', t => {
 assert.throws(() => createActivityChangeStore('relative.sqlite'), /绝对路径/);
 const store = memory(t);
 assert.throws(() => store.create({ ...proposal(), baseDigest: 'bad' }), /格式/);
 assert.equal(store.active('event-1'), null);
});