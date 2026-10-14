function limitError(code, message) {
  return Object.assign(new Error(message), {
    statusCode: 429,
    code,
  });
}

export function createAgentCallLimiter({
  maximumCalls = 20,
  windowMs = 60 * 60 * 1000,
  maximumActorConcurrent = 1,
  maximumConcurrent = 4,
  now = Date.now,
} = {}) {
  for (const value of [
    maximumCalls,
    windowMs,
    maximumActorConcurrent,
    maximumConcurrent,
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error('调用限制必须为正整数');
    }
  }

  const accounts = new Map();
  let concurrent = 0;

  function acquire(actor) {
    if (typeof actor !== 'string' || !actor.trim()) {
      throw new Error('调用限制需要有效账号');
    }

    const timestamp = now();
    if (!Number.isFinite(timestamp)) {
      throw new Error('调用限制时间无效');
    }

    // 清理已过期且没有正在调用的账号记录。
    for (const [key, value] of accounts) {
      if (
        value.concurrent === 0 &&
        timestamp >= value.startedAt + windowMs
      ) {
        accounts.delete(key);
      }
    }

    let account = accounts.get(actor);
    if (!account) {
      account = {
        startedAt: timestamp,
        calls: 0,
        concurrent: 0,
      };
      accounts.set(actor, account);
    } else if (timestamp >= account.startedAt + windowMs) {
      account.startedAt = timestamp;
      account.calls = 0;
    }

    if (account.concurrent >= maximumActorConcurrent) {
      throw limitError(
        'agent_account_busy',
        '当前账号已有任务正在生成，请稍后再试',
      );
    }

    if (concurrent >= maximumConcurrent) {
      throw limitError(
        'agent_service_busy',
        '工作助手当前繁忙，请稍后再试',
      );
    }

    if (account.calls >= maximumCalls) {
      throw limitError(
        'agent_call_limit',
        '当前账号已达到本时段调用上限，请稍后再试',
      );
    }

    // 已获准的调用即计入额度，包括后续失败的调用。
    account.calls++;
    account.concurrent++;
    concurrent++;

    let released = false;
    return function release() {
      if (released) return;
      released = true;
      account.concurrent--;
      concurrent--;
    };
  }

  return { acquire };
}