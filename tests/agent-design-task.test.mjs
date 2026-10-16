import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentTaskService } from '../lib/agent/task-service.js';
import { createMockAgentModel } from '../lib/agent/mock-model.js';
import { createFileAgentTaskStore } from '../lib/agent/task-store.js';
import { emptyAgentDesignDraft } from '../public/app/shared/agent-design-draft.js';

const access = {
  actor: 'synthetic-admin',
  permissions: ['events', 'outreach'],
};

function draft() {
  return {
    ...emptyAgentDesignDraft(),
    title: '合成美编方案',
    audience: '新生',
    headline: '合成主标题',
    body: '合成正文',
    imageNotes: '使用已获授权的照片',
    reviewNotes: '内部核对事项',
  };
}

function service(store = null) {
  return createAgentTaskService({
    model: createMockAgentModel(),
    store,
    idFactory: () => 'synthetic-design-task',
  });
}

async function prepare(instance) {
  let task = instance.create({
    ...access,
    mode: 'design',
    brief: '合成美编需求',
  });

  while (task.steps.find(step => step.id === 'preview')
    .status !== 'confirmed') {
    task = await instance.generate({
      ...access,
      id: task.id,
      version: task.version,
    });

    const active = task.steps.find(step => step.status !== 'confirmed');
    task = instance.confirm({
      ...access,
      id: task.id,
      version: task.version,
      stepId: active.id,
    });
  }

  return task;
}

test('design saving requires the right mode and confirmed preview step', () => {
  for (const mode of ['activity', 'design']) {
    const instance = service();
    const task = instance.create({
      ...access,
      mode,
      brief: '合成需求',
    });

    assert.throws(() => instance.saveDesignDraft({
      ...access,
      id: task.id,
      version: task.version,
      draft: draft(),
    }), error => error.statusCode === (mode === 'design' ? 409 : 400));
  }
});

test('saved design schemes survive file storage and restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-design-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = createFileAgentTaskStore({
    filePath: join(directory, 'tasks.json'),
  });
  const instance = service(store);
  const task = await prepare(instance);

  const saved = instance.saveDesignDraft({
    ...access,
    id: task.id,
    version: task.version,
    draft: { ...draft(), html: '<script>test</script>', publish: true },
  });

  assert.deepEqual(saved.designDraft, draft());
  assert.equal(saved.version, task.version + 1);
  assert.equal(saved.status, task.status);

  const restarted = service(store);
  assert.deepEqual(
    restarted.get({ ...access, id: task.id }),
    saved,
  );
});

test('invalid schemes, stale versions and unauthorized actors cannot change the task', async () => {
  const instance = service();
  const task = await prepare(instance);

  for (const [overrides, status] of [
    [{ draft: { ...draft(), palette: 'custom-css' } }, 400],
    [{ version: task.version - 1 }, 409],
    [{ actor: 'another-admin' }, 404],
    [{ permissions: ['events'] }, 403],
  ]) {
    assert.throws(() => instance.saveDesignDraft({
      ...access,
      id: task.id,
      version: task.version,
      draft: draft(),
      ...overrides,
    }), error => error.statusCode === status);
  }

  assert.deepEqual(instance.get({ ...access, id: task.id }), task);
});

test('failed persistence retains the original design task', async () => {
  let rejectWrites = false;
  let persisted = [];

  const instance = service({
    load: () => [],
    save(entries) {
      if (rejectWrites) throw new Error('合成美编保存失败');
      persisted = structuredClone(entries);
    },
  });

  const task = await prepare(instance);
  rejectWrites = true;

  assert.throws(() => instance.saveDesignDraft({
    ...access,
    id: task.id,
    version: task.version,
    draft: draft(),
  }), /合成美编保存失败/);

  assert.deepEqual(instance.get({ ...access, id: task.id }), task);
  assert.deepEqual(persisted[0].task, task);
});