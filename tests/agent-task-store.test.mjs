import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileAgentTaskStore } from '../lib/agent/task-store.js';
import { createAgentTaskService } from '../lib/agent/task-service.js';
import { createMockAgentModel } from '../lib/agent/mock-model.js';
import { createAgentTask } from '../public/app/shared/agent-workflow.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-store-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const filePath = join(directory, 'tasks.json');
  return {
    filePath,
    store: createFileAgentTaskStore({ filePath }),
  };
}

function entry() {
  return {
    actor: 'synthetic-admin',
    task: {
      ...createAgentTask({
        id: 'synthetic-task',
        mode: 'activity',
        brief: '合成活动需求',
      }),
      version: 1,
      provider: 'mock',
      simulated: true,
    },
  };
}

test('a missing storage file starts with an empty list', t => {
  const { store } = fixture(t);
  assert.deepEqual(store.load(), []);
});

test('saved tasks survive creating a new store instance', t => {
  const { store, filePath } = fixture(t);
  const entries = [entry()];
  store.save(entries);

  const reopened = createFileAgentTaskStore({ filePath });
  assert.deepEqual(reopened.load(), entries);

  const loaded = reopened.load();
  loaded[0].task.brief = '修改读取副本';
  assert.equal(reopened.load()[0].task.brief, '合成活动需求');
});

test('invalid writes leave the previous file unchanged', t => {
  const { store, filePath } = fixture(t);
  store.save([entry()]);
  const original = readFileSync(filePath, 'utf8');

  const invalid = entry();
  invalid.task.steps[1].status = 'confirmed';

  assert.throws(() => store.save([invalid]));
  assert.equal(readFileSync(filePath, 'utf8'), original);

  assert.throws(() => store.save([entry(), entry()]));
  assert.equal(readFileSync(filePath, 'utf8'), original);
});

test('corrupted or unsupported storage files fail explicitly', t => {
  const { store, filePath } = fixture(t);

  writeFileSync(filePath, '{broken', 'utf8');
  assert.throws(() => store.load());

  writeFileSync(filePath, JSON.stringify({
    schemaVersion: 999,
    entries: [],
  }), 'utf8');
  assert.throws(() => store.load());
});

const access = {
  actor: 'synthetic-admin',
  permissions: ['events', 'outreach'],
};

test('service restores saved results and continues after restarting', async t => {
  const { store } = fixture(t);

  const first = createAgentTaskService({
    model: createMockAgentModel(),
    store,
    idFactory: () => 'synthetic-persisted-task',
  });

  const created = first.create({
    ...access,
    mode: 'activity',
    brief: '合成持久化需求',
  });

  const generated = await first.generate({
    ...access,
    id: created.id,
    version: created.version,
  });

  const restarted = createAgentTaskService({
    model: createMockAgentModel(),
    store,
  });

  assert.deepEqual(
    restarted.get({ ...access, id: created.id }),
    generated,
  );

  const confirmed = restarted.confirm({
    ...access,
    id: created.id,
    version: generated.version,
    stepId: generated.steps[0].id,
  });

  assert.equal(confirmed.steps[0].status, 'confirmed');

  const again = createAgentTaskService({
    model: createMockAgentModel(),
    store,
  });

  assert.deepEqual(
    again.get({ ...access, id: created.id }),
    confirmed,
  );

  assert.throws(() => again.get({
    ...access,
    actor: 'another-admin',
    id: created.id,
  }), error => error.statusCode === 404);
});

test('failed persistence does not change the task or its version', async () => {
  let rejectWrites = false;
  let persisted = [];

  const store = {
    load: () => structuredClone(persisted),
    save(entries) {
      if (rejectWrites) throw new Error('合成存储失败');
      persisted = structuredClone(entries);
    },
  };

  const service = createAgentTaskService({
    model: createMockAgentModel(),
    store,
    idFactory: () => 'synthetic-write-failure',
  });

  const created = service.create({
    ...access,
    mode: 'activity',
    brief: '合成失败恢复需求',
  });

  rejectWrites = true;

  await assert.rejects(() => service.generate({
    ...access,
    id: created.id,
    version: created.version,
  }), /合成存储失败/);

  assert.deepEqual(
    service.get({ ...access, id: created.id }),
    created,
  );

  assert.deepEqual(persisted[0].task, created);

  rejectWrites = false;

  const generated = await service.generate({
    ...access,
    id: created.id,
    version: created.version,
  });

  assert.equal(generated.version, created.version + 1);
});

test('failed creation is not retained in memory', () => {
  const service = createAgentTaskService({
    model: createMockAgentModel(),
    idFactory: () => 'synthetic-failed-create',
    store: {
      load: () => [],
      save() {
        throw new Error('合成存储失败');
      },
    },
  });

  assert.throws(() => service.create({
    ...access,
    mode: 'activity',
    brief: '合成创建需求',
  }), /合成存储失败/);

  assert.throws(() => service.get({
    ...access,
    id: 'synthetic-failed-create',
  }), error => error.statusCode === 404);
});

test('deleted tasks remain deleted after restarting the service', t => {
  const { store } = fixture(t);
  const service = createAgentTaskService({
    model: createMockAgentModel(),
    store,
    idFactory: () => 'synthetic-deleted-task',
  });

  const task = service.create({
    ...access,
    mode: 'activity',
    brief: '合成删除需求',
  });

  service.remove({
    ...access,
    id: task.id,
    version: task.version,
  });

  const restarted = createAgentTaskService({
    model: createMockAgentModel(),
    store,
  });

  assert.deepEqual(restarted.list(access), []);
  assert.throws(
    () => restarted.get({ ...access, id: task.id }),
    error => error.statusCode === 404,
  );
});

test('failed deletion preserves the stored task and memory task', () => {
  let rejectWrites = false;
  let persisted = [];

  const service = createAgentTaskService({
    model: createMockAgentModel(),
    idFactory: () => 'synthetic-delete-failure',
    store: {
      load: () => [],
      save(entries) {
        if (rejectWrites) throw new Error('合成删除保存失败');
        persisted = structuredClone(entries);
      },
    },
  });

  const task = service.create({
    ...access,
    mode: 'activity',
    brief: '合成删除失败需求',
  });

  rejectWrites = true;

  assert.throws(() => service.remove({
    ...access,
    id: task.id,
    version: task.version,
  }), /合成删除保存失败/);

  assert.deepEqual(service.get({ ...access, id: task.id }), task);
  assert.deepEqual(persisted[0].task, task);
});

test('candidate outputs survive restart without automatically becoming saved drafts', async t => {
  const { store } = fixture(t);
  const service = createAgentTaskService({
    model: createMockAgentModel(),
    store,
    idFactory: () => 'synthetic-candidate-task',
  });

  let task = service.create({
    ...access,
    mode: 'writing',
    brief: '合成候选需求',
  });

  while (task.steps.find(step => step.status !== 'confirmed').id !== 'draft') {
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

  task = await service.generate({
    ...access,
    id: task.id,
    version: task.version,
  });

  assert.ok(task.steps.find(step => step.id === 'draft').output.draft);
  assert.equal(Object.hasOwn(task, 'writingDraft'), false);

  const restarted = createAgentTaskService({
    model: createMockAgentModel(),
    store,
  });

  assert.deepEqual(
    restarted.get({ ...access, id: task.id }),
    task,
  );

  const confirmed = restarted.confirm({
    ...access,
    id: task.id,
    version: task.version,
    stepId: 'draft',
  });

  assert.ok(confirmed.steps.find(step => step.id === 'draft').output.draft);
  assert.equal(Object.hasOwn(confirmed, 'writingDraft'), false);
});