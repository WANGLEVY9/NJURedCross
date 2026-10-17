/**
 * 队列执行器：单进程内的有界并发 worker。
 *
 * 每个任务都在自己的请求预算里运行，不会被触发它的那次 HTTP 请求取消；
 * 失败按指数退避重新排队，达到上限后留在 failed 供人工核对。
 */
import { setTimeout as delay } from 'node:timers/promises';
import {
  withRequestBudget,
  withoutRequestBudget,
} from '../http/request-budget.js';
import { observer } from '../observability.js';

export function createJobRunner({
  store,
  handlers,
  concurrency = 2,
  pollMs = 1_000,
  leaseMs = 120_000,
  handlerTimeoutMs = 100_000,
  retryBaseMs = 15_000,
  now = Date.now,
  onError = () => {},
} = {}) {
  if (!store || typeof store.claim !== 'function') throw new TypeError('Job runner requires a job store');
  if (!handlers || typeof handlers !== 'object') throw new TypeError('Job runner requires handlers');
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new TypeError('Job concurrency must be an integer between 1 and 16');
  }
  if (!Number.isSafeInteger(pollMs) || pollMs < 20) throw new TypeError('Job poll interval is invalid');
  if (!Number.isSafeInteger(retryBaseMs) || retryBaseMs < 1) throw new TypeError('Job retry backoff is invalid');
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= handlerTimeoutMs) {
    throw new TypeError('Job lease must exceed the handler timeout');
  }

  const active = new Set();
  const counters = { claimed: 0, completed: 0, failed: 0, rejected: 0 };
  let timer = null;
  let running = false;
  let stopped = true;

  function backoffMs(attempts) {
    return Math.min(15 * 60_000, retryBaseMs * 2 ** Math.max(0, attempts - 1));
  }

  async function execute(job) {
    const handler = handlers[job.type];

    try {
      if (typeof handler !== 'function') {
        throw Object.assign(new Error('未注册的任务类型'), { code: 'job_type_unknown' });
      }

      await observer.dependency('queue', 'run', () =>
        withoutRequestBudget(() => withRequestBudget(
          () => handler(job.payload, { job }),
          { timeoutMs: handlerTimeoutMs },
        )));

      store.complete(job.id);
      counters.completed++;
    } catch (error) {
      counters.failed++;
      try {
        store.fail(job.id, {
          error: error?.code || error?.name || 'job_failed',
          retryAfterMs: backoffMs(job.attempts),
        });
      } catch {
        // 存储层冲突留给下一轮租约回收处理，不吞掉原始任务错误。
      }
      try {
        onError(error, job);
      } catch {
        // 记录失败不得让 worker 停摆。
      }
    } finally {
      active.delete(job.id);
    }
  }

  async function pump() {
    if (stopped || running) return;
    running = true;

    try {
      const free = concurrency - active.size;
      if (free <= 0) return;

      store.releaseStale(now());
      const jobs = store.claim({ at: now(), limit: free, leaseMs });
      counters.claimed += jobs.length;

      for (const job of jobs) {
        active.add(job.id);
        void execute(job);
      }
    } catch (error) {
      counters.rejected++;
      try {
        onError(error, null);
      } catch {
        // 同上：日志失败不能阻塞队列。
      }
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      timer = setInterval(() => { void pump(); }, pollMs);
      timer.unref();
      void pump();
    },

    /** 入队后主动唤醒，减少一次轮询等待；不改变并发上限。 */
    kick() {
      if (!stopped) void pump();
    },

    async stop({ timeoutMs = 10_000 } = {}) {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;

      const deadline = Date.now() + timeoutMs;
      while (active.size && Date.now() < deadline) {
        await delay(50);
      }

      return { pending: active.size };
    },

    stats() {
      return { ...counters, active: active.size, started: !stopped };
    },
  };
}
