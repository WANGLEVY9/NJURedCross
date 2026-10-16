import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_ACCEPTANCE_CASES } from './fixtures/agent-acceptance-cases.mjs';
import { prepareAgentAcceptanceCase } from '../lib/agent/acceptance.js';
import { getActiveAgentStep } from '../public/app/shared/agent-workflow.js';
import { AGENT_DRAFT_STEPS } from '../public/app/shared/agent-draft-candidate.js';
import { buildAgentMessages } from '../lib/agent/model-contract.js';

test('nine unique synthetic cases cover all modes and acceptance categories', () => {
  assert.equal(AGENT_ACCEPTANCE_CASES.length, 9);
  assert.equal(new Set(AGENT_ACCEPTANCE_CASES.map(item => item.id)).size, 9);

  for (const mode of ['activity', 'writing', 'design']) {
    assert.deepEqual(
      AGENT_ACCEPTANCE_CASES
        .filter(item => item.mode === mode)
        .map(item => item.kind)
        .sort(),
      ['complete', 'missing', 'revision'],
    );
  }
});

test('all cases prepare the matching draft step and valid model messages', () => {
  for (const definition of AGENT_ACCEPTANCE_CASES) {
    const prepared = prepareAgentAcceptanceCase(definition);

    assert.equal(
      getActiveAgentStep(prepared.task).id,
      AGENT_DRAFT_STEPS[definition.mode],
    );

    const messages = buildAgentMessages({
      task: prepared.task,
      instruction: prepared.instruction,
    });

    assert.equal(messages.length, 2);
    assert.equal(
      JSON.parse(messages[1].content).brief,
      definition.brief,
    );
  }
});

test('revision cases include saved facts and explicit field selections', () => {
  for (const definition of AGENT_ACCEPTANCE_CASES.filter(item =>
    item.kind === 'revision',
  )) {
    const prepared = prepareAgentAcceptanceCase(definition);

    assert.ok(prepared.baseTask);
    assert.deepEqual(
      prepared.task.draftRevision.fields,
      definition.fields,
    );
    assert.equal(prepared.instruction, definition.instruction);
  }
});

test('request preparation does not mutate acceptance data', () => {
  const before = structuredClone(AGENT_ACCEPTANCE_CASES);

  for (const definition of AGENT_ACCEPTANCE_CASES) {
    prepareAgentAcceptanceCase(definition);
  }

  assert.deepEqual(AGENT_ACCEPTANCE_CASES, before);
});

test('cases carry manual factual review requirements', () => {
  for (const definition of AGENT_ACCEPTANCE_CASES) {
    assert.ok(definition.review.length >= 3);
    assert.equal(
      definition.review.every(item => typeof item === 'string' && item.trim()),
      true,
    );
  }
});

test('unmarked or unsupported cases are rejected', () => {
  assert.throws(() => prepareAgentAcceptanceCase({
    ...AGENT_ACCEPTANCE_CASES[0],
    synthetic: false,
  }));

  assert.throws(() => prepareAgentAcceptanceCase({
    ...AGENT_ACCEPTANCE_CASES[0],
    mode: 'unknown',
  }));

  assert.throws(() => prepareAgentAcceptanceCase({
    ...AGENT_ACCEPTANCE_CASES[0],
    kind: 'production',
  }));
});