export const AGENT_DESIGN_FIELDS = Object.freeze({
  title: { label: '方案标题', maximum: 100, required: true },
  audience: { label: '目标读者', maximum: 500, required: true },
  headline: { label: '预览主标题', maximum: 100, required: true },
  introduction: { label: '预览导语', maximum: 2000, required: false },
  body: { label: '预览正文', maximum: 10000, required: true },
  footer: { label: '预览页尾', maximum: 1000, required: false },
  imageNotes: { label: '配图与素材建议', maximum: 4000, required: false },
  reviewNotes: { label: '内部核对事项', maximum: 4000, required: false },
});

export const AGENT_DESIGN_PALETTES = Object.freeze([
  Object.freeze({ value: 'rose', label: '柔和玫瑰' }),
  Object.freeze({ value: 'green', label: '沉稳青绿' }),
  Object.freeze({ value: 'blue', label: '清爽蓝灰' }),
]);

export const AGENT_DESIGN_LAYOUTS = Object.freeze([
  Object.freeze({ value: 'editorial', label: '图文阅读' }),
  Object.freeze({ value: 'announcement', label: '活动通知' }),
]);

export function emptyAgentDesignDraft() {
  return {
    ...Object.fromEntries(
      Object.keys(AGENT_DESIGN_FIELDS).map(name => [name, '']),
    ),
    palette: 'rose',
    layout: 'editorial',
  };
}

export function validateAgentDesignDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('美编方案格式不正确');
  }

  const draft = emptyAgentDesignDraft();
  const issues = {};

  for (const [name, definition] of Object.entries(AGENT_DESIGN_FIELDS)) {
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

  for (const [name, choices] of [
    ['palette', AGENT_DESIGN_PALETTES],
    ['layout', AGENT_DESIGN_LAYOUTS],
  ]) {
    const value = input[name] ?? draft[name];
    if (!choices.some(choice => choice.value === value)) {
      issues[name] = '请选择已有选项';
    } else {
      draft[name] = value;
    }
  }

  return {
    draft,
    issues,
    valid: Object.keys(issues).length === 0,
  };
}

export function agentDesignDraft(input) {
  const result = validateAgentDesignDraft(input);
  if (!result.valid) throw new Error('请补齐并核对美编方案');
  return result.draft;
}