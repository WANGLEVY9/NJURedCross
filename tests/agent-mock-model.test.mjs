import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgentModel } from '../lib/agent/mock-model.js';
import {
  AGENT_FLOWS,
  createAgentTask,
  getActiveAgentStep,
  stageAgentResult,
  confirmAgentStep,
} from '../public/app/shared/agent-workflow.js';

function task(mode = 'activity') {
  return createAgentTask({
    id: 'synthetic-agent-task',
    mode,
    brief: '合成需求：筹备一场校园急救知识宣传活动',
    now: '2026-10-14T00:00:00Z',
  });
}

test('mock results identify themselves and remain unconfirmed', async () => {
  const model = createMockAgentModel();
  const original = task();
  const result = await model.generate({ task: original });

  assert.equal(model.provider, 'mock');
  assert.equal(result.provider, 'mock');
  assert.equal(result.simulated, true);
  assert.match(result.output.summary, /模拟方案/);
  assert.match(result.output.summary, /校园急救知识宣传/);
  assert.equal(original.status, 'awaiting_input');
  assert.equal(original.steps[0].output, null);
});

test('every mock step produces a result accepted by its workflow', async () => {
  const model = createMockAgentModel();

  for (const mode of Object.keys(AGENT_FLOWS)) {
    let current = task(mode);
    while (getActiveAgentStep(current)) {
      const stepId = getActiveAgentStep(current).id;
      const result = await model.generate({ task: current });

      assert.equal(result.simulated, true);
      current = stageAgentResult(current, {
        stepId,
        output: result.output,
      });
      assert.equal(current.status, 'awaiting_confirmation');
      current = confirmAgentStep(current, stepId);
    }

    assert.equal(current.status, 'draft_ready');
  }
});

test('revision instructions are recorded without claiming intelligent execution', async () => {
  const result = await createMockAgentModel().generate({
    task: task('writing'),
    instruction: '增加活动报名方式，语气更简洁',
  });

  assert.equal(
    result.output.items.at(-1),
    '本轮补充要求：增加活动报名方式，语气更简洁',
  );
  assert.equal(result.simulated, true);
  assert.equal(Object.hasOwn(result, 'published'), false);
  assert.equal(Object.hasOwn(result, 'eventId'), false);
});

test('returned results do not share mutable template arrays', async () => {
  const model = createMockAgentModel();
  const first = await model.generate({ task: task('design') });
  const expected = [...first.output.items];
  first.output.items.push('不应影响下一次结果');

  const second = await model.generate({ task: task('design') });
  assert.deepEqual(second.output.items, expected);
});

test('invalid instructions and completed tasks are rejected', async () => {
  const model = createMockAgentModel();

  for (const instruction of [123, null, 'a'.repeat(2001)]) {
    await assert.rejects(model.generate({
      task: task(),
      instruction,
    }));
  }

  let completed = task('writing');
  while (getActiveAgentStep(completed)) {
    const stepId = getActiveAgentStep(completed).id;
    const result = await model.generate({ task: completed });
    completed = stageAgentResult(completed, {
      stepId,
      output: result.output,
    });
    completed = confirmAgentStep(completed, stepId);
  }

  await assert.rejects(model.generate({ task: completed }), /没有待生成/);
});