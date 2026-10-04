import { AsyncLocalStorage } from 'node:async_hooks';
import { createReadCache } from './read-cache.js';

// Only explicitly marked display requests may reuse reads. Identity checks and
// mutations stay outside this context and always reach the authoritative Base.
const context = new AsyncLocalStorage();
let caches = new WeakMap();
export function withDisplayReads(task) { return context.run(true, task); }
export function clearDisplayReads() { caches = new WeakMap(); }
export function displayRead(client, key, load) {
  if (!context.getStore()) return load();
  let cache = caches.get(client);
  if (!cache) { cache = createReadCache({ ttlMs: 5_000 }); caches.set(client, cache); }
  return cache.get(key, load);
}
