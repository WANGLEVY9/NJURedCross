/**
 * 写表记账：在请求作用域内记录 NJUTable 实际被写入的表名。
 *
 * 只做记账，不改变返回值、不吞异常、不重试。写入仍然直连权威源；
 * 记下的表名只用于请求结束后让对应的展示投影失效。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const journal = new AsyncLocalStorage();
const tracked = new WeakSet();

const WRITE_METHODS = new Set([
  'insertRow',
  'appendRow',
  'batchAppendRows',
  'updateRow',
  'batchUpdateRows',
  'deleteRow',
  'batchDeleteRows',
]);

export function createWriteJournal() {
  return new Set();
}

export function withWriteJournal(target, task) {
  return journal.run(target, task);
}

export function writtenTables(target) {
  return target instanceof Set ? [...target] : [];
}

export function trackWrittenTable(table) {
  if (typeof table !== 'string' || !table) return;
  journal.getStore()?.add(table);
}

/**
 * 返回记录了写表的客户端代理。方法仍然绑定到原实例，
 * 因此 SDK 内部的 this 语义不受影响。
 */
export function trackClient(client) {
  if (!client || typeof client !== 'object') return client;
  if (tracked.has(client)) return client;

  const bound = new Map();
  const proxy = new Proxy(client, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;
      if (!WRITE_METHODS.has(property)) {
        if (!bound.has(property)) bound.set(property, value.bind(target));
        return bound.get(property);
      }
      return (...args) => {
        trackWrittenTable(args[0]);
        return value.apply(target, args);
      };
    },
  });

  tracked.add(client);
  tracked.add(proxy);
  return proxy;
}
