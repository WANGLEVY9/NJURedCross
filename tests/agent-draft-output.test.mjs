import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentTask,
  stageAgentResult,
  confirmAgentStep,
} from '../public/app/shared/agent-workflow.js';
import {
  AGENT_DRAFT_STEPS,
  normalizeAgentDraftCandidate,
} from '../public/app/shared/agent-draft-candidate.js';
import {
  buildAgentMessages,
  parseAgentModelOutput,
} from '../lib/agent/model-contract.js';

const output = {
  title: '合成建议',
  summary: '合成说明',
  items: ['合成核对事项'],
};

function atDraftStep(mode) {
  let task = createAgentTask({
    id: `synthetic-${mode}`,
    mode,
    brief: '合成需求',
  });

  while (task.steps.find(step => step.status !== 'confirmed').id
    !== AGENT_DRAFT_STEPS[mode]) {
    const active = task.steps.find(step => step.status !== 'confirmed');
    task = stageAgentResult(task, { stepId: active.id, output });
    task = confirmAgentStep(task, active.id);
  }

  return task;
}

test('all three draft steps accept and preserve normalized candidates', () => {
  for (const [mode, draft] of [
    ['activity', { name: '合成活动建议' }],
    ['writing', { title: '合成推文标题', body: '合成正文' }],
    ['design', {
      title: '合成方案',
      audience: '新生',
      headline: '合成标题',
      body: '合成正文',
      palette: 'green',
    }],
  ]) {
    const task = atDraftStep(mode);
    const result = parseAgentModelOutput(
      task,
      JSON.stringify({ ...output, draft }),
    );

    assert.deepEqual(
      result.draft,
      normalizeAgentDraftCandidate(mode, draft),
    );
  }
});

test('candidate generation does not modify saved drafts or the input task', () => {
  const task = atDraftStep('writing');
  task.writingDraft = {
    title: '已有标题',
    lead: '',
    body: '已有正文',
    closing: '',
    sourceNotes: '',
  };

  const before = structuredClone(task);
  const next = stageAgentResult(task, {
    stepId: 'draft',
    output: {
      ...output,
      draft: { title: '候选标题', body: '候选正文' },
    },
  });

  assert.deepEqual(task, before);
  assert.deepEqual(next.writingDraft, task.writingDraft);
  assert.equal(next.steps.find(step => step.id === 'draft')
    .output.draft.title, '候选标题');
});

test('ordinary steps reject candidates while existing three-field outputs still work', () => {
  const task = createAgentTask({
    id: 'synthetic-brief',
    mode: 'activity',
    brief: '合成需求',
  });

  assert.deepEqual(
    parseAgentModelOutput(task, JSON.stringify(output)),
    output,
  );

  assert.throws(() => parseAgentModelOutput(
    task,
    JSON.stringify({ ...output, draft: { name: '合成活动' } }),
  ));
});

test('extra authority fields are rejected at both output levels', () => {
  const task = atDraftStep('activity');

  assert.throws(() => parseAgentModelOutput(
    task,
    JSON.stringify({ ...output, publish: true }),
  ));

  assert.throws(() => parseAgentModelOutput(
    task,
    JSON.stringify({ ...output, draft: { submit: true } }),
  ));

  assert.throws(() => parseAgentModelOutput(
    task,
    JSON.stringify({ ...output, draft: { capacity: '待确认' } }),
  ));
});

test('prompt requests candidates only at the matching draft steps', () => {
  for (const mode of ['activity', 'writing', 'design']) {
    const task = atDraftStep(mode);
    const system = buildAgentMessages({ task })[0].content;

    assert.ok(system.includes('请同时提供 draft 候选草稿'));
    assert.ok(system.includes('未知文字和数字用空字符串'));
  }

  const ordinary = createAgentTask({
    id: 'synthetic-ordinary',
    mode: 'writing',
    brief: '合成需求',
  });

  assert.equal(
    buildAgentMessages({ task: ordinary })[0].content
      .includes('请同时提供 draft 候选草稿'),
    false,
  );
});

test('confirming a candidate step preserves it without adopting it', () => {
  let task = atDraftStep('writing');
  task = stageAgentResult(task, {
    stepId: 'draft',
    output: {
      ...output,
      draft: { title: '候选标题', body: '候选正文' },
    },
  });

  task = confirmAgentStep(task, 'draft');

  assert.equal(task.steps.find(step => step.id === 'draft')
    .output.draft.title, '候选标题');
  assert.equal(Object.hasOwn(task, 'writingDraft'), false);
});