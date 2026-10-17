import test from 'node:test';
import assert from 'node:assert/strict';
import {
  withDisplayReads,
  displayRead,
  clearDisplayReads,
  invalidateDisplayReads,
  displayReadCacheStats,
} from '../lib/http/display-reads.js';
import { createReadCache } from '../lib/http/read-cache.js';

test('invalidate falls back to clearing everything when no table is given', async () => {
  clearDisplayReads();
  const base = {};
  let value = 'v1';
  const read = () => withDisplayReads(() => displayRead(base, 'rows', async () => value, 5_000, ['表A']));

  assert.equal(await read(), 'v1');
  value = 'v2';
  invalidateDisplayReads([]);
  assert.equal(await read(), 'v2');
  // 非数组输入同样退化为整体失效，而不是抛错。
  value = 'v3';
  invalidateDisplayReads('not-an-array');
  assert.equal(await read(), 'v3');
});

test('aggregated stats start empty and count every cache bucket', async () => {
  clearDisplayReads();
  assert.deepEqual(displayReadCacheStats(), {
    hits: 0, staleHits: 0, misses: 0, loads: 0, invalidations: 0, evictions: 0, entries: 0,
  });

  const base = {};
  await withDisplayReads(() => displayRead(base, 'rows', async () => 'a', 5_000, ['表A']));
  await withDisplayReads(() => displayRead(base, 'rows', async () => 'ignored', 5_000, ['表A']));
  await withDisplayReads(() => displayRead(base, 'rows', async () => 'b', 10_000, ['表A']));
  const cached = displayReadCacheStats();
  assert.ok(cached.hits >= 1);
  assert.equal(cached.loads, 2);
  assert.equal(cached.entries, 2);

  invalidateDisplayReads(['表A']);
  const invalidated = displayReadCacheStats();
  // 失效按缓存桶计数：5 秒桶与 10 秒桶各记一次，条目被清空。
  assert.equal(invalidated.invalidations, 2);
  assert.equal(invalidated.entries, 0);
});

test('the compatibility read cache exposes delete, has, size, stats and invalidate', async () => {
  const cache = createReadCache({ ttlMs: 60_000 });
  assert.equal(await cache.get('k', () => 'v', { tags: ['表A'] }), 'v');
  assert.equal(cache.has('k'), true);
  assert.equal(cache.size(), 1);
  assert.ok(cache.stats().loads === 1);

  cache.delete('k');
  assert.equal(cache.has('k'), false);
  assert.equal(await cache.get('k', () => 'v2', { tags: ['表A'] }), 'v2');

  cache.invalidate(['表A']);
  assert.equal(await cache.get('k', () => 'v3', { tags: ['表A'] }), 'v3');

  cache.clear();
  assert.equal(cache.size(), 0);
});
