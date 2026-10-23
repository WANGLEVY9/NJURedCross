/** 兼容层：保留既有 createReadCache 契约，底层使用带标签的缓存引擎。 */
import { createTaggedCache } from '../cache/service.js';

export function createReadCache({
  ttlMs = 10_000,
  staleMs = 0,
  maxEntries = 512,
  now = Date.now,
} = {}) {
  const cache = createTaggedCache({ ttlMs, staleMs, maxEntries, now });

  return {
    get: (key, load, options) => cache.get(key, load, options),
    invalidate: tags => cache.invalidate(tags),
    clear: () => cache.clear(),
    delete: key => cache.delete(key),
    has: key => cache.has(key),
    size: () => cache.size(),
    stats: () => cache.stats(),
  };
}
