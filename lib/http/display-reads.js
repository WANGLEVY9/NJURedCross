/**
 * 展示读缓存：让页面渲染路径共享同一次 NJUTable 读取，鉴权与写入始终直连权威源。
 *
 * 只有被 `withDisplayReads()` 包住的请求才允许命中缓存。校验会话、判定权限、
 * 执行写入的代码都在该上下文之外，读到的永远是 NJUTable 当前值 —— 缓存因此
 * 不可能让一次写操作对随后的鉴权判断不可见。
 *
 * 缓存按 client → ttlMs → key 三级索引：同一个 Base 上不同用途的读取（概览
 * 10s、列表 5s）各自独立过期。投影按表打标签；写请求结束后由
 * `invalidateDisplayReads(tables)` 只丢弃依赖被写表的投影，未受影响的投影
 * 继续可用，批量写入期间不再整片重建。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createReadCache } from './read-cache.js';

const context = new AsyncLocalStorage();
let index = { byClient: new WeakMap(), all: new Set() };

export function withDisplayReads(task) { return context.run(true, task); }
export function isDisplayRead() { return context.getStore() === true; }

export function isDisplayRequest(method, pathname) {
  return method === 'GET' && (
    /^\/api\/volunteer\/workflow\/(?:catalog|directory|workspace)$/.test(pathname)
    || /^\/api\/volunteer\/workflow\/events\/[^/]+\/(?:detail|members|positions|owners|mail-status|export-preview|hours-review)$/.test(pathname)
    || /^\/api\/volunteer\/workflow\/registrations\/[^/]+\/attendance-detail$/.test(pathname)
    || /^\/api\/(?:materials|events|volunteer|outreach|notifications|community)\/overview$/.test(pathname)
    || ['/api/public/overview', '/api/public/events', '/api/public/workflow/events', '/api/volunteer/workflow', '/api/volunteer/workflow/sources', '/api/community/interests', '/api/community/submissions', '/api/community/matching-preview', '/api/outreach/public-submissions', '/api/portal/workflow/me'].includes(pathname)
  );
}

/** 丢弃全部展示读缓存；下一次展示读重新取数。 */
export function clearDisplayReads() {
  index = { byClient: new WeakMap(), all: new Set() };
}

/**
 * 写操作之后按表失效。没有提供表名时退化为整体失效，
 * 保持旧调用方“写入即清空”的语义。
 */
export function invalidateDisplayReads(tables = []) {
  const names = Array.isArray(tables) ? tables.filter(name => typeof name === 'string' && name) : [];
  if (!names.length) return clearDisplayReads();
  for (const cache of index.all) cache.invalidate(names);
  return undefined;
}

export function displayReadCacheStats() {
  const totals = { hits: 0, staleHits: 0, misses: 0, loads: 0, invalidations: 0, evictions: 0, entries: 0 };
  for (const cache of index.all) {
    const stats = cache.stats();
    for (const key of Object.keys(totals)) totals[key] += stats[key] || 0;
  }
  return totals;
}

function bucketsFor(client) {
  let buckets = index.byClient.get(client);
  if (!buckets) { buckets = new Map(); index.byClient.set(client, buckets); }
  return buckets;
}

export function displayRead(client, key, load, ttlMs = 5_000, tables = []) {
  // 上下文之外直接取数：宁可多读一次，也不让缓存介入鉴权或写入路径。
  if (!context.getStore()) return load();
  const buckets = bucketsFor(client);
  let cache = buckets.get(ttlMs);
  if (!cache) {
    cache = createReadCache({ ttlMs });
    buckets.set(ttlMs, cache);
    index.all.add(cache);
  }
  return cache.get(key, load, { tags: tables });
}
