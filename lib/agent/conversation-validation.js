import {
  createAgentConversation,
  stageAgentUnderstanding,
  confirmAgentUnderstanding,
  stageAgentConversationResult,
} from '../../public/app/shared/agent-conversation.js';
import {
  normalizeAgentDraftCandidate,
} from '../../public/app/shared/agent-draft-candidate.js';
import {
  normalizeAgentBusinessContext,
} from './business-context.js';
import { agentActivitySeed } from '../../public/app/shared/agent-activity-draft.js';
import { agentWritingDraft } from '../../public/app/shared/agent-writing-draft.js';
import { agentDesignDraft } from '../../public/app/shared/agent-design-draft.js';

function invalid() {
  throw new Error('对话任务存储格式不正确');
}

function sameDraft(mode, stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    invalid();
  }

  const normalized = normalizeAgentDraftCandidate(mode, stored);
  const keys = Object.keys(normalized).sort();

  if (
    JSON.stringify(Object.keys(stored).sort()) !== JSON.stringify(keys) ||
    keys.some(key => stored[key] !== normalized[key])
  ) {
    invalid();
  }
}

export function validateStoredAgentConversation(task) {
  const savedDrafts = {
    activityDraft: { mode: 'activity', normalize: agentActivitySeed },
    writingDraft: { mode: 'writing', normalize: agentWritingDraft },
    designDraft: { mode: 'design', normalize: agentDesignDraft },
  };

  for (const [key, definition] of Object.entries(savedDrafts)) {
    if (!Object.hasOwn(task, key)) continue;

    if (
      task.mode !== definition.mode ||
      task.status !== 'result_ready'
    ) {
      invalid();
    }

    const stored = task[key];
    const normalized = definition.normalize(stored);
    const keys = Object.keys(normalized).sort();

    if (
      JSON.stringify(Object.keys(stored).sort()) !== JSON.stringify(keys) ||
      keys.some(name => stored[name] !== normalized[name])
    ) {
      invalid();
    }
  }

  if (task.businessContext !== undefined && task.businessContext !== null) {
    normalizeAgentBusinessContext(task.businessContext);
  }
  createAgentConversation({
    id: task.id,
    mode: task.mode,
    brief: task.brief,
    now: task.createdAt,
  });

  if (
    task.taskType !== 'conversation' ||
    ![
      'awaiting_understanding',
      'awaiting_confirmation',
      'ready',
      'result_ready',
    ].includes(task.status) ||
    !Array.isArray(task.messages) ||
    task.messages.length < 1 ||
    task.messages.length > 100
  ) {
    invalid();
  }

  for (const [index, message] of task.messages.entries()) {
    if (
      message.id !== `message-${index + 1}` ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' ||
      !message.content.trim() ||
      message.content.length > 6000 ||
      (
        Object.hasOwn(message, 'kind') &&
        message.kind !== 'understanding'
      )
    ) {
      invalid();
    }
  }

  if (
    task.messages[0].role !== 'user' ||
    task.messages[0].content !== task.brief
  ) {
    invalid();
  }

  const understandingMessages = task.messages.filter(message =>
    message.kind === 'understanding',
  );

  if (task.status === 'awaiting_understanding') {
    if (
      task.understanding !== null ||
      task.confirmedDraft !== null ||
      task.output !== null ||
      task.messages.length !== 1
    ) {
      invalid();
    }
    return;
  }

  if (
    !task.understanding ||
    understandingMessages.length !== 1 ||
    understandingMessages[0].role !== 'assistant' ||
    understandingMessages[0].content !== task.understanding.summary
  ) {
    invalid();
  }

  const initial = createAgentConversation({
    id: task.id,
    mode: task.mode,
    brief: task.brief,
    now: task.createdAt,
  });

  const understood = stageAgentUnderstanding(initial, task.understanding);
  if (understood.understanding.summary !== task.understanding.summary) {
    invalid();
  }
  sameDraft(task.mode, task.understanding.draft);

  if (task.status === 'awaiting_confirmation') {
    if (
      task.confirmedDraft !== null ||
      task.output !== null ||
      task.messages.length !== 2
    ) {
      invalid();
    }
    return;
  }

  sameDraft(task.mode, task.confirmedDraft);
  const ready = confirmAgentUnderstanding(understood, {
    draft: task.confirmedDraft,
  });

  if (task.status === 'ready') {
    if (task.output !== null || task.messages.length !== 2) {
      invalid();
    }
    return;
  }

  if (!task.output) invalid();

  const staged = stageAgentConversationResult(ready, {
    output: task.output,
  });

  if (
    staged.output.title !== task.output.title ||
    staged.output.summary !== task.output.summary
  ) {
    invalid();
  }
  sameDraft(task.mode, task.output.draft);

  // 首次结果为第三条消息；之后每次修改增加一问一答。
  if (task.messages.length < 3 || task.messages.length % 2 !== 1) {
    invalid();
  }

  for (let index = 2; index < task.messages.length; index++) {
    if (
      task.messages[index].role !==
        (index % 2 === 0 ? 'assistant' : 'user') ||
      Object.hasOwn(task.messages[index], 'kind')
    ) {
      invalid();
    }
  }

  if (
    task.messages.at(-1).content !==
      `${task.output.title}\n\n${task.output.summary}`
  ) {
    invalid();
  }
}