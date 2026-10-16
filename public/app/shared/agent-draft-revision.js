import {
  AGENT_DRAFT_STEPS,
  normalizeAgentDraftCandidate,
  assessAgentDraftCandidate,
} from './agent-draft-candidate.js';

export const AGENT_SAVED_DRAFT_KEYS = Object.freeze({
  activity: 'activityDraft',
  writing: 'writingDraft',
  design: 'designDraft',
});

export function validateAgentRevisionFields(mode, fields) {
  const allowed = Object.keys(normalizeAgentDraftCandidate(mode, {}));

  if (
    !Array.isArray(fields) ||
    fields.length === 0 ||
    fields.length > 16 ||
    new Set(fields).size !== fields.length ||
    fields.some(name => typeof name !== 'string' || !allowed.includes(name))
  ) {
    throw new Error('请选择有效且不重复的修改字段');
  }

  return [...fields];
}

export function savedAgentDraft(task) {
  if (!Object.hasOwn(AGENT_SAVED_DRAFT_KEYS, task?.mode)) {
    throw new Error('不支持的草稿类型');
  }

  const step = task.steps?.find(item =>
    item.id === AGENT_DRAFT_STEPS[task.mode],
  );
  const saved = task[AGENT_SAVED_DRAFT_KEYS[task.mode]];

  if (step?.status !== 'confirmed' || !saved) {
    throw new Error('请先确认对应步骤并保存草稿');
  }

  // 活动保存记录含自动计算的时长和时段，修改请求只使用可编辑字段。
  const allowed = Object.keys(normalizeAgentDraftCandidate(task.mode, {}));
  const editable = Object.fromEntries(
    allowed
      .filter(name => Object.hasOwn(saved, name))
      .map(name => [name, saved[name]]),
  );

  return normalizeAgentDraftCandidate(task.mode, editable);
}

export function prepareAgentDraftRevision(task, {
  fields,
  instruction,
}) {
  const selected = validateAgentRevisionFields(task.mode, fields);

  if (
    typeof instruction !== 'string' ||
    !instruction.trim() ||
    instruction.length > 2000
  ) {
    throw new Error('请填写不超过 2000 字的修改要求');
  }

  const base = savedAgentDraft(task);
  const next = structuredClone(task);
  const targetIndex = next.steps.findIndex(step =>
    step.id === AGENT_DRAFT_STEPS[task.mode],
  );

  // 仅用于构造模型请求，不改变原任务进度。
  next.steps[targetIndex].status = 'ready';
  next.steps[targetIndex].output = {
    title: '待修改的已保存草稿',
    summary: '只按用户指定字段提出修改建议，其他字段保持原样。',
    items: ['所有修改都需人工预览和确认。'],
    draft: base,
  };

  for (let index = targetIndex + 1; index < next.steps.length; index++) {
    next.steps[index].status = 'pending';
    next.steps[index].output = null;
  }

  next.status = 'awaiting_confirmation';
  next.draftRevision = {
    fields: selected,
    instruction: instruction.trim(),
  };

  return next;
}

export function buildAgentDraftRevision(task, {
  fields,
  candidate,
}) {
  const selected = validateAgentRevisionFields(task.mode, fields);
  const baseDraft = savedAgentDraft(task);
  const proposed = normalizeAgentDraftCandidate(task.mode, candidate);

  const merged = structuredClone(baseDraft);
  for (const name of selected) {
    merged[name] = proposed[name];
  }

  const assessed = assessAgentDraftCandidate(task.mode, merged);

  return {
    fields: selected,
    baseDraft,
    draft: assessed.draft,
    complete: assessed.complete,
    issues: assessed.issues,
    changes: selected
      .filter(name =>
        String(baseDraft[name]) !== String(assessed.draft[name]),
      )
      .map(name => ({
        name,
        before: baseDraft[name],
        after: assessed.draft[name],
      })),
  };
}

export function validateAgentDraftRevisionProposal(task, proposal) {
  const expectedKeys = [
    'baseDraft',
    'createdAt',
    'draft',
    'fields',
    'id',
    'instruction',
    'provider',
    'simulated',
  ];

  if (
    !proposal ||
    typeof proposal !== 'object' ||
    Array.isArray(proposal) ||
    JSON.stringify(Object.keys(proposal).sort()) !==
      JSON.stringify(expectedKeys) ||
    typeof proposal.id !== 'string' ||
    !proposal.id.trim() ||
    proposal.id.length > 120 ||
    typeof proposal.instruction !== 'string' ||
    !proposal.instruction.trim() ||
    proposal.instruction !== proposal.instruction.trim() ||
    proposal.instruction.length > 2000 ||
    typeof proposal.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(proposal.createdAt)) ||
    !['mock', 'deepseek', 'compatible'].includes(proposal.provider) ||
    proposal.simulated !== (proposal.provider === 'mock')
  ) {
    throw new Error('草稿修改提案格式不正确');
  }

  const expected = buildAgentDraftRevision(task, {
    fields: proposal.fields,
    candidate: proposal.draft,
  });

  function equalFields(actual, normalized) {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
      return false;
    }

    const keys = Object.keys(normalized).sort();
    return JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(keys)
      && keys.every(name => actual[name] === normalized[name]);
  }

  if (
    !equalFields(proposal.baseDraft, expected.baseDraft) ||
    !equalFields(proposal.draft, expected.draft)
  ) {
    throw new Error('修改提案与当前已保存草稿不一致');
  }

  return structuredClone(proposal);
}