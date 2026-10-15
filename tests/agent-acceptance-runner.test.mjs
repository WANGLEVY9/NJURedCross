import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_ACCEPTANCE_CASES,
} from './fixtures/agent-acceptance-cases.mjs';
import {
  runAgentAcceptance,
} from '../lib/agent/acceptance-runner.js';
import {
  createMockAgentModel,
} from '../lib/agent/mock-model.js';

test('mock model completes all nine structural checks', async () => {
  const report = await runAgentAcceptance({
    cases: AGENT_ACCEPTANCE_CASES,
    model: createMockAgentModel(),
  });

  assert.equal(report.total, 9);
  assert.equal(report.passed, 9);
  assert.equal(report.failed, 0);
  assert.equal(report.manualReviewRequired, true);
  assert.ok(report.results.every(item => item.manualReviewRequired));
});

test('a failed case does not prevent later cases from running', async () => {
  const mock = createMockAgentModel();
  let calls = 0;

  const report = await runAgentAcceptance({
    cases: AGENT_ACCEPTANCE_CASES,
    model: {
      async generate(options) {
        calls++;
        if (calls === 1) throw new Error('synthetic-secret');
        return mock.generate(options);
      },
    },
  });

  assert.equal(calls, 9);
  assert.equal(report.failed, 1);
  assert.equal(report.passed, 8);
  assert.equal(JSON.stringify(report).includes('synthetic-secret'), false);
});

test('missing candidate drafts fail structural checks', async () => {
  const report = await runAgentAcceptance({
    cases: [AGENT_ACCEPTANCE_CASES[0]],
    model: {
      async generate() {
        return {
          output: {
            title: '合成结果',
            summary: '合成说明',
            items: [],
          },
        };
      },
    },
  });

  assert.equal(report.failed, 1);
});

test('acceptance execution does not mutate case definitions', async () => {
  const before = structuredClone(AGENT_ACCEPTANCE_CASES);

  await runAgentAcceptance({
    cases: AGENT_ACCEPTANCE_CASES,
    model: createMockAgentModel(),
  });

  assert.deepEqual(AGENT_ACCEPTANCE_CASES, before);
});