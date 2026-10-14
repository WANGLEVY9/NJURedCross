import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentTaskService } from '../lib/agent/task-service.js';
import { createMockAgentModel } from '../lib/agent/mock-model.js';
import { createFileAgentTaskStore } from '../lib/agent/task-store.js';

const access = {
  actor: 'synthetic-admin',
  permissions: ['events', 'outreach'],
};

const draft = {
  title: '合成推文标题',
  lead: '合成导语',
  body: '合成正文第一段。\n\n合成正文第二段。',
  closing: '合成结尾',
  sourceNotes: '内部事实核对备注',
};

function service(store = null) {
  return createAgentTaskService({
    model: createMockAgentModel(),
    store,
    idFactory: () => 'synthetic-writing-task',
  });
}

async function prepare(instance) {
  let task = instance.create({
    ...access,
    mode: 'writing',
    brief: '合成宣传需求',
  });

  while (task.steps.find(step => step.id === 'draft')
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

test('writing configuration requires the right mode and confirmed draft step', () => {
  for (const mode of ['activity', 'writing']) {
    const instance = service();
    const task = instance.create({
      ...access,
      mode,
      brief: '合成需求',
    });

    assert.throws(() => instance.saveWritingDraft({
      ...access,
      id: task.id,
      version: task.version,
      draft,
    }), error => error.statusCode === (mode === 'writing' ? 409 : 400));
  }
});

test('saved writing drafts survive file storage and service restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-writing-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = createFileAgentTaskStore({
    filePath: join(directory, 'tasks.json'),
  });
  const instance = service(store);
  const task = await prepare(instance);

  const saved = instance.saveWritingDraft({
    ...access,
    id: task.id,
    version: task.version,
    draft: { ...draft, publish: true, actor: 'another-admin' },
  });

  assert.deepEqual(saved.writingDraft, draft);
  assert.equal(saved.version, task.version + 1);
  assert.equal(saved.status, task.status);

  const restarted = service(store);
  assert.deepEqual(
    restarted.get({ ...access, id: task.id }),
    saved,
  );
});

test('invalid drafts, stale versions and foreign accounts cannot change the task', async () => {
  const instance = service();
  const task = await prepare(instance);

  for (const [overrides, status] of [
    [{ draft: { title: '', body: '' } }, 400],
    [{ version: task.version - 1 }, 409],
    [{ actor: 'another-admin' }, 404],
    [{ permissions: ['events'] }, 403],
  ]) {
    assert.throws(() => instance.saveWritingDraft({
      ...access,
      id: task.id,
      version: task.version,
      draft,
      ...overrides,
    }), error => error.statusCode === status);
  }

  assert.deepEqual(instance.get({ ...access, id: task.id }), task);
});

test('failed persistence retains the original writing task', async () => {
  let rejectWrites = false;
  let persisted = [];

  const instance = service({
    load: () => [],
    save(entries) {
      if (rejectWrites) throw new Error('合成保存失败');
      persisted = structuredClone(entries);
    },
  });

  const task = await prepare(instance);
  rejectWrites = true;

  assert.throws(() => instance.saveWritingDraft({
    ...access,
    id: task.id,
    version: task.version,
    draft,
  }), /合成保存失败/);

  assert.deepEqual(instance.get({ ...access, id: task.id }), task);
  assert.deepEqual(persisted[0].task, task);
});