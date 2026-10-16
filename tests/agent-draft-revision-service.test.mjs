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
  permissions: ['outreach'],
};

const draft = {
  title: '原标题',
  lead: '原导语',
  body: '原正文',
  closing: '原结尾',
  sourceNotes: '原核对备注',
};

function service({
  model = createMockAgentModel(),
  store = null,
} = {}) {
  return createAgentTaskService({
    model,
    store,
    idFactory: () => 'synthetic-revision-task',
  });
}

async function prepare(instance) {
  let task = instance.create({
    ...access,
    mode: 'writing',
    brief: '合成需求',
  });

  while (task.status !== 'draft_ready') {
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

  return instance.saveWritingDraft({
    ...access,
    id: task.id,
    version: task.version,
    draft,
  });
}

function options(task) {
  return {
    ...access,
    id: task.id,
    version: task.version,
    fields: ['title'],
    instruction: '只改标题，其他内容保持原样',
  };
}

test('proposals persist without changing the saved draft or progress', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-revision-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = createFileAgentTaskStore({
    filePath: join(directory, 'tasks.json'),
  });
  const instance = service({ store });
  const original = await prepare(instance);
  const proposed = await instance.proposeDraftRevision(options(original));

  assert.deepEqual(proposed.writingDraft, original.writingDraft);
  assert.deepEqual(proposed.steps, original.steps);
  assert.equal(proposed.status, 'draft_ready');
  assert.equal(proposed.version, original.version + 1);
  assert.equal(
    proposed.draftRevisionProposal.draft.title,
    '原标题（模拟修改）',
  );

  const restarted = service({ store });
  assert.deepEqual(
    restarted.get({ ...access, id: original.id }),
    proposed,
  );

  const saved = restarted.saveWritingDraft({
    ...access,
    id: original.id,
    version: proposed.version,
    draft: { ...draft, title: '人工修改的标题' },
  });

  assert.equal(Object.hasOwn(saved, 'draftRevisionProposal'), false);
});

test('foreign accounts, revoked permissions, stale versions and invalid input are rejected', async () => {
  const instance = service();
  const task = await prepare(instance);

  for (const [overrides, status] of [
    [{ actor: 'another-admin' }, 404],
    [{ permissions: [] }, 403],
    [{ version: task.version - 1 }, 409],
    [{ fields: ['publish'] }, 400],
    [{ fields: ['title', 'title'] }, 400],
    [{ instruction: '' }, 400],
  ]) {
    await assert.rejects(
      () => instance.proposeDraftRevision({
        ...options(task),
        ...overrides,
      }),
      error => error.statusCode === status,
    );
  }

  assert.deepEqual(instance.get({ ...access, id: task.id }), task);
});

test('server preserves unselected fields even when the model changes them', async () => {
  const mock = createMockAgentModel();
  const instance = service({
    model: {
      provider: 'mock',
      async generate(input) {
        if (!input.task.draftRevision) return mock.generate(input);

        return {
          output: {
            draft: {
              title: '候选标题',
              body: '不应采用的正文',
              sourceNotes: '不应采用的备注',
            },
          },
        };
      },
    },
  });

  const task = await prepare(instance);
  const result = await instance.proposeDraftRevision(options(task));
  const proposal = result.draftRevisionProposal;

  assert.equal(proposal.draft.title, '候选标题');
  assert.equal(proposal.draft.body, '原正文');
  assert.equal(proposal.draft.sourceNotes, '原核对备注');
  assert.deepEqual(result.writingDraft, draft);
});

test('pending and failed revisions preserve the task and release the busy lock', async () => {
  const mock = createMockAgentModel();
  let rejectPending;
  let revisionCalls = 0;

  const instance = service({
    model: {
      provider: 'mock',
      async generate(input) {
        if (input.task.draftRevision && ++revisionCalls === 1) {
          return new Promise((_resolve, reject) => {
            rejectPending = reject;
          });
        }
        return mock.generate(input);
      },
    },
  });

  const task = await prepare(instance);
  const pending = instance.proposeDraftRevision(options(task));

  await assert.rejects(
    () => instance.proposeDraftRevision(options(task)),
    error => error.code === 'agent_task_busy',
  );

  assert.throws(
    () => instance.remove(options(task)),
    error => error.code === 'agent_task_busy',
  );

  const rejected = assert.rejects(pending, /合成修改失败/);
  rejectPending(new Error('合成修改失败'));
  await rejected;

  assert.deepEqual(instance.get({ ...access, id: task.id }), task);

  const retried = await instance.proposeDraftRevision(options(task));
  assert.ok(retried.draftRevisionProposal);
});

test('failed proposal persistence does not change the task version', async () => {
  let rejectWrites = false;
  const instance = service({
    store: {
      load: () => [],
      save() {
        if (rejectWrites) throw new Error('合成存储失败');
      },
    },
  });

  const task = await prepare(instance);
  rejectWrites = true;

  await assert.rejects(
    () => instance.proposeDraftRevision(options(task)),
    /合成存储失败/,
  );

  assert.deepEqual(instance.get({ ...access, id: task.id }), task);
});