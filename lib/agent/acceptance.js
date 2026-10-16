import {
  createAgentTask,
  getActiveAgentStep,
  stageAgentResult,
  confirmAgentStep,
} from '../../public/app/shared/agent-workflow.js';
import {
  AGENT_DRAFT_STEPS,
} from '../../public/app/shared/agent-draft-candidate.js';
import {
  AGENT_SAVED_DRAFT_KEYS,
  prepareAgentDraftRevision,
} from '../../public/app/shared/agent-draft-revision.js';
import {
  agentActivitySeed,
} from '../../public/app/shared/agent-activity-draft.js';
import {
  agentWritingDraft,
} from '../../public/app/shared/agent-writing-draft.js';
import {
  agentDesignDraft,
} from '../../public/app/shared/agent-design-draft.js';

const normalizers = {
  activity: agentActivitySeed,
  writing: agentWritingDraft,
  design: agentDesignDraft,
};

export function prepareAgentAcceptanceCase(definition) {
  if (
    definition?.synthetic !== true ||
    !Object.hasOwn(normalizers, definition.mode) ||
    !['complete', 'missing', 'revision'].includes(definition.kind)
  ) {
    throw new Error('只允许受支持的合成验收案例');
  }

  let task = createAgentTask({
    id: `acceptance-${definition.id}`,
    mode: definition.mode,
    brief: definition.brief,
  });

  const target = AGENT_DRAFT_STEPS[definition.mode];
  const preparation = {
    title: '合成验收准备',
    summary: '此上下文仅用于构造验收请求，不代表真实业务操作。',
    items: ['所有事实以案例需求中明确提供的信息为准。'],
  };

  while (getActiveAgentStep(task).id !== target) {
    const stepId = getActiveAgentStep(task).id;

    task = stageAgentResult(task, {
      stepId,
      output: preparation,
    });
    task = confirmAgentStep(task, stepId);
  }

  if (definition.kind !== 'revision') {
    return {
      task,
      baseTask: null,
      instruction: '',
    };
  }

  task = stageAgentResult(task, {
    stepId: target,
    output: preparation,
  });
  task = confirmAgentStep(task, target);

  task[AGENT_SAVED_DRAFT_KEYS[definition.mode]] =
    normalizers[definition.mode](definition.currentDraft);

  const requestTask = prepareAgentDraftRevision(task, {
    fields: definition.fields,
    instruction: definition.instruction,
  });

  return {
    task: requestTask,
    baseTask: task,
    instruction: requestTask.draftRevision.instruction,
  };
}