import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaggedCache } from '../lib/cache/service.js';

test('tagged cache coalesces concurrent loads and honours the TTL', async () => {
  let time = 0;
  let calls = 0;
  const cache = createTaggedCache({ ttlMs: 10, now: () => time });
  const load = async () => ++calls;

  assert.deepEqual(
    await Promise.all([
      cache.get('a', load, { tags: ['表A'] }),
      cache.get('a', load, { tags: ['表A'] }),
    ]),
    [1, 1],
  );

  time = 9;
  assert.equal(await cache.get('a', load, { tags: ['表A'] }), 1);
  time = 10;
  assert.equal(await cache.get('a', load, { tags: ['表A'] }), 2);
  assert.equal(cache.stats().loads, 2);
});

test('a table write only invalidates projections tagged with that table', async () => {
  const cache = createTaggedCache({ ttlMs: 60_000 });
  await cache.get('events', () => 'events-v1', { tags: ['网站活动流程表'] });
  await cache.get('ledger', () => 'ledger-v1', { tags: ['网站服务时长明细表'] });
  await cache.get('mixed', () => 'mixed-v1', { tags: ['网站活动流程表', '网站服务时长明细表'] });

  cache.invalidate(['网站活动流程表']);

  assert.equal(await cache.get('events', () => 'events-v2', { tags: ['网站活动流程表'] }), 'events-v2');
  assert.equal(await cache.get('ledger', () => 'ledger-v2', { tags: ['网站服务时长明细表'] }), 'ledger-v1');
  assert.equal(await cache.get('mixed', () => 'mixed-v2', { tags: ['网站活动流程表'] }), 'mixed-v2');
});

test('an invalidated in-flight load cannot refill the projection', async () => {
  const cache = createTaggedCache({ ttlMs: 60_000 });
  let finish;
  const inFlight = cache.get('rows', () => new Promise(resolve => { finish = resolve; }), { tags: ['表A'] });
  await Promise.resolve();

  cache.invalidate(['表A']);
  assert.equal(await cache.get('rows', () => 'fresh', { tags: ['表A'] }), 'fresh');

  finish('stale');
  assert.equal(await inFlight, 'stale');
  assert.equal(await cache.get('rows', () => assert.fail('must reuse fresh'), { tags: ['表A'] }), 'fresh');
});

test('a failed load is never cached and stale data keeps its hard age bound', async () => {
  let time = 0;
  const cache = createTaggedCache({ ttlMs: 10, staleMs: 20, now: () => time });

  await assert.rejects(cache.get('rows', () => { throw new Error('offline'); }, { tags: ['表A'] }), /offline/);
  await cache.get('rows', () => ['old'], { tags: ['表A'] });

  time = 11;
  assert.deepEqual(await cache.get('rows', () => { throw new Error('offline'); }, { tags: ['表A'] }), ['old']);

  time = 30;
  await assert.rejects(cache.get('rows', () => { throw new Error('offline'); }, { tags: ['表A'] }), /offline/);
});

test('capacity evicts the oldest projection instead of growing without bound', async () => {
  const cache = createTaggedCache({ ttlMs: 60_000, maxEntries: 2 });
  await cache.get('a', () => 'a', { tags: ['表A'] });
  await cache.get('b', () => 'b', { tags: ['表A'] });
  await cache.get('c', () => 'c', { tags: ['表A'] });

  assert.equal(cache.size(), 2);
  assert.equal(cache.stats().evictions, 1);
  assert.equal(await cache.get('a', () => 'a2', { tags: ['表A'] }), 'a2');
});

test('clear isolates reads that started before the clear', async () => {
  const cache = createTaggedCache({ ttlMs: 60_000 });
  let finish;
  const inFlight = cache.get('rows', () => new Promise(resolve => { finish = resolve; }), { tags: ['表A'] });
  await Promise.resolve();

  cache.clear();
  assert.equal(await cache.get('rows', () => 'new', { tags: ['表A'] }), 'new');
  finish('old');
  await inFlight;
  assert.equal(await cache.get('rows', () => assert.fail('must reuse new'), { tags: ['表A'] }), 'new');
});

test('invalid cache configuration is rejected instead of degrading silently', () => {
  assert.throws(() => createTaggedCache({ ttlMs: 0 }), TypeError);
  assert.throws(() => createTaggedCache({ maxEntries: 0 }), TypeError);
  assert.throws(() => createTaggedCache({ staleMs: -1 }), TypeError);
});
