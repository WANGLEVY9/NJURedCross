import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityChangeStore } from '../lib/events/activity-change-store.js';
import { createActivityChangeService } from '../lib/events/activity-change-service.js';

function fixture(t) {
  const store = createActivityChangeStore(':memory:');
  t.after(() => store.close());
  const state = { event: { 活动ID: 'event-1', 状态: '报名中', 地点: '旧地点', 申请版本: 1 }, writes: 0,
    blocked: false, denied: false, failAfterWrite: false, failBeforeWrite: false };
  let tail = Promise.resolve();
  const transaction = fn => { const result = tail.then(fn); tail = result.catch(() => {}); return result; };
  const service = createActivityChangeService({ store, transaction,
    loadEvent: async () => structuredClone(state.event),
    assertCanRead: async (_, actor) => { if (actor === 'outsider') throw new Error('无读取权限'); },
    assertCanSubmit: async (_, actor) => { if (actor !== 'owner') throw new Error('无提交权限'); },
    assertCanReview: async (_, __, actor) => ({ canReview: !state.denied && ['reviewer', 'owner'].includes(actor), allowSelfReview: false }),
    validatePatch: async (_, patch) => { if (state.blocked) throw new Error('已有签到，不能变更时长规则'); return patch; },
    applyChange: async (_, patch, receipt) => {
      if (state.failBeforeWrite) throw new Error('连接中断');
      state.writes++;
      state.event = { ...state.event, ...patch, 申请版本: state.event.申请版本 + 1, receipt };
      if (state.failAfterWrite) throw new Error('响应丢失');
    },
    wasApplied: async (event, proposal) => event.receipt?.requestId === proposal.id && event.receipt?.baseDigest === proposal.baseDigest,
  });
  const submit = (id = 'change-1') => service.submit('event-1', { 地点: '新地点' }, { actor: 'owner', requestId: id });
  const review = (overrides = {}) => service.review('change-1', { actor: 'reviewer', version: 1, decision: 'approve', ...overrides });
  return { store, state, service, submit, review };
}
test('submission persists a proposal without modifying the formal event', async t => {
  const f = fixture(t), before = structuredClone(f.state.event);
  const pending = await f.submit();
  assert.equal(pending.status, 'pending');
  assert.deepEqual(f.state.event, before);
  assert.equal(f.state.writes, 0);
  await assert.rejects(() => f.service.get('change-1', 'outsider'), /读取权限/);
});
test('unauthorized submission never reaches the store', async t => {
  const f = fixture(t);
  await assert.rejects(() => f.service.submit('event-1', { 地点: '新地点' }, { actor: 'outsider', requestId: 'id' }), /提交权限/);
  assert.equal(f.store.active('event-1'), null);
});
test('approval applies once and finalizes after confirming the formal receipt', async t => {
  const f = fixture(t); await f.submit();
  const result = await f.review();
  assert.equal(result.status, 'approved');
  assert.equal(f.state.event.地点, '新地点');
  assert.equal(f.state.writes, 1);
  await assert.rejects(() => f.review(), /已更新/);
  assert.equal(f.state.writes, 1);
});
test('return leaves formal content intact and retains the reason', async t => {
  const f = fixture(t); await f.submit();
  const result = await f.review({ decision: 'return', reason: '补充地点说明' });
  assert.equal(result.status, 'returned');
  assert.equal(result.reason, '补充地点说明');
  assert.equal(f.state.event.地点, '旧地点');
  assert.equal(f.state.writes, 0);
});
test('review rechecks authority and prohibits self-review', async t => {
  const f = fixture(t); await f.submit(); f.state.denied = true;
  await assert.rejects(() => f.review(), /无权/);
  f.state.denied = false;
  await assert.rejects(() => f.review({ actor: 'owner' }), /自己/);
  assert.equal(f.store.get('change-1').status, 'pending');
});
test('formal changes and newly conflicting business records block approval before writing', async t => {
  const f = fixture(t); await f.submit(); f.state.event.申请版本++;
  await assert.rejects(() => f.review(), /已变化/);
  f.state.event.申请版本--; f.state.blocked = true;
  await assert.rejects(() => f.review(), /已有签到/);
  assert.equal(f.state.writes, 0);
  assert.equal(f.store.get('change-1').status, 'pending');
});
test('lost response after a successful write reconciles without applying a second time', async t => {
  const f = fixture(t); await f.submit(); f.state.failAfterWrite = true;
  await assert.rejects(() => f.review(), /响应丢失/);
  assert.equal(f.store.get('change-1').status, 'applying');
  assert.equal(f.state.writes, 1);
  const reconciled = await f.review({ version: 2 });
  assert.equal(reconciled.status, 'approved');
  assert.equal(f.state.writes, 1);
});
test('unknown write result cannot trigger blind automatic retries', async t => {
  const f = fixture(t); await f.submit(); f.state.failBeforeWrite = true;
  await assert.rejects(() => f.review(), /连接中断/);
  await assert.rejects(() => f.review({ version: 2 }), /禁止重复写入/);
  assert.equal(f.store.get('change-1').status, 'applying');
  assert.equal(f.state.writes, 0);
});
test('concurrent reviews cannot both apply a request', async t => {
  const f = fixture(t); await f.submit();
  const results = await Promise.allSettled([f.review(), f.review()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.state.writes, 1);
});
test('an outdated editor snapshot cannot create a new request', async t => {
  const f = fixture(t), context = await f.service.context('event-1', 'owner');
  f.state.event.申请版本++;
  await assert.rejects(() => f.service.submit('event-1', { 地点: '新地点' }, { actor: 'owner', requestId: 'change-1', expectedDigest: context.expectedDigest }), /已更新/);
  assert.equal(f.store.active('event-1'), null);
});
test('server preview validates the authoritative snapshot without storing or applying changes', async t => {
  const f = fixture(t), context = await f.service.context('event-1', 'owner');
  const result = await f.service.preview('event-1', { 地点: '新地点' }, { actor: 'owner', expectedDigest: context.expectedDigest });
  assert.deepEqual(result.changes, [{ field: '地点', before: '旧地点', after: '新地点' }]);
  assert.equal(f.state.writes, 0);
  assert.equal(f.store.active('event-1'), null);
});
