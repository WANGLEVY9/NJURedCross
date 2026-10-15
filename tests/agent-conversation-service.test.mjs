import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentTaskService,
} from '../lib/agent/task-service.js';
import {
  createMockAgentModel,
} from '../lib/agent/mock-model.js';
import {
  createAgentCallLimiter,
} from '../lib/agent/call-limiter.js';

const access = {
  actor: 'synthetic-admin',
  permissions: ['events', 'outreach'],
};

function fixture(options = {}) {
  let count = 0;
  const service = createAgentTaskService({
    model: createMockAgentModel(),
    idFactory: () => `synthetic-conversation-${++count}`,
    ...options,
  });

  const task = service.create({
    ...access,
    taskType: 'conversation',
    mode: 'activity',
    brief: '合成急救课堂，时间地点未定',
  });

  return { service, task };
}

function options(task) {
  return {
    ...access,
    id: task.id,
    version: task.version,
  };
}

test('one confirmation supports generation and subsequent revisions', async () => {
  const { service, task } = fixture();

  const understood = await service.generateConversation(options(task));
  assert.equal(understood.status, 'awaiting_confirmation');

  const ready = service.confirmConversation({
    ...options(understood),
    draft: { name: '合成急救课堂', capacity: 20 },
  });

  const generated = await service.generateConversation(options(ready));
  assert.equal(generated.status, 'result_ready');
  assert.equal(generated.output.draft.capacity, 20);
  assert.equal(generated.output.draft.date, '');

  const revised = await service.generateConversation({
    ...options(generated),
    instruction: '增加课堂互动建议',
  });

  assert.equal(revised.status, 'result_ready');
  assert.equal(revised.messages.at(-2).content, '增加课堂互动建议');
  assert.throws(
    () => service.confirmConversation(options(revised)),
    { statusCode: 400 },
  );
});

test('permissions and task versions protect conversation operations', async () => {
  const { service, task } = fixture();

  await assert.rejects(
    service.generateConversation({
      ...options(task),
      permissions: [],
    }),
    { statusCode: 403 },
  );

  await assert.rejects(
    service.generateConversation({
      ...options(task),
      actor: 'synthetic-other',
    }),
    { statusCode: 404 },
  );

  const understood = await service.generateConversation(options(task));

  assert.throws(
    () => service.confirmConversation(options(task)),
    { statusCode: 409 },
  );

  assert.equal(service.get({
    ...access,
    id: task.id,
  }).version, understood.version);
});

test('failed model calls preserve the task and release concurrency', async () => {
  const mock = createMockAgentModel();
  let calls = 0;

  const { service, task } = fixture({
    model: {
      provider: 'mock',
      async generate(input) {
        calls++;
        if (calls === 1) throw new Error('synthetic failure');
        return mock.generate(input);
      },
    },
  });

  await assert.rejects(
    service.generateConversation(options(task)),
    /synthetic failure/,
  );

  assert.deepEqual(service.get({ ...access, id: task.id }), task);

  const understood = await service.generateConversation(options(task));
  assert.equal(understood.status, 'awaiting_confirmation');
});

test('conversation calls share the configured allowance', async () => {
  const { service, task } = fixture({
    callLimiter: createAgentCallLimiter({ maximumCalls: 1 }),
  });

  const understood = await service.generateConversation(options(task));
  const ready = service.confirmConversation(options(understood));

  await assert.rejects(
    service.generateConversation(options(ready)),
    { statusCode: 429, code: 'agent_call_limit' },
  );

  assert.deepEqual(service.get({ ...access, id: task.id }), ready);
});

test('save failures preserve the previous conversation and permit retry', async () => {
  let failSave = false;
  let snapshot = [];

  const { service, task } = fixture({
    store: {
      load: () => structuredClone(snapshot),
      save(entries) {
        if (failSave) throw new Error('synthetic disk failure');
        snapshot = structuredClone(entries);
      },
    },
  });

  failSave = true;
  await assert.rejects(
    service.generateConversation(options(task)),
    /synthetic disk failure/,
  );
  assert.deepEqual(service.get({ ...access, id: task.id }), task);

  failSave = false;
  const understood = await service.generateConversation(options(task));

  const restored = createAgentTaskService({
    model: createMockAgentModel(),
    store: {
      load: () => structuredClone(snapshot),
      save() {},
    },
  });

  assert.deepEqual(
    restored.get({ ...access, id: task.id }),
    understood,
  );
});