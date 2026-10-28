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
    pathname === '/api/public/materials/catalog'
    || pathname === '/api/auth/session'
    || /^\/api\/volunteer\/workflow\/workspace-drafts(?:\/|$)/.test(pathname)
    || /^\/api\/volunteer\/workflow\/(?:catalog|directory|workspace)$/.test(pathname)
    || /^\/api\/volunteer\/workflow\/events\/[^/]+\/(?:detail|members|positions|owners|mail-status|export-preview|hours-review)$/.test(pathname)
    || /^\/api\/volunteer\/workflow\/mail-status$/.test(pathname)
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

/**
 * 旧值兜底窗口（毫秒）：过期或写失效之后，仍可先返回上一份快照并后台重取。
 *
 * 写入本身不在展示上下文内，判定与落库始终直读权威源；这里只是让"等待整表
 * 回源"不再发生在用户点击之后。`0` 表示回到旧行为（过期即冷读）。
 */
export function displayStaleMs(ttlMs, env = process.env) {
  const raw = Number(env?.PLATFORM_DISPLAY_STALE_MS);
  if (Number.isSafeInteger(raw) && raw >= 0) return raw;
  return Math.min(ttlMs, 15_000);
}

export function displayRead(client, key, load, ttlMs = 5_000, tables = [], options = {}) {
  // 上下文之外直接取数：宁可多读一次，也不让缓存介入鉴权或写入路径。
  if (!context.getStore()) return load();
  const staleMs = Number.isSafeInteger(options.staleMs) && options.staleMs >= 0 ? options.staleMs : displayStaleMs(ttlMs);
  const buckets = bucketsFor(client);
  const bucketKey = `${ttlMs}|${staleMs}`;
  let cache = buckets.get(bucketKey);
  if (!cache) {
    cache = createReadCache({ ttlMs, staleMs });
    buckets.set(bucketKey, cache);
    index.all.add(cache);
  }
  return cache.get(key, load, { tags: tables });
}
