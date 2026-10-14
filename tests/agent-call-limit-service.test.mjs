import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentCallLimiter } from '../lib/agent/call-limiter.js';
import { createAgentTaskService } from '../lib/agent/task-service.js';
import { createMockAgentModel } from '../lib/agent/mock-model.js';
import { prepareAgentAcceptanceCase } from '../lib/agent/acceptance.js';
import {
  AGENT_ACCEPTANCE_CASES,
} from './fixtures/agent-acceptance-cases.mjs';

const access = {
  actor: 'synthetic-admin',
  permissions: ['events', 'outreach'],
};

function fixture({ model, callLimiter }) {
  let count = 0;
  const service = createAgentTaskService({
    model,
    callLimiter,
    idFactory: () => `synthetic-limit-${++count}`,
  });

  const create = () => service.create({
    ...access,
    mode: 'writing',
    brief: '合成宣传需求',
  });

  return { service, create };
}

test('exhausted allowance blocks calls before reaching the model', async () => {
  const mock = createMockAgentModel();
  let calls = 0;
  const { service, create } = fixture({
    callLimiter: createAgentCallLimiter({ maximumCalls: 1 }),
    model: {
      provider: 'mock',
      async generate(options) {
        calls++;
        return mock.generate(options);
      },
    },
  });

  const first = create();
  await service.generate({ ...access, id: first.id, version: first.version });

  const second = create();
  await assert.rejects(
    service.generate({ ...access, id: second.id, version: second.version }),
    { statusCode: 429, code: 'agent_call_limit' },
  );

  assert.equal(calls, 1);
  assert.equal(service.get({ ...access, id: second.id }).version, second.version);
});

test('failed calls release concurrency but still consume allowance', async () => {
  const mock = createMockAgentModel();
  let calls = 0;
  const { service, create } = fixture({
    callLimiter: createAgentCallLimiter({ maximumCalls: 2 }),
    model: {
      provider: 'mock',
      async generate(options) {
        calls++;
        if (calls === 1) throw new Error('synthetic failure');
        return mock.generate(options);
      },
    },
  });

  const task = create();
  const options = { ...access, id: task.id, version: task.version };

  await assert.rejects(service.generate(options), /synthetic failure/);
  const saved = await service.generate(options);

  await assert.rejects(
    service.generate({ ...options, version: saved.version }),
    { code: 'agent_call_limit' },
  );
  assert.equal(calls, 2);
});

test('different tasks owned by one account share concurrency protection', async () => {
  const mock = createMockAgentModel();
  let resume;
  let calls = 0;
  const gate = new Promise(resolve => { resume = resolve; });

  const { service, create } = fixture({
    callLimiter: createAgentCallLimiter(),
    model: {
      provider: 'mock',
      async generate(options) {
        calls++;
        await gate;
        return mock.generate(options);
      },
    },
  });

  const first = create();
  const second = create();
  const pending = service.generate({
    ...access,
    id: first.id,
    version: first.version,
  });

  try {
    await assert.rejects(
      service.generate({
        ...access,
        id: second.id,
        version: second.version,
      }),
      { code: 'agent_account_busy' },
    );
    assert.equal(calls, 1);
  } finally {
    resume();
    await pending;
  }

  await service.generate({
    ...access,
    id: second.id,
    version: second.version,
  });
  assert.equal(calls, 2);
});

test('draft revision shares the generation allowance', async () => {
  const definition = AGENT_ACCEPTANCE_CASES.find(item =>
    item.mode === 'writing' && item.kind === 'revision',
  );
  const { baseTask } = prepareAgentAcceptanceCase(definition);
  baseTask.version = 1;

  const service = createAgentTaskService({
    model: createMockAgentModel(),
    callLimiter: createAgentCallLimiter({ maximumCalls: 1 }),
    store: {
      load: () => [{ actor: access.actor, task: baseTask }],
      save() {},
    },
  });

  const options = {
    ...access,
    id: baseTask.id,
    version: baseTask.version,
    fields: definition.fields,
    instruction: definition.instruction,
  };

  const proposed = await service.proposeDraftRevision(options);

  await assert.rejects(
    service.generate({
      ...access,
      id: proposed.id,
      version: proposed.version,
    }),
    { code: 'agent_call_limit' },
  );

  await assert.rejects(
    service.proposeDraftRevision({
      ...options,
      version: proposed.version,
    }),
    { code: 'agent_call_limit' },
  );

  assert.deepEqual(proposed.writingDraft, baseTask.writingDraft);
});