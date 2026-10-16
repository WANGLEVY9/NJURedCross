import { randomUUID } from 'node:crypto';
import {
  agentContextQueries,
  normalizeAgentBusinessContext,
} from './business-context.js';
import {
  prepareAgentDraftRevision,
  buildAgentDraftRevision,
} from '../../public/app/shared/agent-draft-revision.js';
import { AgentModelError } from './compatible-model.js';
import { createAgentCallLimiter } from './call-limiter.js';
import {
  normalizeAgentDraftCandidate,
} from '../../public/app/shared/agent-draft-candidate.js';
import {
  createAgentConversation,
  confirmAgentUnderstanding,
  stageAgentUnderstanding,
  stageAgentConversationResult,
} from '../../public/app/shared/agent-conversation.js';
import {
  buildConversationMessages,
  parseConversationOutput,
} from './conversation-contract.js';
import { agentWritingDraft } from '../../public/app/shared/agent-writing-draft.js';
import { agentActivitySeed } from '../../public/app/shared/agent-activity-draft.js';
import {
  AGENT_FLOWS,
  createAgentTask,
  stageAgentResult,
  confirmAgentStep,
} from '../../public/app/shared/agent-workflow.js';
import { agentDesignDraft } from '../../public/app/shared/agent-design-draft.js';

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function createAgentTaskService({
  model,
  idFactory = randomUUID,
  now = () => new Date().toISOString(),
  maximumTasks = 100,
  store = null,
  callLimiter = createAgentCallLimiter(),
  readBusinessContext = null,
}) {
  const restored = store ? store.load() : [];
  const tasks = new Map(
    restored.map(entry => [entry.task.id, structuredClone(entry)]),
  );
  const busy = new Set();

  function requireActor(actor) {
    if (typeof actor !== 'string' || !actor.trim()) {
      throw failure(401, 'agent_login_required', '请先登录');
    }
  }

  function requireScope(mode, permissions) {
    const flow = Object.hasOwn(AGENT_FLOWS, mode)
      ? AGENT_FLOWS[mode]
      : null;
    if (!flow) {
      throw failure(400, 'agent_mode_invalid', '不支持的工作模式');
    }
    if (!Array.isArray(permissions) || !permissions.includes(flow.scope)) {
      throw failure(403, 'agent_permission_denied', '没有该工作模式的权限');
    }
  }

  function ownedTask({ id, actor, permissions }) {
    requireActor(actor);
    const entry = tasks.get(id);
    if (!entry || entry.actor !== actor) {
      throw failure(404, 'agent_task_not_found', '任务不存在或不可查看');
    }
    requireScope(entry.task.mode, permissions);
    return entry;
  }

  function editableTask(options) {
    const entry = ownedTask(options);
    if (busy.has(options.id)) {
      throw failure(409, 'agent_task_busy', '当前步骤正在生成，请稍后再试');
    }
    if (
      !Number.isInteger(options.version) ||
      options.version !== entry.task.version
    ) {
      throw failure(409, 'agent_task_changed', '任务已更新，请重新加载后操作');
    }
    return entry;
  }

  function persist(nextEntry) {
    if (!store) return;

    const snapshot = [...tasks.values()]
      .filter(entry => entry.task.id !== nextEntry.task.id)
      .map(entry => structuredClone(entry));

    snapshot.push(structuredClone(nextEntry));
    store.save(snapshot);
  }

  function save(entry, next) {
    next.version = entry.task.version + 1;

    // 保存失败会抛出错误，已有内存任务不发生改变。
    persist({ actor: entry.actor, task: next });

    entry.task = next;
    return structuredClone(next);
  }

  return {
    modelStatus() {
      return {
        provider: model.provider,
        simulated: model.provider === 'mock',
      };
    },

    create({ actor, permissions, mode, brief, taskType = 'workflow' }) {
      if (!['workflow', 'conversation'].includes(taskType)) {
        throw failure(400, 'agent_type_invalid', '不支持的任务类型');
      }
      requireActor(actor);
      requireScope(mode, permissions);
      if (tasks.size >= maximumTasks) {
        throw failure(429, 'agent_task_limit', '开发任务数量已达上限');
      }

      const id = idFactory();
      if (tasks.has(id)) {
        throw failure(409, 'agent_task_exists', '任务编号重复');
      }

      const createTask = taskType === 'conversation'
        ? createAgentConversation
        : createAgentTask;

      const task = {
        ...createTask({ id, mode, brief, now: now() }),
        version: 1,
        provider: model.provider,
        simulated: model.provider === 'mock',
      };
      const entry = { actor, task };
      persist(entry);
      tasks.set(id, entry);
      return structuredClone(task);
    },

    get(options) {
      const task = structuredClone(ownedTask(options).task);

      if (task.businessContext) {
        task.businessContext = normalizeAgentBusinessContext(
          task.businessContext,
          options.permissions,
        );
      }

      return task;
    },
    saveConversationDraft(options) {
      const entry = editableTask(options);

      if (
        entry.task.taskType !== 'conversation' ||
        entry.task.status !== 'result_ready' ||
        entry.task.mode !== options.mode
      ) {
        throw failure(
          400,
          'agent_conversation_draft_unavailable',
          '请先生成对应模式的完整方案',
        );
      }

      const definitions = {
        activity: { key: 'activityDraft', normalize: agentActivitySeed },
        writing: { key: 'writingDraft', normalize: agentWritingDraft },
        design: { key: 'designDraft', normalize: agentDesignDraft },
      };
      const definition = definitions[entry.task.mode];

      let draft;
      let editable;
      try {
        draft = definition.normalize(options.draft);

        const names = Object.keys(
          normalizeAgentDraftCandidate(entry.task.mode, {}),
        );
        editable = normalizeAgentDraftCandidate(
          entry.task.mode,
          Object.fromEntries(names.map(name => [name, draft[name]])),
        );
      } catch {
        throw failure(
          400,
          'agent_conversation_draft_invalid',
          '请补齐并核对草稿字段后再保存',
        );
      }

      const next = structuredClone(entry.task);
      next[definition.key] = draft;
      next.output.draft = editable;
      next.confirmedDraft = structuredClone(editable);
      next.updatedAt = now();

      return save(entry, next);
    },

    confirmConversation(options) {
      const entry = editableTask(options);

      let next;
      try {
        next = confirmAgentUnderstanding(entry.task, {
          draft: options.draft ?? {},
          now: now(),
        });
      } catch {
        throw failure(
          400,
          'agent_conversation_confirmation_invalid',
          '请先完成需求理解，并检查所填写的字段',
        );
      }

      return save(entry, next);
    },

    async generateConversation(options) {
      const entry = editableTask(options);
      const instruction = options.instruction ?? '';

      try {
        buildConversationMessages({
          task: entry.task,
          instruction,
        });

        if (entry.task.status === 'ready' && instruction !== '') {
          throw new Error('首次生成请使用已经确认的需求');
        }
      } catch {
        throw failure(
          400,
          'agent_conversation_input_invalid',
          '请检查对话状态和补充要求；修改方案时必须填写修改意见',
        );
      }

      const releaseCall = callLimiter.acquire(options.actor);
      busy.add(options.id);

      try {
        let businessContext = null;

        if (readBusinessContext) {
          try {
            businessContext = normalizeAgentBusinessContext(
              await readBusinessContext({
                brief: [
                  entry.task.brief,
                  entry.task.confirmedDraft?.name || '',
                  entry.task.confirmedDraft?.title || '',
                  instruction,
                ].filter(Boolean).join('；'),
                permissions: options.permissions,
              }),
              options.permissions,
            );
          } catch {
            businessContext = normalizeAgentBusinessContext({
              queries: agentContextQueries(entry.task.brief),
              checkedAt: now(),
              items: [],
              unavailable: options.permissions.filter(scope =>
                ['events', 'materials', 'outreach'].includes(scope)),
              truncated: false,
            }, options.permissions);
          }
        }

        const requestTask = structuredClone(entry.task);
        requestTask.businessContext = businessContext;

        const result = await model.generate({
          task: requestTask,
          instruction,
        });

        let next;
        try {
          const output = parseConversationOutput(
            entry.task,
            JSON.stringify(result.output),
          );

          const understanding = [
            'awaiting_understanding',
            'awaiting_confirmation',
          ].includes(entry.task.status);

          next = understanding
            ? stageAgentUnderstanding(entry.task, {
              ...output,
              now: now(),
            })
            : stageAgentConversationResult(entry.task, {
              output,
              instruction,
              now: now(),
            });
        } catch {
          throw new AgentModelError(
            502,
            'agent_conversation_output_invalid',
            '模型对话结果格式不符合要求，已有内容仍保留',
          );
        }

        next.provider = model.provider;
        next.simulated = model.provider === 'mock';
        next.businessContext = businessContext;

        // 新结果需重新核对保存，不能把旧草稿当作新结果交接。
        if (next.status === 'result_ready') {
          const savedKey = {
            activity: 'activityDraft',
            writing: 'writingDraft',
            design: 'designDraft',
          }[next.mode];
          delete next[savedKey];
        }

        return save(entry, next);
      } finally {
        busy.delete(options.id);
        releaseCall();
      }
    },

    async proposeDraftRevision(options) {
      const entry = editableTask(options);

      let requestTask;
      try {
        requestTask = prepareAgentDraftRevision(entry.task, {
          fields: options.fields,
          instruction: options.instruction,
        });
      } catch {
        throw failure(
          400,
          'agent_revision_input_invalid',
          '请先保存草稿，并选择有效字段、填写修改要求',
        );
      }

      const releaseCall = callLimiter.acquire(options.actor);
      busy.add(options.id);

      try {
        const result = await model.generate({
          task: requestTask,
          instruction: requestTask.draftRevision.instruction,
        });

        let revision;
        try {
          revision = buildAgentDraftRevision(entry.task, {
            fields: requestTask.draftRevision.fields,
            candidate: result.output?.draft,
          });
        } catch {
          throw new AgentModelError(
            502,
            'agent_model_revision_invalid',
            '模型未返回有效的草稿修改建议，请重新生成',
          );
        }

        const next = structuredClone(entry.task);
        const createdAt = now();

        next.draftRevisionProposal = {
          id: randomUUID(),
          fields: revision.fields,
          baseDraft: revision.baseDraft,
          draft: revision.draft,
          instruction: requestTask.draftRevision.instruction,
          provider: model.provider,
          simulated: model.provider === 'mock',
          createdAt,
        };

        next.provider = model.provider;
        next.simulated = model.provider === 'mock';
        next.updatedAt = createdAt;

        return save(entry, next);
      } finally {
        busy.delete(options.id);
        releaseCall();
      }
    },
    saveDesignDraft(options) {
      const entry = editableTask(options);

      if (entry.task.mode !== 'design') {
        throw failure(400, 'agent_design_mode_required', '只有美编建议任务能保存美编方案');
      }

      const previewStep = entry.task.steps.find(step => step.id === 'preview');
      if (previewStep?.status !== 'confirmed') {
        throw failure(409, 'agent_design_unconfirmed', '请先确认排版预览方案步骤');
      }

      let draft;
      try {
        draft = agentDesignDraft(options.draft);
      } catch {
        throw failure(400, 'agent_design_draft_invalid', '请补齐并核对美编方案后再保存');
      }

      const next = structuredClone(entry.task);
      next.designDraft = draft;
      delete next.draftRevisionProposal;
      next.updatedAt = now();
      return save(entry, next);
    },
    saveWritingDraft(options) {
      const entry = editableTask(options);

      if (entry.task.mode !== 'writing') {
        throw failure(400, 'agent_writing_mode_required', '只有推文创作任务能保存推文草稿');
      }

      const draftStep = entry.task.steps.find(step => step.id === 'draft');
      if (draftStep?.status !== 'confirmed') {
        throw failure(409, 'agent_writing_unconfirmed', '请先确认推文正文草稿步骤');
      }

      let draft;
      try {
        draft = agentWritingDraft(options.draft);
      } catch {
        throw failure(400, 'agent_writing_draft_invalid', '请补齐并核对推文草稿后再保存');
      }

      const next = structuredClone(entry.task);
      next.writingDraft = draft;
      delete next.draftRevisionProposal;
      next.updatedAt = now();
      return save(entry, next);
    },

    saveActivityDraft(options) {
      const entry = editableTask(options);

      if (entry.task.mode !== 'activity') {
        throw failure(400, 'agent_activity_mode_required', '只有活动筹备任务能保存活动配置');
      }

      const configuration = entry.task.steps.find(
        step => step.id === 'configuration',
      );
      if (configuration?.status !== 'confirmed') {
        throw failure(409, 'agent_configuration_unconfirmed', '请先确认活动配置草稿步骤');
      }

      let seed;
      try {
        seed = agentActivitySeed(options.draft);
      } catch {
        throw failure(400, 'agent_activity_draft_invalid', '请补齐并核对活动配置后再保存');
      }

      const next = structuredClone(entry.task);
      next.activityDraft = seed;
      delete next.draftRevisionProposal;
      next.updatedAt = now();
      return save(entry, next);
    },

    remove(options) {
      const entry = editableTask(options);

      if (store) {
        const remaining = [...tasks.values()]
          .filter(item => item.task.id !== entry.task.id)
          .map(item => structuredClone(item));

        store.save(remaining);
      }

      tasks.delete(entry.task.id);
      return { id: entry.task.id };
    },

    list({ actor, permissions }) {
      requireActor(actor);

      return [...tasks.values()]
        .filter(entry =>
          entry.actor === actor &&
          Array.isArray(permissions) &&
          permissions.includes(AGENT_FLOWS[entry.task.mode].scope),
        )
        .map(({ task }) => ({
          id: task.id,
          mode: task.mode,
          brief: task.brief.slice(0, 400),
          status: task.status,
          version: task.version,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          simulated: task.simulated,
        }))
        .sort((left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
          left.id.localeCompare(right.id),
        );
    },

    async generate(options) {
      const entry = editableTask(options);
      const releaseCall = callLimiter.acquire(options.actor);
      busy.add(options.id);
      try {
        const result = await model.generate({
          task: structuredClone(entry.task),
          instruction: options.instruction || '',
        });
        const active = entry.task.steps.find(
          (step) => step.status !== 'confirmed',
        );
        const next = stageAgentResult(entry.task, {
          stepId: active?.id,
          output: result.output,
          now: now(),
        });
        next.provider = model.provider;
        next.simulated = model.provider === 'mock';

        const generatedStep = next.steps.find(
          step => step.id === active.id,
        );
        generatedStep.provider = model.provider;
        generatedStep.simulated = model.provider === 'mock';

        return save(entry, next);
      } finally {
        busy.delete(options.id);
        releaseCall();
      }
    },

    revise(options) {
      const entry = editableTask(options);
      const next = stageAgentResult(entry.task, {
        stepId: options.stepId,
        output: options.output,
        now: now(),
      });
      return save(entry, next);
    },

    confirm(options) {
      const entry = editableTask(options);
      const next = confirmAgentStep(
        entry.task,
        options.stepId,
        now(),
      );
      return save(entry, next);
    },
  };
}