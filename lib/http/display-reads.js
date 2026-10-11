import { AsyncLocalStorage } from 'node:async_hooks';
import { createReadCache } from './read-cache.js';

/**
 * 展示读缓存：让页面渲染路径共享同一次 SeaTable 读取，鉴权与写入始终直连权威源。
 *
 * 只有被 `withDisplayReads()` 包住的请求才允许命中缓存。校验会话、判定权限、
 * 执行写入的代码都在该上下文之外，读到的永远是 SeaTable 当前值 —— 缓存因此
 * 不可能让一次写操作对随后的鉴权判断不可见。
 *
 * 缓存按 client → ttlMs → key 三级索引：同一个 Base 上不同用途的读取（概览
 * 10s、列表 5s）各自独立过期。成功写入后 `server.js` 调用 `clearDisplayReads()`
 * 整体替换 WeakMap，使下一次展示读重新取数。
 */
const context = new AsyncLocalStorage();
let caches = new WeakMap();
export function withDisplayReads(task) { return context.run(true, task); }
/** 成功写入后调用：丢弃全部展示读缓存，下一次读取重新命中服务端。 */
export function clearDisplayReads() { caches = new WeakMap(); }
export function displayRead(client, key, load, ttlMs = 5_000) {
  // 上下文之外直接取数：宁可多读一次，也不让缓存介入鉴权或写入路径。
  if (!context.getStore()) return load();
  let buckets = caches.get(client);
  if (!buckets) { buckets = new Map(); caches.set(client, buckets); }
  let cache = buckets.get(ttlMs);
  if (!cache) { cache = createReadCache({ ttlMs }); buckets.set(ttlMs, cache); }
  return cache.get(key, load);
}
