import { createMockAgentModel } from './mock-model.js';
import { createDeepSeekAgentModel } from './deepseek-model.js';

export function createConfiguredAgentModel({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const provider = String(env.AGENT_MODEL_PROVIDER || 'mock')
    .trim()
    .toLowerCase();

  if (provider === 'mock') {
    return createMockAgentModel();
  }

  if (provider !== 'deepseek') {
    throw new Error('AGENT_MODEL_PROVIDER 仅支持 mock 或 deepseek');
  }

  return createDeepSeekAgentModel({
    apiKey: env.DEEPSEEK_API_KEY || '',
    modelName: env.DEEPSEEK_MODEL || 'deepseek-flash',
    timeoutMs: Number(env.AGENT_MODEL_TIMEOUT_MS || 60000),
    maxTokens: Number(env.AGENT_MODEL_MAX_TOKENS || 3000),
    fetchImpl,
  });
}