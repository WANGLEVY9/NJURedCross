import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredAgentModel } from '../lib/agent/model-factory.js';
import { createAgentTask } from '../public/app/shared/agent-workflow.js';

function task() {
  return createAgentTask({
    id: 'synthetic-task',
    mode: 'activity',
    brief: '合成需求',
  });
}

function successResponse() {
  return Response.json({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          title: '合成结果',
          summary: '合成说明',
          items: ['合成建议'],
        }),
      },
    }],
  });
}

test('missing configuration defaults to mock without network requests', async () => {
  let requests = 0;
  const model = createConfiguredAgentModel({
    env: {},
    fetchImpl: async () => {
      requests++;
      return successResponse();
    },
  });

  const result = await model.generate({ task: task() });
  assert.equal(model.provider, 'mock');
  assert.equal(result.simulated, true);
  assert.equal(requests, 0);
});

test('mock ignores a configured key and still makes no network request', async () => {
  let requests = 0;

  const model = createConfiguredAgentModel({
    env: {
      AGENT_MODEL_PROVIDER: 'mock',
      DEEPSEEK_API_KEY: 'synthetic-key',
    },
    fetchImpl: async () => {
      requests++;
      return successResponse();
    },
  });

  await model.generate({ task: task() });
  assert.equal(requests, 0);
});

test('DeepSeek requires a key instead of silently falling back to mock', () => {
  let requests = 0;

  assert.throws(() => createConfiguredAgentModel({
    env: { AGENT_MODEL_PROVIDER: 'deepseek' },
    fetchImpl: async () => {
      requests++;
      return successResponse();
    },
  }), /API Key/);

  assert.equal(requests, 0);
});

test('DeepSeek configuration controls the model and output budget', async () => {
  let body;

  const model = createConfiguredAgentModel({
    env: {
      AGENT_MODEL_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'synthetic-key',
      DEEPSEEK_MODEL: 'deepseek-v4-pro',
      AGENT_MODEL_TIMEOUT_MS: '1000',
      AGENT_MODEL_MAX_TOKENS: '4000',
    },
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return successResponse();
    },
  });

  const result = await model.generate({ task: task() });

  assert.equal(model.provider, 'deepseek');
  assert.equal(result.simulated, false);
  assert.equal(body.model, 'deepseek-v4-pro');
  assert.equal(body.max_tokens, 4000);
  assert.deepEqual(body.thinking, { type: 'disabled' });
});

test('invalid providers and numeric configuration are rejected', () => {
  assert.throws(() => createConfiguredAgentModel({
    env: { AGENT_MODEL_PROVIDER: 'unknown' },
  }));

  for (const settings of [
    { AGENT_MODEL_TIMEOUT_MS: 'not-a-number' },
    { AGENT_MODEL_TIMEOUT_MS: '-1' },
    { AGENT_MODEL_MAX_TOKENS: '0' },
  ]) {
    assert.throws(() => createConfiguredAgentModel({
      env: {
        AGENT_MODEL_PROVIDER: 'deepseek',
        DEEPSEEK_API_KEY: 'synthetic-key',
        ...settings,
      },
    }));
  }
});

test('DeepSeek failures remain failures and do not generate mock output', async () => {
  const model = createConfiguredAgentModel({
    env: {
      AGENT_MODEL_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'synthetic-key',
    },
    fetchImpl: async () => {
      throw new Error('synthetic connection failure');
    },
  });

  await assert.rejects(
    () => model.generate({ task: task() }),
    error => error.code === 'agent_model_network',
  );

  assert.equal(model.provider, 'deepseek');
});