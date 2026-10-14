import { h } from '../core/dom.js';
import { field, button } from '../ui/primitives.js';
import { ACTIVITY_CENTERS, HALF_HOURS } from '../shared/activity-management.js';
import {
  emptyAgentActivityDraft,
  validateAgentActivityDraft,
} from '../shared/agent-activity-draft.js';

export function agentActivityEditor({ task, onSave, initialDraft = null }) {
  const seed = task.activityDraft || initialDraft || emptyAgentActivityDraft();
  const controls = new Map();
  const preview = h('div', { class: 'stack-4' });
  const message = h('p', {
    class: 't-secondary',
    attrs: { role: 'status', 'aria-label': '活动配置状态' },
  });
  let previewSnapshot = null;

  function input(name, label, extra = {}) {
    const node = field({
      name: `agent-activity-${name}`,
      label,
      value: seed[name] ?? '',
      maxlength: 500,
      ...extra,
    });
    controls.set(name, node);
    return node;
  }

  const timeOptions = [
    { value: '', label: '请选择时间' },
    ...HALF_HOURS,
  ];

  const fields = h('div', { class: 'agent-config-grid' },
    input('name', '配置：活动名称'),
    input('category', '配置：活动类型 / 专项'),
    input('center', '配置：活动类别', {
      options: [
        { value: '', label: '未分类（待确认）' },
        ...ACTIVITY_CENTERS,
      ],
    }),
    input('region', '配置：地区', {
      options: [
        { value: '', label: '暂未确定' },
        { value: '南京活动', label: '南京地区' },
        { value: '苏州活动', label: '苏州地区' },
      ],
    }),
    input('date', '配置：活动日期', { type: 'date' }),
    input('location', '配置：活动地点'),
    input('startTime', '配置：开始时间', { options: timeOptions }),
    input('endTime', '配置：结束时间', { options: timeOptions }),
    input('capacity', '配置：推荐录取名额', {
      type: 'number', min: 1, step: 1,
    }),
    input('registrationLimit', '配置：上限名额', {
      type: 'number', min: 1, step: 1,
    }),
    input('trainingHours', '配置：培训时长（小时）', {
      type: 'number', min: 0, step: 'any',
    }),
    input('travelHours', '配置：交通时长（小时）', {
      type: 'number', min: 0, step: 'any',
    }),
    input('position', '配置：报名岗位（选填）'),
    input('content', '配置：活动内容', { multiline: true, rows: 4 }),
    input('work', '配置：工作内容', { multiline: true, rows: 4 }),
  );

  function read() {
    return Object.fromEntries(
      [...controls].map(([name, node]) => [name, node.control.value]),
    );
  }

  const original = JSON.stringify(read());

  function validate() {
    const result = validateAgentActivityDraft(read());

    for (const [name, node] of controls) {
      node.setError(result.issues[name] || '');
    }

    if (!result.valid) {
      message.textContent = '请修正标出的字段后再预览。';
      const first = [...controls].find(([name]) => result.issues[name]);
      first?.[1].control.focus();
      return null;
    }

    return result;
  }

  function showPreview() {
    const result = validate();
    previewSnapshot = null;
    preview.replaceChildren();
    if (!result) return;

    const draft = result.draft;
    previewSnapshot = JSON.stringify(read());

    preview.append(
      h('h3', { class: 't-title', text: '活动配置预览' }),
      h('p', { text: draft.name }),
      h('p', {
        text: `${draft.date} ${draft.startTime}—${draft.endTime} · ${draft.location}`,
      }),
      h('p', {
        text: `${draft.region} · ${draft.center || '未分类'} · ${draft.category}`,
      }),
      h('p', {
        text: `推荐录取 ${draft.capacity} 人，上限 ${draft.registrationLimit} 人`,
      }),
      h('p', {
        text: `服务 ${result.serviceHours} 小时；培训 ${draft.trainingHours} 小时；交通 ${draft.travelHours} 小时`,
      }),
      h('p', { text: `岗位：${draft.position || '未填写'}` }),
      h('p', { text: `活动内容：${draft.content}` }),
      h('p', { text: `工作内容：${draft.work}` }),
    );

    message.textContent = '请核对预览，再保存到助手任务。';
  }

  const node = h('section', { class: 'agent-card stack-6' },
    h('h2', { class: 't-h2', text: '活动配置表单' }),
    h('p', {
      class: 't-secondary',
      text: '请填写真实信息。保存仅更新助手任务，负责人、审批和发布仍由活动管理流程处理。',
    }),
    fields,
    message,
    preview,
    h('div', { class: 'row-4 row-wrap' },
      button({
        label: '预览活动配置',
        onClick: showPreview,
      }),
      button({
        label: '保存活动配置',
        variant: 'primary',
        onClick: () => {
          if (
            previewSnapshot === null ||
            previewSnapshot !== JSON.stringify(read())
          ) {
            message.textContent = '请先预览当前配置；修改字段后需要重新预览。';
            return;
          }

          const result = validate();
          if (result) void onSave(result.draft);
        },
      }),
    ),
  );

  return {
    node,
    readDraft: read,
    isDirty: () => JSON.stringify(read()) !== original,
    applyDraft(patch) {
      for (const [name, value] of Object.entries(patch)) {
        const target = controls.get(name);
        if (!target) continue;
        target.control.value = String(value);
        target.setError('');
      }
      previewSnapshot = null;
      preview.replaceChildren();
      message.textContent = '已带入候选内容，请补齐信息、重新预览并保存。';
    },
  };
}