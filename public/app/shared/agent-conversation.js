import { AGENT_FLOWS } from './agent-workflow.js';
import {
  normalizeAgentDraftCandidate,
} from './agent-draft-candidate.js';

function text(value, label, maximum) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum
  ) {
    throw new Error(`${label}为空或超过长度限制`);
  }
  return value.trim();
}

function requireConversation(task, statuses) {
  if (
    task?.taskType !== 'conversation' ||
    !Object.hasOwn(AGENT_FLOWS, task.mode) ||
    !Array.isArray(task.messages) ||
    !statuses.includes(task.status)
  ) {
    throw new Error('当前对话状态不允许此操作');
  }
}

function appendMessage(task, role, content) {
  if (task.messages.length >= 100) {
    throw new Error('当前对话已达到长度上限，请另开任务');
  }

  task.messages.push({
    id: `message-${task.messages.length + 1}`,
    role,
    content,
  });
}

function outputContent(output) {
  if (
    !Array.isArray(output?.items) ||
    output.items.length > 40 ||
    output.items.some(item =>
      typeof item !== 'string' || item.length > 4000)
  ) {
    throw new Error('方案内容格式不正确');
  }

  return {
    title: text(output.title, '方案标题', 200),
    summary: text(output.summary, '方案说明', 4000),
    items: [...output.items],
  };
}

export function createAgentConversation({
  id,
  mode,
  brief,
  now = new Date().toISOString(),
}) {
  if (!Object.hasOwn(AGENT_FLOWS, mode)) {
    throw new Error('不支持的工作模式');
  }

  const requirement = text(brief, '任务需求', 4000);

  return {
    taskType: 'conversation',
    id: text(id, '任务编号', 120),
    mode,
    brief: requirement,
    status: 'awaiting_understanding',
    createdAt: now,
    updatedAt: now,
    messages: [{
      id: 'message-1',
      role: 'user',
      content: requirement,
    }],
    understanding: null,
    confirmedDraft: null,
    output: null,
  };
}

export function stageAgentUnderstanding(
  task,
  { summary, draft = {}, now = new Date().toISOString() },
) {
  requireConversation(task, [
    'awaiting_understanding',
    'awaiting_confirmation',
  ]);

  const next = structuredClone(task);
  next.understanding = {
    summary: text(summary, '需求理解', 2000),
    draft: normalizeAgentDraftCandidate(task.mode, draft),
  };
  next.status = 'awaiting_confirmation';
  next.updatedAt = now;

  // 确认前修正理解时，更新同一张卡片对应的消息。
  const existing = next.messages.find(message =>
    message.kind === 'understanding',
  );

  if (existing) {
    existing.content = next.understanding.summary;
  } else {
    appendMessage(next, 'assistant', next.understanding.summary);
    next.messages.at(-1).kind = 'understanding';
  }

  return next;
}

export function confirmAgentUnderstanding(
  task,
  { draft = {}, now = new Date().toISOString() } = {},
) {
  requireConversation(task, ['awaiting_confirmation']);

  if (!task.understanding) {
    throw new Error('请先生成需求理解');
  }

  const next = structuredClone(task);

  // 允许集中补充字段，也允许未知字段继续留空。
  next.confirmedDraft = normalizeAgentDraftCandidate(task.mode, {
    ...task.understanding.draft,
    ...draft,
  });
  next.status = 'ready';
  next.updatedAt = now;
  return next;
}

export function stageAgentConversationResult(
  task,
  {
    output,
    instruction = '',
    now = new Date().toISOString(),
  },
) {
  requireConversation(task, ['ready', 'result_ready']);

  const revision = task.status === 'result_ready';
  const request = revision
    ? text(instruction, '修改要求', 2000)
    : '';

  if (!revision && instruction !== '') {
    throw new Error('首次生成不接受修改要求');
  }

  const result = {
    ...outputContent(output),
    draft: normalizeAgentDraftCandidate(task.mode, output.draft),
  };

  if (!Object.hasOwn(output, 'draft')) {
    throw new Error('完整方案必须包含候选草稿');
  }

  const next = structuredClone(task);

  if (revision) {
    appendMessage(next, 'user', request);
  }

  next.output = result;
  appendMessage(
    next,
    'assistant',
    `${result.title}\n\n${result.summary}`,
  );
  next.status = 'result_ready';
  next.updatedAt = now;

  return next;
}