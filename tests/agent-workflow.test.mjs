import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_FLOWS,
  createAgentTask,
  getActiveAgentStep,
  stageAgentResult,
  confirmAgentStep,
} from '../public/app/shared/agent-workflow.js';

function task(mode = 'activity') {
  return createAgentTask({
    id: 'synthetic-task',
    mode,
    brief: '合成需求：组织急救知识宣传活动',
    now: '2026-10-14T00:00:00Z',
  });
}

function output(title = '合成步骤结果') {
  return {
    title,
    summary: '仅用于测试的合成说明',
    items: ['合成事项甲', '合成事项乙'],
  };
}

test('all modes start at their first step with the correct permission scope', () => {
  for (const [mode, flow] of Object.entries(AGENT_FLOWS)) {
    const created = task(mode);
    assert.equal(created.status, 'awaiting_input');
    assert.equal(getActiveAgentStep(created).id, flow.steps[0].id);
    assert.ok(created.steps.every((step) => step.status === 'pending'));
    assert.equal(flow.scope, mode === 'activity' ? 'events' : 'outreach');
  }
});

test('invalid task requirements and modes are rejected', () => {
  for (const changes of [
    { mode: 'unknown' },
    { id: '' },
    { brief: ' ' },
    { brief: 'a'.repeat(4001) },
  ]) {
    assert.throws(() => createAgentTask({
      id: 'synthetic-task',
      mode: 'activity',
      brief: '合成需求',
      ...changes,
    }));
  }
});

test('generated results wait for confirmation without changing the original task', () => {
  const original = task();
  const staged = stageAgentResult(original, {
    stepId: 'brief',
    output: output(),
  });

  assert.equal(original.status, 'awaiting_input');
  assert.equal(original.steps[0].output, null);
  assert.equal(staged.status, 'awaiting_confirmation');
  assert.equal(staged.steps[0].status, 'ready');
  assert.equal(getActiveAgentStep(staged).id, 'brief');
});

test('steps cannot be skipped or confirmed before a result exists', () => {
  const created = task();
  assert.throws(() => stageAgentResult(created, {
    stepId: 'plan',
    output: output(),
  }));
  assert.throws(() => confirmAgentStep(created, 'brief'));
});

test('confirming a result advances exactly one step', () => {
  const staged = stageAgentResult(task(), {
    stepId: 'brief',
    output: output(),
  });
  const confirmed = confirmAgentStep(staged, 'brief');

  assert.equal(confirmed.steps[0].status, 'confirmed');
  assert.equal(confirmed.status, 'awaiting_input');
  assert.equal(getActiveAgentStep(confirmed).id, 'plan');
  assert.equal(staged.steps[0].status, 'ready');
  assert.throws(() => confirmAgentStep(confirmed, 'brief'));
});

test('the current unconfirmed result can be revised', () => {
  const staged = stageAgentResult(task(), {
    stepId: 'brief',
    output: output('第一版'),
  });
  const revised = stageAgentResult(staged, {
    stepId: 'brief',
    output: output('修改版'),
  });

  assert.equal(staged.steps[0].output.title, '第一版');
  assert.equal(revised.steps[0].output.title, '修改版');
  assert.equal(revised.status, 'awaiting_confirmation');
});

test('malformed model results are rejected', () => {
  for (const invalid of [
    null,
    { title: '', summary: '合成说明', items: [] },
    { title: '合成标题', summary: '', items: [] },
    { title: '合成标题', summary: '合成说明', items: '错误类型' },
    { title: '合成标题', summary: '合成说明', items: [123] },
    {
      title: '合成标题',
      summary: '合成说明',
      items: Array(41).fill('合成事项'),
    },
  ]) {
    assert.throws(() => stageAgentResult(task(), {
      stepId: 'brief',
      output: invalid,
    }));
  }
});

test('completed flows become draft-ready without claiming business execution', () => {
  for (const mode of Object.keys(AGENT_FLOWS)) {
    let current = task(mode);
    while (getActiveAgentStep(current)) {
      const stepId = getActiveAgentStep(current).id;
      current = stageAgentResult(current, {
        stepId,
        output: output(),
      });
      current = confirmAgentStep(current, stepId);
    }

    assert.equal(current.status, 'draft_ready');
    assert.equal(getActiveAgentStep(current), null);
    assert.ok(current.steps.every((step) => step.status === 'confirmed'));
    assert.equal(Object.hasOwn(current, 'published'), false);
    assert.equal(Object.hasOwn(current, 'eventId'), false);
  }
});