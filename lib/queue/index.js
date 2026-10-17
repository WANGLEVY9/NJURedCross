/**
 * 任务队列入口：持久化存储 + 单进程执行器。
 *
 * 用法约定：
 *   · 入队发生在业务写入成功之后，队列只承载副作用（通知、投递、对账）；
 *   · 入队失败不能把已经成功的业务写入报告为失败，调用方自行降级；
 *   · 任务参数只放标识与小字段，正文与凭据留在业务表或邮件存储里。
 */
import { openJobStore } from './store.js';
import { createJobRunner } from './runner.js';

export async function createJobQueue({
  file,
  handlers,
  concurrency = 2,
  pollMs = 1_000,
  leaseMs = 120_000,
  handlerTimeoutMs = 100_000,
  retryBaseMs = 15_000,
  maxAttempts = 5,
  now = Date.now,
  onError = () => {},
} = {}) {
  const store = await openJobStore(file, { maxAttempts, now });
  const runner = createJobRunner({
    store,
    handlers,
    concurrency,
    pollMs,
    leaseMs,
    handlerTimeoutMs,
    retryBaseMs,
    now,
    onError,
  });

  return {
    enqueue(options) {
      const result = store.enqueue(options);
      if (result.created) runner.kick();
      return result;
    },
    start: () => runner.start(),
    stop: options => runner.stop(options),
    stats: () => ({ ...store.stats(), runner: runner.stats() }),
    list: options => store.list(options),
    close: () => store.close(),
    store,
  };
}
