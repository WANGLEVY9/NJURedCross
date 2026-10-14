import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentTask,
  stageAgentResult,
  confirmAgentStep,
  getActiveAgentStep,
} from '../public/app/shared/agent-workflow.js';
import {
  validateAgentRevisionFields,
  savedAgentDraft,
  prepareAgentDraftRevision,
  buildAgentDraftRevision,
} from '../public/app/shared/agent-draft-revision.js';
import { createMockAgentModel } from '../lib/agent/mock-model.js';
import {
  buildAgentMessages,
  parseAgentModelOutput,
} from '../lib/agent/model-contract.js';

function writingTask() {
  let task = createAgentTask({
    id: 'synthetic-revision-task',
    mode: 'writing',
    brief: '合成宣传需求',
  });

  while (task.status !== 'draft_ready') {
    const active = getActiveAgentStep(task);
    task = stageAgentResult(task, {
      stepId: active.id,
      output: {
        title: '合成步骤',
        summary: '合成说明',
        items: ['合成核对事项'],
      },
    });
    task = confirmAgentStep(task, active.id);
  }

  task.writingDraft = {
    title: '原标题',
    lead: '原导语',
    body: '原正文',
    closing: '原结尾',
    sourceNotes: '原核对备注',
  };

  return task;
}

test('selection requires supported unique fields', () => {
  assert.deepEqual(
    validateAgentRevisionFields('writing', ['title']),
    ['title'],
  );

  for (const fields of [
    [],
    ['title', 'title'],
    ['publish'],
    ['actor'],
    [123],
  ]) {
    assert.throws(() => validateAgentRevisionFields('writing', fields));
  }

  assert.throws(() =>
    validateAgentRevisionFields('activity', ['serviceHours']),
  );
});

test('only selected fields change even if the model proposes other edits', () => {
  const task = writingTask();
  const before = structuredClone(task);

  const revision = buildAgentDraftRevision(task, {
    fields: ['title'],
    candidate: {
      title: '候选标题',
      body: '模型试图修改的正文',
      closing: '模型试图修改的结尾',
    },
  });

  assert.equal(revision.draft.title, '候选标题');
  assert.equal(revision.draft.body, '原正文');
  assert.equal(revision.draft.closing, '原结尾');
  assert.equal(revision.draft.sourceNotes, '原核对备注');
  assert.deepEqual(revision.changes, [{
    name: 'title',
    before: '原标题',
    after: '候选标题',
  }]);

  assert.equal(revision.complete, true);
  assert.deepEqual(task, before);
});

test('optional fields can be cleared without changing unselected content', () => {
  const revision = buildAgentDraftRevision(writingTask(), {
    fields: ['lead'],
    candidate: { lead: '' },
  });

  assert.equal(revision.draft.lead, '');
  assert.equal(revision.draft.body, '原正文');
  assert.equal(revision.complete, true);
  assert.equal(revision.changes[0].after, '');
});

test('incomplete revisions remain proposals and report required fields', () => {
  const task = writingTask();

  const revision = buildAgentDraftRevision(task, {
    fields: ['title'],
    candidate: { title: '' },
  });

  assert.equal(revision.complete, false);
  assert.ok(revision.issues.title);
  assert.equal(task.writingDraft.title, '原标题');
});

test('request preparation works after completion without changing original progress', () => {
  const task = writingTask();
  const before = structuredClone(task);

  const requestTask = prepareAgentDraftRevision(task, {
    fields: ['title'],
    instruction: '保留其他内容，只让标题更简洁',
  });

  assert.equal(getActiveAgentStep(requestTask).id, 'draft');
  assert.deepEqual(requestTask.draftRevision.fields, ['title']);
  assert.deepEqual(
    requestTask.steps.find(step => step.id === 'draft').output.draft,
    task.writingDraft,
  );

  assert.equal(task.status, 'draft_ready');
  assert.deepEqual(task, before);
});

test('unsaved drafts and invalid instructions cannot prepare a revision', () => {
  const task = writingTask();
  delete task.writingDraft;
  assert.throws(() => savedAgentDraft(task));

  for (const instruction of ['', '字'.repeat(2001), null]) {
    assert.throws(() => prepareAgentDraftRevision(writingTask(), {
      fields: ['title'],
      instruction,
    }));
  }
});

test('identical proposed values produce no changes', () => {
  const revision = buildAgentDraftRevision(writingTask(), {
    fields: ['title'],
    candidate: { title: '原标题' },
  });

  assert.deepEqual(revision.changes, []);
  assert.equal(revision.draft.body, '原正文');
});

test('revision prompts identify selected fields and include the saved draft', () => {
  const requestTask = prepareAgentDraftRevision(writingTask(), {
    fields: ['title'],
    instruction: '只让标题更简洁',
  });

  const messages = buildAgentMessages({
    task: requestTask,
    instruction: requestTask.draftRevision.instruction,
  });

  assert.ok(messages[0].content.includes('仅允许修改这些字段：title'));
  assert.ok(messages[0].content.includes('必须返回 draft'));

  const context = JSON.parse(messages[1].content);
  assert.deepEqual(context.revisionFields, ['title']);
  assert.equal(context.currentOutput.draft.body, '原正文');
  assert.equal(context.instruction, '只让标题更简洁');
});

test('revision responses require an actual candidate draft', () => {
  const requestTask = prepareAgentDraftRevision(writingTask(), {
    fields: ['title'],
    instruction: '修改标题',
  });

  assert.throws(() => parseAgentModelOutput(
    requestTask,
    JSON.stringify({
      title: '修改说明',
      summary: '已提出建议',
      items: ['建议更简洁'],
    }),
  ), /缺少候选草稿/);
});

test('mock revision changes only the selected title and preserves saved content', async () => {
  const original = writingTask();
  const before = structuredClone(original);

  const requestTask = prepareAgentDraftRevision(original, {
    fields: ['title'],
    instruction: '修改标题',
  });

  const result = await createMockAgentModel().generate({
    task: requestTask,
    instruction: '修改标题',
  });

  assert.equal(result.output.draft.title, '原标题（模拟修改）');
  assert.equal(result.output.draft.body, '原正文');
  assert.equal(result.output.draft.sourceNotes, '原核对备注');

  const parsed = parseAgentModelOutput(
    requestTask,
    JSON.stringify(result.output),
  );

  assert.equal(parsed.draft.title, '原标题（模拟修改）');
  assert.deepEqual(original, before);
});

test('mock revision does not invent new values for other selected fields', async () => {
  const requestTask = prepareAgentDraftRevision(writingTask(), {
    fields: ['body'],
    instruction: '加入尚未提供的活动成果',
  });

  const result = await createMockAgentModel().generate({
    task: requestTask,
    instruction: '加入尚未提供的活动成果',
  });

  assert.equal(result.output.draft.body, '原正文');
  assert.equal(result.output.draft.title, '原标题');
});