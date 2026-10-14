import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTaskService } from '../lib/agent/task-service.js';
import { createMockAgentModel } from '../lib/agent/mock-model.js';
import { getActiveAgentStep } from '../public/app/shared/agent-workflow.js';

const access = {
  actor: 'synthetic-admin',
  permissions: ['events', 'outreach'],
};

function fixture(options = {}) {
  let count = 0;
  const service = createAgentTaskService({
    model: createMockAgentModel(),
    idFactory: () => `synthetic-task-${++count}`,
    now: () => '2026-10-14T00:00:00Z',
    ...options,
  });
  const task = service.create({
    ...access,
    mode: 'activity',
    brief: '合成需求：校园急救知识宣传',
  });
  return { service, task };
}

test('creation requires an account and the corresponding module permission', () => {
  const { service } = fixture();
  assert.throws(() => service.create({
    ...access,
    actor: '',
    mode: 'activity',
    brief: '合成需求',
  }), { statusCode: 401 });

  assert.throws(() => service.create({
    ...access,
    permissions: ['outreach'],
    mode: 'activity',
    brief: '合成需求',
  }), { statusCode: 403 });

  const writing = service.create({
    ...access,
    permissions: ['outreach'],
    mode: 'writing',
    brief: '合成推文需求',
  });
  assert.equal(writing.version, 1);
  assert.equal(writing.simulated, true);
});

test('another account cannot read or confirm a task', () => {
  const { service, task } = fixture();
  const foreign = {
    ...access,
    actor: 'another-admin',
    id: task.id,
    version: task.version,
    stepId: 'brief',
  };
  assert.throws(() => service.get(foreign), { statusCode: 404 });
  assert.throws(() => service.confirm(foreign), { statusCode: 404 });
});

test('revoked permissions prevent later access and generation', async () => {
  const { service, task } = fixture();
  const denied = {
    ...access,
    permissions: [],
    id: task.id,
    version: task.version,
  };
  assert.throws(() => service.get(denied), { statusCode: 403 });
  await assert.rejects(service.generate(denied), { statusCode: 403 });
});

test('stale versions cannot advance or overwrite a task', async () => {
  const { service, task } = fixture();
  const staged = await service.generate({
    ...access,
    id: task.id,
    version: task.version,
  });
  assert.equal(staged.version, 2);
  assert.equal(staged.status, 'awaiting_confirmation');

  assert.throws(() => service.confirm({
    ...access,
    id: task.id,
    version: task.version,
    stepId: 'brief',
  }), { statusCode: 409 });

  assert.equal(service.get({ ...access, id: task.id }).version, 2);
});

test('pending generation blocks duplicate requests and confirmation', async () => {
  let finish;
  let calls = 0;
  const { service, task } = fixture({
    model: {
      provider: 'mock',
      generate: () => {
        calls++;
        return new Promise((resolve) => { finish = resolve; });
      },
    },
  });
  const options = { ...access, id: task.id, version: task.version };
  const pending = service.generate(options);

  await assert.rejects(service.generate(options), { statusCode: 409 });
  assert.throws(() => service.confirm({
    ...options,
    stepId: 'brief',
  }), { statusCode: 409 });
  assert.equal(calls, 1);

  finish({
    output: {
      title: '合成结果',
      summary: '合成说明',
      items: ['合成事项'],
    },
  });
  const result = await pending;
  assert.equal(result.version, 2);
});

test('failed generation releases the lock and preserves the previous task', async () => {
  let calls = 0;
  const mock = createMockAgentModel();
  const { service, task } = fixture({
    model: {
      provider: 'mock',
      generate: async (options) => {
        calls++;
        if (calls === 1) throw new Error('合成模型失败');
        return mock.generate(options);
      },
    },
  });
  const options = { ...access, id: task.id, version: task.version };

  await assert.rejects(service.generate(options), /合成模型失败/);
  const unchanged = service.get({ ...access, id: task.id });
  assert.equal(unchanged.version, 1);
  assert.equal(unchanged.steps[0].output, null);

  const retried = await service.generate(options);
  assert.equal(retried.version, 2);
});

test('edited results and returned snapshots do not mutate stored state', async () => {
  const { service, task } = fixture();
  const generated = await service.generate({
    ...access,
    id: task.id,
    version: task.version,
  });
  const revised = service.revise({
    ...access,
    id: task.id,
    version: generated.version,
    stepId: 'brief',
    output: {
      title: '人工修改标题',
      summary: '人工修改说明',
      items: ['人工修改事项'],
    },
  });

  assert.equal(revised.version, 3);
  revised.steps[0].output.items.push('不应存入任务');
  const stored = service.get({ ...access, id: task.id });
  assert.deepEqual(stored.steps[0].output.items, ['人工修改事项']);
});

test('confirming each step ends with a draft instead of a business write', async () => {
  const { service, task } = fixture();
  let current = task;
  while (getActiveAgentStep(current)) {
    const stepId = getActiveAgentStep(current).id;
    current = await service.generate({
      ...access,
      id: current.id,
      version: current.version,
    });
    current = service.confirm({
      ...access,
      id: current.id,
      version: current.version,
      stepId,
    });
  }

  assert.equal(current.status, 'draft_ready');
  assert.equal(Object.hasOwn(current, 'eventId'), false);
  assert.equal(Object.hasOwn(current, 'published'), false);
});

test('development task capacity is enforced', () => {
  const { service } = fixture({ maximumTasks: 1 });
  assert.throws(() => service.create({
    ...access,
    mode: 'design',
    brief: '合成美编需求',
  }), { statusCode: 429 });
});