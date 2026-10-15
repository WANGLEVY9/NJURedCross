import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFileAgentTaskStore,
} from '../lib/agent/task-store.js';
import {
  createAgentTask,
} from '../public/app/shared/agent-workflow.js';
import {
  createAgentConversation,
  stageAgentUnderstanding,
  confirmAgentUnderstanding,
  stageAgentConversationResult,
} from '../public/app/shared/agent-conversation.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-conversation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  return createFileAgentTaskStore({
    filePath: join(directory, 'tasks.json'),
  });
}

function entry(task) {
  return {
    actor: 'synthetic-admin',
    task: {
      ...task,
      version: 1,
      provider: 'mock',
      simulated: true,
    },
  };
}

function states() {
  const initial = createAgentConversation({
    id: 'synthetic-conversation',
    mode: 'writing',
    brief: '合成宣传需求',
  });
  const understood = stageAgentUnderstanding(initial, {
    summary: '整理合成宣传内容。',
    draft: {},
  });
  const ready = confirmAgentUnderstanding(understood);
  const result = stageAgentConversationResult(ready, {
    output: {
      title: '合成推文方案',
      summary: '合成说明',
      items: ['合成建议'],
      draft: { title: '合成标题', body: '合成正文' },
    },
  });

  return [initial, understood, ready, result];
}

test('all conversation stages survive storage and reload', t => {
  const store = fixture(t);

  for (const task of states()) {
    const entries = [entry(task)];
    store.save(entries);
    assert.deepEqual(store.load(), entries);
  }
});

test('old tasks and conversation tasks can share one store', t => {
  const store = fixture(t);
  const old = createAgentTask({
    id: 'synthetic-old-task',
    mode: 'activity',
    brief: '合成旧任务',
  });
  const entries = [entry(old), entry(states().at(-1))];

  store.save(entries);
  assert.deepEqual(store.load(), entries);
});

test('invalid conversation saves preserve existing stored data', t => {
  const store = fixture(t);
  const entries = [entry(states().at(-1))];
  store.save(entries);

  const invalid = structuredClone(entries);
  invalid[0].task.output.draft.unknownField = 'invalid';

  assert.throws(() => store.save(invalid));
  assert.deepEqual(store.load(), entries);
});

test('inconsistent states and duplicate identifiers are rejected', t => {
  const store = fixture(t);
  const task = states()[0];

  const inconsistent = entry(task);
  inconsistent.task.status = 'result_ready';
  assert.throws(() => store.save([inconsistent]));

  assert.throws(() => store.save([entry(task), entry(task)]));
});