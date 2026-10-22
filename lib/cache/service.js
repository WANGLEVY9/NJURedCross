/**
 * 带标签的进程内读缓存：单飞合并、有界新旧窗口、按标签精确失效、容量上限。
 *
 * 设计边界（与 display-reads 的既有不变量一致）：
 *   · 缓存只保存 NJUTable 行投影，不保存鉴权结论、会话或响应体；
 *   · 失效按标签进行，标签等于表名。写操作之后只有依赖该表的投影失效，
 *     其余投影继续可用，避免批量审批期间反复重建整表读取。
 *   · 任何一次失效都会让在途加载结果被丢弃，不会被旧读取回填。
 */
import {
  awaitWithinRequest,
  withRequestBudget,
  withoutRequestBudget,
} from '../http/request-budget.js';

const TAG_PREFIX = 'table:';

export const cacheTag = table => `${TAG_PREFIX}${table}`;

export function createTaggedCache({
  ttlMs = 10_000,
  staleMs = 0,
  maxEntries = 512,
  now = Date.now,
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new TypeError('Cache TTL must be a positive integer');
  if (!Number.isSafeInteger(staleMs) || staleMs < 0) throw new TypeError('Cache stale window must not be negative');
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new TypeError('Cache capacity must be a positive integer');

  const entries = new Map();
  const pending = new Map();
  const generations = new Map();
  const stats = { hits: 0, staleHits: 0, misses: 0, loads: 0, invalidations: 0, evictions: 0 };
  let epoch = 0;

  const versionOf = tags => `${epoch}|${tags.map(tag => `${tag}:${generations.get(tag) || 0}`).join('|')}`;
  const isFresh = entry => now() < entry.expiresAt;
  const isUsable = entry => now() < entry.expiresAt + staleMs;
  const overlaps = (left, right) => left.some(tag => right.includes(tag));

  function store(key, value, tags, version) {
    if (versionOf(tags) !== version) return value;
    if (entries.has(key)) entries.delete(key);
    entries.set(key, { value, expiresAt: now() + ttlMs, tags });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
      stats.evictions++;
    }
    return value;
  }

  return {
    async get(key, load, { refresh = false, tags = [] } = {}) {
      if (typeof load !== 'function') throw new TypeError('Cache loader must be a function');
      if (!Array.isArray(tags)) throw new TypeError('Cache tags must be an array');
      const labels = [...new Set(tags.map(cacheTag))];
      const hit = entries.get(key);

      if (!refresh && hit && isFresh(hit)) {
        stats.hits++;
        return hit.value;
      }

      const usable = !refresh && hit && isUsable(hit);
      const running = pending.get(key);

      if (running) {
        // 合并同一 key 的并发读取；能用的旧值优先返回，避免排队。
        if (usable) {
          stats.staleHits++;
          return hit.value;
        }
        stats.hits++;
        return awaitWithinRequest(running.promise);
      }

      stats.misses++;
      if (usable) stats.staleHits++;

      const version = versionOf(labels);
      const promise = withoutRequestBudget(() => withRequestBudget(load))
        .then(value => pending.get(key)?.promise === promise ? store(key, value, labels, version) : value)
        .finally(() => {
          if (pending.get(key)?.promise === promise) pending.delete(key);
        });

      pending.set(key, { promise, tags: labels });
      stats.loads++;

      if (usable) {
        // 旧值有硬性年龄上限；刷新失败不延长寿命，冷读失败仍然报错而不是返回空表。
        promise.catch(() => {});
        return hit.value;
      }

      return awaitWithinRequest(promise);
    },

    /** 让依赖这些表的投影失效；标签为空表示清空全部。 */
    invalidate(tags = []) {
      const labels = tags.map(cacheTag);
      if (!labels.length) return this.clear();
      stats.invalidations++;
      for (const tag of labels) generations.set(tag, (generations.get(tag) || 0) + 1);
      // 写入之后直接丢弃：下一次读取必须看到写入结果，不拿旧值兜底。
      for (const [key, entry] of entries) {
        if (overlaps(entry.tags, labels)) entries.delete(key);
      }
      for (const [key, job] of pending) {
        if (overlaps(job.tags, labels)) pending.delete(key);
      }
      return undefined;
    },

    clear() {
      epoch++;
      entries.clear();
      pending.clear();
      return undefined;
    },

    delete(key) {
      entries.delete(key);
      pending.delete(key);
    },

    has(key) {
      return entries.has(key);
    },

    size() {
      return entries.size;
    },

    stats() {
      return { ...stats, entries: entries.size, pending: pending.size };
    },
  };
}
