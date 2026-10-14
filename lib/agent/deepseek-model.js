import { createCompatibleAgentModel } from './compatible-model.js';

export function createDeepSeekAgentModel({
  apiKey,
  modelName = 'deepseek-flash',
  fetchImpl = globalThis.fetch,
  timeoutMs = 60000,
  maxTokens = 3000,
}) {
  const compatible = createCompatibleAgentModel({
    baseUrl: 'https://api.deepseek.com',
    apiKey,
    modelName,
    fetchImpl,
    timeoutMs,
    maxTokens,
    thinking: 'disabled',
  });

  return {
    provider: 'deepseek',

    async generate(options) {
      const result = await compatible.generate(options);
      return {
        ...result,
        provider: 'deepseek',
      };
    },
  };
}