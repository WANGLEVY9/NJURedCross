/**
 * 进程内固定窗口限流。
 *
 * 公开写接口没有会话可挂，因此按「桶 + 身份」计数：身份优先取登录账号，
 * 没有账号时才退回客户端地址。计数窗口从第一次请求起算，满窗清零。
 *
 * 设计约束（2026-10-29 事故复盘）：
 *   1. 不同动作必须用不同桶 —— 共用一个桶时，下载 zip、精选申请会把上传额度吃掉；
 *   2. 影像库这类「校园网多人共用出口 IP」的功能必须按账号计数，否则一个人
 *      测试就能把整栋楼的额度打满，全楼一小时不能上传；
 *   3. 429 必须带 retryAfterSeconds，前端才能显示准确等待时间而不是让用户盲试。
 */

/** 超限错误：保留 statusCode 供 apiFailure 判 429，并给出剩余秒数。 */
export function rateLimitError(retryAfterSeconds) {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const error = new Error(`提交过于频繁，请在 ${minutes} 分钟后重试。`);
  error.statusCode = 429;
  error.retryAfterSeconds = seconds;
  return error;
}

/**
 * 建一个限流器。
 * @param {object} options
 * @param {number} [options.windowMs] 窗口长度，默认 1 小时
 * @param {() => number} [options.now] 可注入的时钟，便于测试
 * @param {(req: any) => string} [options.clientIp] 客户端地址解析
 * @param {Map} [options.store] 计数存储，默认新建
 */
export function createRateLimiter({ windowMs = 60 * 60 * 1000, now = () => Date.now(), clientIp = (req) => req?.socket?.remoteAddress || 'unknown', store = new Map() } = {}) {
  const entries = store;

  return function enforce(req, bucket, limit, identity = '') {
    const key = `${bucket}:${identity || clientIp(req)}`;
    const at = now();
    for (const [existingKey, existing] of entries) {
      if (existing.resetAt <= at) entries.delete(existingKey);
    }
    const entry = entries.get(key);
    if (!entry || entry.resetAt <= at) {
      entries.set(key, { count: 1, resetAt: at + windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > limit) throw rateLimitError((entry.resetAt - at) / 1000);
  };
}
