import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgentModel } from '../lib/agent/mock-model.js';
import {
  createAgentConversation,
  stageAgentUnderstanding,
  confirmAgentUnderstanding,
  stageAgentConversationResult,
} from '../public/app/shared/agent-conversation.js';

function create(mode) {
  return createAgentConversation({
    id: `synthetic-conversation-${mode}`,
    mode,
    brief: '合成需求，具体时间和地点尚未确定',
  });
}

test('all modes understand requirements and generate after one confirmation', async () => {
  const model = createMockAgentModel();

  for (const mode of ['activity', 'writing', 'design']) {
    const task = create(mode);
    const understanding = await model.generate({ task });

    assert.equal(understanding.provider, 'mock');
    assert.equal(understanding.simulated, true);
    assert.ok(understanding.output.summary.includes('模拟'));

    const understood = stageAgentUnderstanding(
      task,
      understanding.output,
    );
    const ready = confirmAgentUnderstanding(understood);
    const generated = await model.generate({ task: ready });
    const result = stageAgentConversationResult(ready, {
      output: generated.output,
    });

    assert.equal(result.status, 'result_ready');
    assert.ok(result.output.items.length <= 12);
    assert.ok(result.output.draft);
  }
});

test('confirmed fields are preserved and unknown facts remain blank', async () => {
  const model = createMockAgentModel();
  const task = create('activity');
  const understanding = await model.generate({ task });
  const understood = stageAgentUnderstanding(task, understanding.output);
  const ready = confirmAgentUnderstanding(understood, {
    draft: {
      name: '合成急救课堂',
      capacity: 20,
    },
  });

  const generated = await model.generate({ task: ready });

  assert.equal(generated.output.draft.name, '合成急救课堂');
  assert.equal(generated.output.draft.capacity, 20);
  assert.equal(generated.output.draft.date, '');
  assert.equal(generated.output.draft.location, '');
});

test('mock revisions record instructions without pretending to infer new facts', async () => {
  const model = createMockAgentModel();
  const task = create('writing');
  const understanding = await model.generate({ task });
  const ready = confirmAgentUnderstanding(
    stageAgentUnderstanding(task, understanding.output),
    { draft: { title: '合成标题', body: '合成正文' } },
  );

  const first = await model.generate({ task: ready });
  const result = stageAgentConversationResult(ready, {
    output: first.output,
  });
  const before = structuredClone(result);

  const revised = await model.generate({
    task: result,
    instruction: '语气更活泼一些',
  });

  assert.ok(revised.output.summary.includes('语气更活泼一些'));
  assert.deepEqual(revised.output.draft, result.output.draft);
  assert.deepEqual(result, before);
  await assert.rejects(model.generate({ task: result }));
});