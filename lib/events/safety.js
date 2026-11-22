/** Single-instance event mutations share one queue, including aliases and sessions. */
import { assertRequestActive } from '../http/request-budget.js';
import { observer } from '../observability.js';

/**
 * Single-instance mutation queues.
 *
 * The default queue keeps the historical global serial contract. A keyed queue
 * lets callers isolate independent activity/project mutations while preserving
 * strict ordering within one key; the special `*` key still acts as a global
 * barrier for cross-activity operations.
 */
export function createMutationQueue({ keyOf = null } = {}) {
  let tail = Promise.resolve();
  const tails = new Map();
  const globalKey = '*';
  const globalTail = () => tail;
  const queueTail = key => {
    if (!keyOf || key === globalKey) return tail;
    if (!tails.has(key)) tails.set(key, Promise.resolve());
    return tails.get(key);
  };
  const setQueueTail = (key, value) => {
    if (!keyOf || key === globalKey) tail = value;
    else tails.set(key, value);
  };
  const deleteQueueTail = key => {
    if (keyOf && key !== globalKey) tails.delete(key);
  };
  return async (task, scope) => {
    const key = keyOf ? String(keyOf(scope) ?? globalKey) : globalKey;
    // A global barrier snapshots only partition chains that existed on entry;
    // later partitions wait behind the global tail. Snapshotting again after
    // publishing the barrier would make it wait on itself.
    const activePartitions = key === globalKey ? [...tails.values()] : [];
    const partitionTail = queueTail(key);
    const previous = key === globalKey
      ? Promise.all([globalTail(), ...activePartitions])
      : Promise.all([globalTail(), partitionTail]);
    let release;
    const current = new Promise(resolve => { release = resolve; });
    setQueueTail(key, current);
    await observer.dependency('queue','wait',() => previous);
    try {
      assertRequestActive();
      return await task();
    } finally {
      release();
      if (queueTail(key) === current) {
        if (!keyOf || key === globalKey) tail = Promise.resolve();
        else deleteQueueTail(key);
      }
    }
  };
}

export function assertCompleteRows(...datasets) {
  if (datasets.some(rows => !Array.isArray(rows) || rows.readMeta?.truncated)) {
    const error = new Error('数据读取不完整，已停止操作，请联系管理员核对后重试。');
    error.statusCode = 503;
    error.code = 'incomplete_operational_data';
    throw error;
  }
}

/** Observe a real stage without changing its result or cancellation semantics. */
export async function observeQueueStage(operation, task) {
  return observer.dependency('queue', operation, task);
}
