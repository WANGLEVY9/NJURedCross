import { AsyncLocalStorage } from 'node:async_hooks';
import { createReadCache } from './read-cache.js';

// Only explicitly marked display requests may reuse reads. Identity checks and
// mutations stay outside this context and always reach the authoritative Base.
const context = new AsyncLocalStorage();
let caches = new WeakMap();
export function withDisplayReads(task) { return context.run(true, task); }
export function clearDisplayReads() { caches = new WeakMap(); }
export function displayRead(client, key, load, ttlMs = 5_000) {
  if (!context.getStore()) return load();
  let buckets = caches.get(client);
  if (!buckets) { buckets = new Map(); caches.set(client, buckets); }
  let cache = buckets.get(ttlMs);
  if (!cache) { cache = createReadCache({ ttlMs }); buckets.set(ttlMs, cache); }
  return cache.get(key, load);
}
