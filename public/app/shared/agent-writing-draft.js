const FIELDS = Object.freeze({
  title: { label: '推文标题', maximum: 100, required: true },
  lead: { label: '开头导语', maximum: 2000, required: false },
  body: { label: '推文正文', maximum: 20000, required: true },
  closing: { label: '结尾与行动提示', maximum: 2000, required: false },
  sourceNotes: { label: '事实来源与待核对事项', maximum: 4000, required: false },
});

export const AGENT_WRITING_FIELDS = FIELDS;

export function emptyAgentWritingDraft() {
  return Object.fromEntries(Object.keys(FIELDS).map(name => [name, '']));
}

export function validateAgentWritingDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('推文草稿格式不正确');
  }

  const draft = emptyAgentWritingDraft();
  const issues = {};

  for (const [name, definition] of Object.entries(FIELDS)) {
    const value = input[name] ?? '';

    if (typeof value !== 'string' || value.length > definition.maximum) {
      issues[name] = `${definition.label}请填写不超过 ${definition.maximum} 字的文字`;
      continue;
    }

    draft[name] = value.replace(/\r\n?/g, '\n').trim();

    if (definition.required && !draft[name]) {
      issues[name] = `请填写${definition.label}`;
    }
  }

  return {
    draft,
    issues,
    valid: Object.keys(issues).length === 0,
  };
}

export function agentWritingDraft(input) {
  const result = validateAgentWritingDraft(input);
  if (!result.valid) throw new Error('请补齐并核对推文草稿');
  return result.draft;
}

export function agentWritingText(input) {
  const draft = agentWritingDraft(input);

  // 内部核对备注不进入对外正文。
  return [draft.title, draft.lead, draft.body, draft.closing]
    .filter(Boolean)
    .join('\n\n');
}