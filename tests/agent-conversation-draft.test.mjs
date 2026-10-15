import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentTaskService } from '../lib/agent/task-service.js';
import { createMockAgentModel } from '../lib/agent/mock-model.js';
import { createFileAgentTaskStore } from '../lib/agent/task-store.js';
import { agentActivityHandoff } from '../public/app/shared/agent-activity-handoff.js';
import {
  AGENT_ACCEPTANCE_CASES,
} from './fixtures/agent-acceptance-cases.mjs';

const access = {
  actor: 'synthetic-admin',
  permissions: ['events', 'outreach'],
};

function options(task) {
  return { ...access, id: task.id, version: task.version };
}

async function fixture(mode, extra = {}) {
  const service = createAgentTaskService({
    model: createMockAgentModel(),
    ...extra,
  });

  let task = service.create({
    ...access,
    taskType: 'conversation',
    mode,
    brief: '合成草稿保存需求',
  });

  task = await service.generateConversation(options(task));
  task = service.confirmConversation(options(task));
  task = await service.generateConversation(options(task));

  return { service, task };
}

test('all conversation modes can save validated drafts', async () => {
  for (const mode of ['activity', 'writing', 'design']) {
    const { service, task } = await fixture(mode);
    const definition = AGENT_ACCEPTANCE_CASES.find(item =>
      item.mode === mode && item.kind === 'revision',
    );

    const saved = service.saveConversationDraft({
      ...options(task),
      mode,
      draft: definition.currentDraft,
    });

    const key = {
      activity: 'activityDraft',
      writing: 'writingDraft',
      design: 'designDraft',
    }[mode];

    assert.ok(saved[key]);
    assert.deepEqual(saved.output.draft, saved.confirmedDraft);
    assert.equal(saved.version, task.version + 1);
  }
});

test('invalid and mismatched draft saves preserve the task', async () => {
  const { service, task } = await fixture('activity');

  assert.throws(() => service.saveConversationDraft({
    ...options(task),
    mode: 'activity',
    draft: {},
  }), { statusCode: 400 });

  assert.throws(() => service.saveConversationDraft({
    ...options(task),
    mode: 'writing',
    draft: { title: '合成标题', body: '合成正文' },
  }), { statusCode: 400 });

  assert.deepEqual(service.get({ ...access, id: task.id }), task);
});

test('saved conversation activity drafts can enter the creation form', async () => {
  const { service, task } = await fixture('activity');
  const definition = AGENT_ACCEPTANCE_CASES.find(item =>
    item.mode === 'activity' && item.kind === 'revision',
  );

  assert.throws(() => agentActivityHandoff(task));

  const saved = service.saveConversationDraft({
    ...options(task),
    mode: 'activity',
    draft: definition.currentDraft,
  });

  assert.equal(agentActivityHandoff(saved).name, definition.currentDraft.name);

  const revised = await service.generateConversation({
    ...options(saved),
    instruction: '调整方案表述',
  });

  assert.equal(Object.hasOwn(revised, 'activityDraft'), false);
  assert.throws(() => agentActivityHandoff(revised));
});

test('saved conversation drafts survive file storage and restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-conversation-draft-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = createFileAgentTaskStore({
    filePath: join(directory, 'tasks.json'),
  });
  const { service, task } = await fixture('writing', { store });

  const saved = service.saveConversationDraft({
    ...options(task),
    mode: 'writing',
    draft: {
      title: '合成推文标题',
      body: '合成正文',
    },
  });

  const restored = createAgentTaskService({
    model: createMockAgentModel(),
    store,
  });

  assert.deepEqual(restored.get({ ...access, id: saved.id }), saved);
});