import { createAgentCallLimiter } from './call-limiter.js';

function positiveInteger(env, name, fallback) {
  const raw = env[name];

  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const text = String(raw).trim();
  const value = Number(text);

  if (
    !/^[1-9]\d*$/.test(text) ||
    !Number.isSafeInteger(value)
  ) {
    throw new Error(`${name} 必须为正整数`);
  }

  return value;
}

export function createConfiguredAgentCallLimiter({
  env = process.env,
  now = Date.now,
} = {}) {
  return createAgentCallLimiter({
    maximumCalls: positiveInteger(
      env, 'AGENT_CALL_MAXIMUM', 20,
    ),
    windowMs: positiveInteger(
      env, 'AGENT_CALL_WINDOW_MS', 3600000,
    ),
    maximumActorConcurrent: positiveInteger(
      env, 'AGENT_ACCOUNT_CONCURRENT', 1,
    ),
    maximumConcurrent: positiveInteger(
      env, 'AGENT_GLOBAL_CONCURRENT', 4,
    ),
    now,
  });
}