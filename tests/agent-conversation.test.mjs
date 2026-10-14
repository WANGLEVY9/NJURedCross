import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentConversation,
  stageAgentUnderstanding,
  confirmAgentUnderstanding,
  stageAgentConversationResult,
} from '../public/app/shared/agent-conversation.js';

function create() {
  return createAgentConversation({
    id: 'synthetic-conversation',
    mode: 'activity',
    brief: '合成急救课堂，预计20人，时间地点未定',
  });
}

function understand(task = create()) {
  return stageAgentUnderstanding(task, {
    summary: '面向新生开展急救课堂，预计20人，时间地点待补充。',
    draft: {
      name: '合成急救课堂',
      capacity: 20,
    },
  });
}

const output = {
  title: '合成活动完整方案',
  summary: '包含策划、分工与物资建议，未知信息保留为空。',
  items: ['建议安排签到引导岗位'],
  draft: {
    name: '合成急救课堂',
    capacity: 20,
  },
};

test('one confirmation allows a complete result with unknown facts blank', () => {
  const understood = understand();
  const ready = confirmAgentUnderstanding(understood);
  const result = stageAgentConversationResult(ready, { output });

  assert.equal(result.status, 'result_ready');
  assert.equal(result.confirmedDraft.capacity, 20);
  assert.equal(result.confirmedDraft.date, '');
  assert.equal(result.confirmedDraft.location, '');
  assert.equal(result.output.draft.capacity, 20);
});

test('understanding updates reuse one confirmation message', () => {
  const first = understand();
  const second = stageAgentUnderstanding(first, {
    summary: '修正理解：预计30人。',
    draft: { capacity: 30 },
  });

  assert.equal(
    second.messages.filter(item => item.kind === 'understanding').length,
    1,
  );
  assert.equal(second.understanding.draft.capacity, 30);
  assert.equal(first.understanding.draft.capacity, 20);
});

test('confirmation accepts field corrections without requiring complete facts', () => {
  const ready = confirmAgentUnderstanding(understand(), {
    draft: {
      capacity: 30,
      location: '合成教室A',
    },
  });

  assert.equal(ready.confirmedDraft.capacity, 30);
  assert.equal(ready.confirmedDraft.location, '合成教室A');
  assert.equal(ready.confirmedDraft.date, '');
});

test('later revisions update results without another confirmation', () => {
  const ready = confirmAgentUnderstanding(understand());
  const first = stageAgentConversationResult(ready, { output });
  const second = stageAgentConversationResult(first, {
    instruction: '人数改为30人',
    output: {
      ...output,
      draft: { name: '合成急救课堂', capacity: 30 },
    },
  });

  assert.equal(second.status, 'result_ready');
  assert.equal(second.output.draft.capacity, 30);
  assert.equal(second.messages.at(-2).content, '人数改为30人');
  assert.equal(first.output.draft.capacity, 20);
  assert.throws(() => confirmAgentUnderstanding(second));
});

test('invalid transitions and malformed drafts are rejected', () => {
  assert.throws(() => confirmAgentUnderstanding(create()));
  assert.throws(() => stageAgentConversationResult(understand(), { output }));

  const ready = confirmAgentUnderstanding(understand());
  assert.throws(() => stageAgentConversationResult(ready, {
    output: { ...output, draft: { unexpectedField: 'invalid' } },
  }));

  const result = stageAgentConversationResult(ready, { output });
  assert.throws(() => stageAgentConversationResult(result, {
    output,
    instruction: '',
  }));
});