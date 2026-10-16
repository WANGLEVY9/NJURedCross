import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTaskService } from '../lib/agent/task-service.js';
import { createMockAgentModel } from '../lib/agent/mock-model.js';
import { emptyAgentActivityDraft } from '../public/app/shared/agent-activity-draft.js';

const access = {
  actor: 'synthetic-admin',
  permissions: ['events', 'outreach'],
};

function validDraft() {
  return {
    ...emptyAgentActivityDraft(),
    name: '合成活动',
    category: '急救培训',
    date: '2026-11-01',
    startTime: '09:00',
    endTime: '11:00',
    location: '合成地点',
    content: '合成内容',
    work: '合成工作',
    capacity: 20,
    registrationLimit: 30,
    trainingHours: 0,
    travelHours: 0,
  };
}

function service(store = null) {
  return createAgentTaskService({
    model: createMockAgentModel(),
    store,
    idFactory: () => 'synthetic-activity-task',
  });
}

async function prepare(service) {
  let task = service.create({
    ...access,
    mode: 'activity',
    brief: '合成活动筹备需求',
  });

  while (task.steps.find(step => step.id === 'configuration')
    .status !== 'confirmed') {
    task = await service.generate({
      ...access,
      id: task.id,
      version: task.version,
    });

    const active = task.steps.find(step => step.status !== 'confirmed');

    task = service.confirm({
      ...access,
      id: task.id,
      version: task.version,
      stepId: active.id,
    });
  }

  return task;
}

test('configuration requires an activity task and confirmed configuration step', () => {
  for (const mode of ['activity', 'writing']) {
    const instance = service();
    const task = instance.create({
      ...access,
      mode,
      brief: '合成需求',
    });

    assert.throws(() => instance.saveActivityDraft({
      ...access,
      id: task.id,
      version: task.version,
      draft: validDraft(),
    }), error => error.statusCode === (mode === 'activity' ? 409 : 400));
  }
});

test('saving configuration persists sanitized fields and survives service restart', async () => {
  let persisted = [];
  const store = {
    load: () => structuredClone(persisted),
    save: entries => {
      persisted = structuredClone(entries);
    },
  };

  const instance = service(store);
  const task = await prepare(instance);

  const saved = instance.saveActivityDraft({
    ...access,
    id: task.id,
    version: task.version,
    draft: {
      ...validDraft(),
      submit: true,
      coOwners: ['another-admin'],
    },
  });

  assert.equal(saved.version, task.version + 1);
  assert.equal(saved.activityDraft.serviceHours, 2);
  assert.equal(Object.hasOwn(saved.activityDraft, 'submit'), false);
  assert.equal(Object.hasOwn(saved.activityDraft, 'coOwners'), false);
  assert.equal(saved.status, task.status);

  const restarted = service(store);
  assert.deepEqual(
    restarted.get({ ...access, id: task.id }),
    saved,
  );
});

test('invalid configuration and stale versions do not change the task', async () => {
  const instance = service();
  const task = await prepare(instance);

  assert.throws(() => instance.saveActivityDraft({
    ...access,
    id: task.id,
    version: task.version,
    draft: emptyAgentActivityDraft(),
  }), error => error.statusCode === 400);

  assert.deepEqual(instance.get({ ...access, id: task.id }), task);

  assert.throws(() => instance.saveActivityDraft({
    ...access,
    id: task.id,
    version: task.version - 1,
    draft: validDraft(),
  }), error => error.statusCode === 409);
});

test('another account cannot save configuration', async () => {
  const instance = service();
  const task = await prepare(instance);

  assert.throws(() => instance.saveActivityDraft({
    ...access,
    actor: 'another-admin',
    id: task.id,
    version: task.version,
    draft: validDraft(),
  }), error => error.statusCode === 404);
});