import {
  AGENT_DRAFT_STEPS,
  normalizeAgentDraftCandidate,
} from './agent-draft-candidate.js';

export const AGENT_FLOWS = Object.freeze({
  activity: Object.freeze({
    label: '活动筹备',
    scope: 'events',
    steps: Object.freeze([
      { id: 'brief', label: '明确活动需求' },
      { id: 'plan', label: '策划与分工' },
      { id: 'resources', label: '物资与准备事项' },
      { id: 'configuration', label: '活动配置草稿' },
      { id: 'review', label: '筹备方案核对' },
    ]),
  }),
  writing: Object.freeze({
    label: '推文创作',
    scope: 'outreach',
    steps: Object.freeze([
      { id: 'brief', label: '明确宣传需求' },
      { id: 'outline', label: '标题与提纲' },
      { id: 'draft', label: '推文正文草稿' },
      { id: 'review', label: '事实与文案核对' },
    ]),
  }),
  design: Object.freeze({
    label: '美编建议',
    scope: 'outreach',
    steps: Object.freeze([
      { id: 'brief', label: '明确视觉需求' },
      { id: 'layout', label: '配色与版式方案' },
      { id: 'preview', label: '排版预览方案' },
      { id: 'review', label: '阅读体验核对' },
    ]),
  }),
});

function requiredText(value, label, maximum) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum
  ) {
    throw new Error(`${label}为空或超过长度限制`);
  }
  return value.trim();
}

function validateTask(task) {
  const flow = AGENT_FLOWS[task?.mode];
  if (
    !flow ||
    !Array.isArray(task.steps) ||
    task.steps.length !== flow.steps.length ||
    task.steps.some((step, index) =>
      step.id !== flow.steps[index].id ||
      !['pending', 'ready', 'confirmed'].includes(step.status))
  ) {
    throw new Error('任务流程格式不正确');
  }
  return flow;
}

export function createAgentTask({
  id,
  mode,
  brief,
  now = new Date().toISOString(),
}) {
  const flow = AGENT_FLOWS[mode];
  if (!flow) throw new Error('不支持的工作模式');

  return {
    id: requiredText(id, '任务编号', 120),
    mode,
    brief: requiredText(brief, '任务需求', 4000),
    status: 'awaiting_input',
    createdAt: now,
    updatedAt: now,
    steps: flow.steps.map((step) => ({
      id: step.id,
      label: step.label,
      status: 'pending',
      output: null,
    })),
  };
}

export function getActiveAgentStep(task) {
  validateTask(task);
  return task.steps.find((step) => step.status !== 'confirmed') || null;
}

export function stageAgentResult(
  task,
  { stepId, output, now = new Date().toISOString() },
) {
  const active = getActiveAgentStep(task);
  if (!active || active.id !== stepId) {
    throw new Error('只能生成当前步骤的结果');
  }

  if (
    !Array.isArray(output?.items) ||
    output.items.length > 40 ||
    output.items.some((item) =>
      typeof item !== 'string' || item.length > 4000)
  ) {
    throw new Error('步骤结果格式不正确');
  }

  const result = {
    title: requiredText(output.title, '结果标题', 200),
    summary: requiredText(output.summary, '结果说明', 4000),
    items: [...output.items],
  };

  if (Object.hasOwn(output, 'draft')) {
    if (active.id !== AGENT_DRAFT_STEPS[task.mode]) {
      throw new Error('当前步骤不能提供候选草稿');
    }

    result.draft = normalizeAgentDraftCandidate(task.mode, output.draft);
  }

  const next = structuredClone(task);

  const step = next.steps.find((item) => item.id === stepId);
  step.status = 'ready';
  step.output = result;
  next.status = 'awaiting_confirmation';
  next.updatedAt = now;
  return next;
}

export function confirmAgentStep(
  task,
  stepId,
  now = new Date().toISOString(),
) {
  const active = getActiveAgentStep(task);
  if (!active || active.id !== stepId || active.status !== 'ready') {
    throw new Error('当前步骤尚无可确认的结果');
  }

  const next = structuredClone(task);
  next.steps.find((step) => step.id === stepId).status = 'confirmed';
  next.status = next.steps.every((step) => step.status === 'confirmed')
    ? 'draft_ready'
    : 'awaiting_input';
  next.updatedAt = now;
  return next;
}
