import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTask } from '../public/app/shared/agent-workflow.js';
import { createDeepSeekAgentModel } from '../lib/agent/deepseek-model.js';

const output = {
  title: '合成结果',
  summary: '合成说明',
  items: ['合成建议'],
};

function task() {
  return createAgentTask({
    id: 'synthetic-deepseek-task',
    mode: 'writing',
    brief: '合成宣传需求',
  });
}

test('DeepSeek uses its official endpoint with explicit non-thinking JSON output', async () => {
  let captured;

  const model = createDeepSeekAgentModel({
    apiKey: 'synthetic-key',
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };

      return Response.json({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: JSON.stringify(output),
            reasoning_content: '合成推理内容，不应进入任务结果',
          },
        }],
      });
    },
  });

  const result = await model.generate({ task: task() });

  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(captured.body.model, 'deepseek-flash');
  assert.deepEqual(captured.body.thinking, { type: 'disabled' });
  assert.deepEqual(captured.body.response_format, { type: 'json_object' });
  assert.equal(captured.body.stream, false);

  assert.equal(result.provider, 'deepseek');
  assert.equal(result.simulated, false);
  assert.deepEqual(result.output, output);
  assert.equal(Object.hasOwn(result, 'reasoning_content'), false);
});

test('DeepSeek model names can be configured without changing the task interface', async () => {
  let requestedModel;

  const model = createDeepSeekAgentModel({
    apiKey: 'synthetic-key',
    modelName: 'deepseek-v4-pro',
    fetchImpl: async (_url, options) => {
      requestedModel = JSON.parse(options.body).model;
      return Response.json({
        choices: [{
          finish_reason: 'stop',
          message: { content: JSON.stringify(output) },
        }],
      });
    },
  });

  await model.generate({ task: task() });
  assert.equal(requestedModel, 'deepseek-v4-pro');
});

test('empty DeepSeek JSON responses are rejected without substituting mock results', async () => {
  const model = createDeepSeekAgentModel({
    apiKey: 'synthetic-key',
    fetchImpl: async () => Response.json({
      choices: [{
        finish_reason: 'stop',
        message: { content: '' },
      }],
    }),
  });

  await assert.rejects(
    () => model.generate({ task: task() }),
    error => error.code === 'agent_model_output_invalid',
  );

  assert.throws(() => createDeepSeekAgentModel({
    apiKey: '',
  }));
});