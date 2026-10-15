import {
  emptyAgentActivityDraft,
  validateAgentActivityDraft,
} from './agent-activity-draft.js';
import {
  AGENT_WRITING_FIELDS,
  emptyAgentWritingDraft,
  validateAgentWritingDraft,
} from './agent-writing-draft.js';
import {
  AGENT_DESIGN_FIELDS,
  AGENT_DESIGN_PALETTES,
  AGENT_DESIGN_LAYOUTS,
  emptyAgentDesignDraft,
  validateAgentDesignDraft,
} from './agent-design-draft.js';
import { ACTIVITY_CENTERS, HALF_HOURS } from './activity-management.js';

export const AGENT_DRAFT_STEPS = Object.freeze({
  activity: 'configuration',
  writing: 'draft',
  design: 'preview',
});

const ACTIVITY_NUMBERS = new Set([
  'capacity',
  'registrationLimit',
  'trainingHours',
  'travelHours',
]);

function configuration(mode) {
  if (mode === 'activity') {
    const empty = emptyAgentActivityDraft();
    // 地区是事实信息，候选方案缺失时不替用户推断。
    empty.region = '';

    return {
      empty,
      fields: Object.fromEntries(Object.keys(empty).map(name => [
        name,
        {
          maximum: 500,
          numeric: ACTIVITY_NUMBERS.has(name),
        },
      ])),
      validate: validateAgentActivityDraft,
    };
  }

  if (mode === 'writing') {
    return {
      empty: emptyAgentWritingDraft(),
      fields: AGENT_WRITING_FIELDS,
      validate: validateAgentWritingDraft,
    };
  }

  if (mode === 'design') {
    return {
      empty: emptyAgentDesignDraft(),
      fields: {
        ...AGENT_DESIGN_FIELDS,
        palette: { maximum: 40 },
        layout: { maximum: 40 },
      },
      validate: validateAgentDesignDraft,
    };
  }

  throw new Error('不支持的候选草稿类型');
}

export function normalizeAgentDraftCandidate(mode, input) {
  const config = configuration(mode);

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('候选草稿格式不正确');
  }

  for (const name of Object.keys(input)) {
    if (!Object.hasOwn(config.fields, name)) {
      throw new Error('候选草稿包含不支持的字段');
    }
  }

  const draft = structuredClone(config.empty);

  for (const [name, definition] of Object.entries(config.fields)) {
    if (!Object.hasOwn(input, name)) continue;
    const value = input[name];

    if (value === null || value === undefined) {
      draft[name] = '';
      continue;
    }

    if (definition.numeric) {
      if (
        typeof value !== 'number' &&
        typeof value !== 'string'
      ) {
        throw new Error('候选草稿数字格式不正确');
      }

      if (String(value).trim() === '') {
        draft[name] = '';
        continue;
      }

      if (
        typeof value === 'string' &&
        !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())
      ) {
        throw new Error('候选草稿数字格式不正确');
      }

      const numeric = Number(value);
      if (
        !Number.isFinite(numeric) ||
        numeric < 0 ||
        (
          ['capacity', 'registrationLimit'].includes(name) &&
          (!Number.isInteger(numeric) || numeric < 1)
        )
      ) {
        throw new Error('候选草稿数字范围不正确');
      }

      draft[name] = numeric;
    } else {
      if (
        typeof value !== 'string' ||
        value.length > definition.maximum
      ) {
        throw new Error('候选草稿文字格式不正确或过长');
      }

      draft[name] = value.replace(/\r\n?/g, '\n').trim();
    }
  }

  if (mode === 'activity') {
    if (draft.region && !['南京活动', '苏州活动'].includes(draft.region)) {
      throw new Error('候选地区不受支持');
    }
    if (draft.center && !ACTIVITY_CENTERS.includes(draft.center)) {
      throw new Error('候选活动类别不受支持');
    }
    for (const name of ['startTime', 'endTime']) {
      if (draft[name] && !HALF_HOURS.includes(draft[name])) {
        throw new Error('候选时段不受支持');
      }
    }
  }

  if (mode === 'design') {
    for (const [name, choices] of [
      ['palette', AGENT_DESIGN_PALETTES],
      ['layout', AGENT_DESIGN_LAYOUTS],
    ]) {
      if (draft[name] && !choices.some(choice => choice.value === draft[name])) {
        throw new Error('候选美编选项不受支持');
      }
    }
  }

  return draft;
}

export function assessAgentDraftCandidate(mode, input) {
  const draft = normalizeAgentDraftCandidate(mode, input);
  const result = configuration(mode).validate(draft);

  return {
    draft,
    complete: result.valid,
    issues: result.issues,
  };
}