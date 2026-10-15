import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentConversation,
  stageAgentUnderstanding,
  confirmAgentUnderstanding,
  stageAgentConversationResult,
} from '../public/app/shared/agent-conversation.js';
import {
  buildAgentMessages,
  parseAgentModelOutput,
} from '../lib/agent/model-contract.js';

function create() {
  return createAgentConversation({
    id: 'synthetic-contract',
    mode: 'activity',
    brief: '合成急救课堂，预计20人',
  });
}

function ready() {
  return confirmAgentUnderstanding(
    stageAgentUnderstanding(create(), {
      summary: '筹备合成急救课堂，预计20人。',
      draft: { capacity: 20 },
    }),
  );
}

const output = {
  title: '合成完整方案',
  summary: '活动安排、分工与物资建议。',
  items: ['建议设置签到引导岗位'],
  draft: { capacity: 20 },
};

test('understanding requests use the conversation protocol', () => {
  const messages = buildAgentMessages({ task: create() });
  const context = JSON.parse(messages[1].content);

  assert.equal(messages.length, 2);
  assert.equal(context.phase, 'understanding');
  assert.equal(context.brief, '合成急救课堂，预计20人');
  assert.ok(messages[0].content.includes('最多5项关键缺口'));

  const parsed = parseAgentModelOutput(create(), JSON.stringify({
    summary: '预计20人，时间地点可后续补充。',
    draft: { capacity: 20 },
  }));

  assert.equal(parsed.draft.capacity, 20);
  assert.equal(parsed.draft.date, '');
});

test('confirmed requests return a complete plan without mutating the task', () => {
  const task = ready();
  const before = structuredClone(task);
  const parsed = parseAgentModelOutput(task, JSON.stringify(output));

  assert.equal(parsed.title, output.title);
  assert.equal(parsed.draft.capacity, 20);
  assert.deepEqual(task, before);
  assert.equal(
    JSON.parse(buildAgentMessages({ task })[1].content).phase,
    'result',
  );
});

test('revision requests include current results and the new instruction', () => {
  const task = stageAgentConversationResult(ready(), { output });
  const messages = buildAgentMessages({
    task,
    instruction: '增加AED演示环节',
  });
  const context = JSON.parse(messages[1].content);

  assert.equal(context.instruction, '增加AED演示环节');
  assert.equal(context.currentOutput.title, output.title);
  assert.throws(() => buildAgentMessages({ task }));
});

test('unexpected fields and oversized result lists are rejected', () => {
  assert.throws(() => parseAgentModelOutput(create(), JSON.stringify({
    summary: '合成理解',
    draft: {},
    approved: true,
  })));

  assert.throws(() => parseAgentModelOutput(ready(), JSON.stringify({
    ...output,
    items: Array(13).fill('重复待确认'),
  })));
});

test('malformed drafts and non-JSON content are rejected', () => {
  assert.throws(() => parseAgentModelOutput(create(), '不是JSON'));

  assert.throws(() => parseAgentModelOutput(ready(), JSON.stringify({
    ...output,
    draft: { unknownField: 'invalid' },
  })));
});