import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTask } from '../public/app/shared/agent-workflow.js';
import {
  createCompatibleAgentModel,
} from '../lib/agent/compatible-model.js';

const output = {
  title: '合成结果',
  summary: '合成说明',
  items: ['合成建议'],
};

function task() {
  return createAgentTask({
    id: 'synthetic-task',
    mode: 'activity',
    brief: '合成需求',
  });
}

function response(content = JSON.stringify(output), finishReason = 'stop') {
  return Response.json({
    choices: [{
      finish_reason: finishReason,
      message: { content },
    }],
  });
}

function model(fetchImpl, extra = {}) {
  return createCompatibleAgentModel({
    baseUrl: 'https://synthetic.invalid/v1',
    apiKey: 'synthetic-key',
    modelName: 'synthetic-model',
    fetchImpl,
    ...extra,
  });
}

test('valid responses use the compatible contract without changing the task', async () => {
  let captured;
  const adapter = model(async (url, options) => {
    captured = { url, options };
    return response();
  });

  const current = task();
  const before = structuredClone(current);
  const result = await adapter.generate({ task: current });

  assert.equal(captured.url, 'https://synthetic.invalid/v1/chat/completions');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.headers.Authorization, 'Bearer synthetic-key');

  const body = JSON.parse(captured.options.body);
  assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.model, 'synthetic-model');

  assert.equal(result.simulated, false);
  assert.deepEqual(result.output, output);
  assert.deepEqual(current, before);
});

test('missing keys and unsafe endpoint formats fail before any request', () => {
  let requests = 0;
  const fakeFetch = async () => {
    requests++;
    return response();
  };

  for (const extra of [
    { apiKey: '' },
    { apiKey: 'key with spaces' },
    { baseUrl: 'http://synthetic.invalid/v1' },
    { baseUrl: 'https://user:password@synthetic.invalid/v1' },
    { baseUrl: 'https://synthetic.invalid/v1?key=private' },
    { modelName: '' },
  ]) {
    assert.throws(() => model(fakeFetch, extra));
  }

  assert.equal(requests, 0);
});

test('authentication, rate limits and upstream failures use safe messages without retries', async () => {
  for (const [status, code] of [
    [401, 'agent_model_auth'],
    [403, 'agent_model_auth'],
    [429, 'agent_model_rate_limit'],
    [500, 'agent_model_upstream'],
  ]) {
    let requests = 0;
    const adapter = model(async () => {
      requests++;
      return new Response('upstream-private-detail synthetic-key', {
        status,
      });
    });

    await assert.rejects(
      () => adapter.generate({ task: task() }),
      error => {
        assert.equal(error.code, code);
        assert.equal(error.message.includes('synthetic-key'), false);
        assert.equal(error.message.includes('upstream-private-detail'), false);
        return true;
      },
    );

    assert.equal(requests, 1);
  }
});

test('invalid JSON and invalid output fields are rejected', async () => {
  for (const content of [
    'not json',
    JSON.stringify({ ...output, publish: true }),
    JSON.stringify({ ...output, items: [123] }),
  ]) {
    await assert.rejects(
      () => model(async () => response(content)).generate({ task: task() }),
      error => error.code === 'agent_model_output_invalid',
    );
  }
});

test('truncated responses cannot authorize a successful result', async () => {
  await assert.rejects(
    () => model(async () => response(
      JSON.stringify(output),
      'length',
    )).generate({ task: task() }),
    error => error.code === 'agent_model_incomplete',
  );
});

test('timeouts abort the request even when the fake transport never resolves', async () => {
  let signal;
  const adapter = model(async (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  }, { timeoutMs: 10 });

  await assert.rejects(
    () => adapter.generate({ task: task() }),
    error => error.code === 'agent_model_timeout',
  );

  assert.equal(signal.aborted, true);
});

test('network failures do not expose transport details', async () => {
  const adapter = model(async () => {
    throw new Error('private endpoint detail synthetic-key');
  });

  await assert.rejects(
    () => adapter.generate({ task: task() }),
    error => {
      assert.equal(error.code, 'agent_model_network');
      assert.equal(error.message.includes('synthetic-key'), false);
      return true;
    },
  );
});

test('oversized response bodies are rejected', async () => {
  const adapter = model(async () =>
    new Response('x'.repeat(1024 * 1024 + 1)),
  );

  await assert.rejects(
    () => adapter.generate({ task: task() }),
    error => error.code === 'agent_model_response_large',
  );
});