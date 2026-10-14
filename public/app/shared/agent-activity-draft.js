import {
  ACTIVITY_CENTERS,
  serviceDuration,
} from './activity-management.js';

const TEXT_FIELDS = [
  'name',
  'category',
  'center',
  'region',
  'date',
  'startTime',
  'endTime',
  'location',
  'position',
  'content',
  'work',
];

const NUMBER_FIELDS = [
  'capacity',
  'registrationLimit',
  'trainingHours',
  'travelHours',
];

export function emptyAgentActivityDraft() {
  return {
    ...Object.fromEntries(TEXT_FIELDS.map(name => [name, ''])),
    ...Object.fromEntries(NUMBER_FIELDS.map(name => [name, ''])),
    region: '南京活动',
  };
}

export function validateAgentActivityDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('活动配置草稿格式不正确');
  }

  const draft = emptyAgentActivityDraft();
  const issues = {};

  for (const name of TEXT_FIELDS) {
    const value = input[name] ?? '';
    if (typeof value !== 'string' || value.length > 500) {
      issues[name] = '请填写不超过 500 字的文字';
    } else {
      draft[name] = value.trim();
    }
  }

  for (const name of NUMBER_FIELDS) {
    const value = input[name] ?? '';
    if (typeof value !== 'string' && typeof value !== 'number') {
      issues[name] = '请填写有效数字';
      continue;
    }

    if (String(value).trim() === '') continue;

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      issues[name] = '请填写不小于 0 的有效数字';
    } else {
      draft[name] = numeric;
    }
  }

  for (const name of ['name', 'category', 'location', 'content', 'work']) {
    if (!draft[name] && !issues[name]) {
      issues[name] = '此项需要填写';
    }
  }

  if (!['南京活动', '苏州活动'].includes(draft.region)) {
    issues.region = '请选择南京地区或苏州地区';
  }

  if (draft.center && !ACTIVITY_CENTERS.includes(draft.center)) {
    issues.center = '请选择已有活动类别';
  }

  const date = draft.date;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00.000Z`)
    : null;

  if (
    !parsed ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    issues.date = '请填写真实有效的活动日期';
  }

  const duration = serviceDuration(draft.startTime, draft.endTime);
  if (duration === null) {
    issues.startTime = '请选择整点或半点，结束时间须晚于开始时间';
    issues.endTime = issues.startTime;
  }

  for (const name of ['capacity', 'registrationLimit']) {
    if (!Number.isInteger(draft[name]) || draft[name] < 1) {
      issues[name] = '请填写不小于 1 的整数';
    }
  }

  if (
    !issues.capacity &&
    !issues.registrationLimit &&
    draft.registrationLimit < draft.capacity
  ) {
    issues.registrationLimit = '上限名额不能小于推荐录取名额';
  }

  for (const name of ['trainingHours', 'travelHours']) {
    if (draft[name] === '') issues[name] = '没有相关时长时请填写 0';
  }

  return {
    draft,
    issues,
    valid: Object.keys(issues).length === 0,
    serviceHours: duration,
  };
}

export function agentActivitySeed(input) {
  const result = validateAgentActivityDraft(input);
  if (!result.valid) {
    throw new Error('请先补齐并核对活动配置');
  }

  return {
    ...result.draft,
    serviceHours: result.serviceHours,
    slot: `${result.draft.startTime}-${result.draft.endTime}`,
  };
}