import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  validateStoredAgentConversation,
} from './conversation-validation.js';
import {
  validateAgentDraftRevisionProposal,
} from '../../public/app/shared/agent-draft-revision.js';
import { agentDesignDraft } from '../../public/app/shared/agent-design-draft.js';
import { agentWritingDraft } from '../../public/app/shared/agent-writing-draft.js';
import { agentActivitySeed } from '../../public/app/shared/agent-activity-draft.js';
import {
  AGENT_FLOWS,
  createAgentTask,
  stageAgentResult,
} from '../../public/app/shared/agent-workflow.js';

function invalidStore() {
  return new Error('助手任务存储格式不正确，请检查文件，禁止覆盖原数据');
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length > 100) {
    throw invalidStore();
  }

  const ids = new Set();

  for (const entry of entries) {
    const task = entry?.task;

    if (
      typeof entry?.actor !== 'string' ||
      !entry.actor.trim() ||
      !task ||
      !Object.hasOwn(AGENT_FLOWS, task.mode) ||
      !Number.isInteger(task.version) ||
      task.version < 1 ||
      typeof task.provider !== 'string' ||
      typeof task.simulated !== 'boolean' ||
      !Number.isFinite(Date.parse(task.createdAt)) ||
      !Number.isFinite(Date.parse(task.updatedAt))
    ) {
      throw invalidStore();
    }

    if (task.taskType === 'conversation') {
      if (ids.has(task.id)) throw invalidStore();

      validateStoredAgentConversation(task);
      ids.add(task.id);
      continue;
    }

    const initial = createAgentTask({
      id: task.id,
      mode: task.mode,
      brief: task.brief,
      now: task.createdAt,
    });

    if (
      ids.has(task.id) ||
      !Array.isArray(task.steps) ||
      task.steps.length !== initial.steps.length
    ) {
      throw invalidStore();
    }
    ids.add(task.id);

    let activeFound = false;

    for (const [index, step] of task.steps.entries()) {
      const expected = initial.steps[index];

      if (
        step.id !== expected.id ||
        step.label !== expected.label ||
        !['pending', 'ready', 'confirmed'].includes(step.status)
      ) {
        throw invalidStore();
      }

      if (activeFound) {
        if (step.status !== 'pending' || step.output !== null) {
          throw invalidStore();
        }
        continue;
      }

      if (step.status === 'pending') {
        if (step.output !== null) throw invalidStore();
        activeFound = true;
      } else {
        // 复用流程模块的输出校验，避免放过畸形历史内容。
        const validationTask = createAgentTask({
          id: task.id,
          mode: task.mode,
          brief: task.brief,
          now: task.createdAt,
        });

        for (let previous = 0; previous < index; previous++) {
          validationTask.steps[previous].status = 'confirmed';
        }

        stageAgentResult(validationTask, {
          stepId: step.id,
          output: step.output,
          now: task.updatedAt,
        });

        if (step.status === 'ready') activeFound = true;
      }
    }

    const active = task.steps.find(step => step.status !== 'confirmed');
    const expectedStatus = !active
      ? 'draft_ready'
      : active.status === 'ready'
        ? 'awaiting_confirmation'
        : 'awaiting_input';

    if (task.status !== expectedStatus) throw invalidStore();
    if (Object.hasOwn(task, 'draftRevisionProposal')) {
      validateAgentDraftRevisionProposal(
        task,
        task.draftRevisionProposal,
      );
    }
    if (Object.hasOwn(task, 'designDraft')) {
      const previewStep = task.steps.find(step => step.id === 'preview');

      if (
        task.mode !== 'design' ||
        previewStep?.status !== 'confirmed'
      ) {
        throw invalidStore();
      }

      const normalized = agentDesignDraft(task.designDraft);
      const storedKeys = Object.keys(task.designDraft).sort();
      const expectedKeys = Object.keys(normalized).sort();

      if (
        JSON.stringify(storedKeys) !== JSON.stringify(expectedKeys) ||
        expectedKeys.some(key =>
          task.designDraft[key] !== normalized[key],
        )
      ) {
        throw invalidStore();
      }
    }
    if (Object.hasOwn(task, 'writingDraft')) {
      const draftStep = task.steps.find(step => step.id === 'draft');

      if (
        task.mode !== 'writing' ||
        draftStep?.status !== 'confirmed'
      ) {
        throw invalidStore();
      }

      const normalized = agentWritingDraft(task.writingDraft);
      const storedKeys = Object.keys(task.writingDraft).sort();
      const expectedKeys = Object.keys(normalized).sort();

      if (
        JSON.stringify(storedKeys) !== JSON.stringify(expectedKeys) ||
        expectedKeys.some(key =>
          task.writingDraft[key] !== normalized[key],
        )
      ) {
        throw invalidStore();
      }
    }
    if (Object.hasOwn(task, 'activityDraft')) {
      const configuration = task.steps.find(
        step => step.id === 'configuration',
      );

      if (
        task.mode !== 'activity' ||
        configuration?.status !== 'confirmed'
      ) {
        throw invalidStore();
      }

      const seed = agentActivitySeed(task.activityDraft);
      const storedKeys = Object.keys(task.activityDraft).sort();
      const expectedKeys = Object.keys(seed).sort();

      if (
        JSON.stringify(storedKeys) !== JSON.stringify(expectedKeys) ||
        expectedKeys.some(key => task.activityDraft[key] !== seed[key])
      ) {
        throw invalidStore();
      }
    }
  }

  return entries;
}

export function createFileAgentTaskStore({ filePath }) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('缺少助手任务存储路径');
  }

  return {
    load() {
      let content;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }

      const payload = JSON.parse(content);
      if (payload?.schemaVersion !== 1) throw invalidStore();

      return structuredClone(validateEntries(payload.entries));
    },

    save(entries) {
      validateEntries(entries);

      const content = JSON.stringify({
        schemaVersion: 1,
        entries,
      }, null, 2);

      mkdirSync(dirname(filePath), { recursive: true });

      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporaryPath, content, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        renameSync(temporaryPath, filePath);
      } catch (error) {
        try {
          unlinkSync(temporaryPath);
        } catch {
          // 只清理本次临时文件，保留正式存储文件。
        }
        throw error;
      }
    },
  };
}