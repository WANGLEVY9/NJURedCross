/**
 * 后台任务与人机请求的协调器。
 *
 * 定时任务（公共快照预热、能力探测、报名通知对账）与页面请求争用同一个
 * NJUTable 上游。上游一次整表读取要 0.2–3 秒，用户正在操作时让后台任务插队，
 * 直接表现为页面卡顿。因此这里给出一个「让路」规则：
 *
 *   · 最近有用户请求时，后台任务本轮跳过；
 *   · 但积压超过 `maxDelayMs` 后强制执行，避免后台任务被持续访问饿死。
 *
 * 只决定「是否运行」，不改变任务本身的语义；被跳过的任务下个周期照常尝试。
 */
export function createIdleGate({
  minIdleMs = 1_500,
  maxDelayMs = 120_000,
  now = Date.now,
} = {}) {
  if (!Number.isSafeInteger(minIdleMs) || minIdleMs < 0) {
    throw new TypeError('Idle window must be a non-negative integer');
  }
  if (!Number.isSafeInteger(maxDelayMs) || maxDelayMs < 1) {
    throw new TypeError('Maximum delay must be a positive integer');
  }

  let lastActivity = 0;
  let lastRun = 0;

  return {
    /** 用户请求到达时调用。 */
    mark() {
      lastActivity = now();
    },
    /** 后台任务是否可以运行；返回 true 时记下本次运行时间。 */
    allow() {
      const at = now();
      const idle = at - lastActivity >= minIdleMs;
      const overdue = at - lastRun >= maxDelayMs;
      if (!idle && !overdue) return false;
      lastRun = at;
      return true;
    },
    stats() {
      return { lastActivity, lastRun };
    },
  };
}
