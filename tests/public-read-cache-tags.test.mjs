import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicReadCache } from '../public/app/core/public-read-cache.js';

test('tag invalidation removes only affected public and management projections', async () => {
  const cache = createPublicReadCache({ ttlMs: 60_000, maxAgeMs: 60_000 });
  await cache.refresh('/api/public/events', async () => ({ events: [1] }));
  await cache.refresh('/api/materials/overview', async () => ({ inventory: [1] }));
  await cache.refresh('/api/outreach/overview', async () => ({ submissions: [1] }));

  cache.invalidate(['events']);
  assert.equal(cache.peek('/api/public/events'), null);
  assert.deepEqual(cache.peek('/api/materials/overview'), { inventory: [1] });
  assert.deepEqual(cache.peek('/api/outreach/overview'), { submissions: [1] });
});

test('empty tags and auth-style writes clear the entire cache', async () => {
  const cache = createPublicReadCache({ ttlMs: 60_000, maxAgeMs: 60_000 });
  await cache.refresh('/api/public/events', async () => ({ ok: true }));
  await cache.refresh('/api/materials/overview', async () => ({ ok: true }));
  cache.invalidate([]);
  assert.equal(cache.peek('/api/public/events'), null);
  assert.equal(cache.peek('/api/materials/overview'), null);
});
