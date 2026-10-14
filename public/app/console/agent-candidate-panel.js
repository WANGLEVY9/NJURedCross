import { h } from '../core/dom.js';
import { button } from '../ui/primitives.js';
import { confirmAction } from '../ui/overlay.js';
import {
  AGENT_DRAFT_STEPS,
  assessAgentDraftCandidate,
} from '../shared/agent-draft-candidate.js';
import { AGENT_WRITING_FIELDS } from '../shared/agent-writing-draft.js';
import { AGENT_DESIGN_FIELDS } from '../shared/agent-design-draft.js';

const ACTIVITY_LABELS = {
  name: '活动名称',
  category: '活动类型',
  center: '活动类别',
  region: '地区',
  date: '活动日期',
  startTime: '开始时间',
  endTime: '结束时间',
  location: '地点',
  position: '岗位',
  capacity: '推荐录取名额',
  registrationLimit: '上限名额',
  trainingHours: '培训时长',
  travelHours: '交通时长',
  content: '活动内容',
  work: '工作内容',
};

function fieldLabel(mode, name) {
  if (mode === 'activity') return ACTIVITY_LABELS[name] || name;
  if (mode === 'writing') return AGENT_WRITING_FIELDS[name]?.label || name;
  if (name === 'palette') return '配色方案';
  if (name === 'layout') return '版式方案';
  return AGENT_DESIGN_FIELDS[name]?.label || name;
}

function displayValue(name, value) {
  if (value === '' || value === null || value === undefined) return '未填写';

  if (name === 'palette') {
    return { rose: '柔和玫瑰', green: '沉稳青绿', blue: '清爽蓝灰' }[value] || String(value);
  }
  if (name === 'layout') {
    return { editorial: '图文阅读', announcement: '活动通知' }[value] || String(value);
  }

  return String(value);
}

export function createDraftCandidatePanel({
  task,
  editor,
  isBusy,
  isActive,
}) {
  const step = task.steps.find(item =>
    item.id === AGENT_DRAFT_STEPS[task.mode],
  );
  if (step?.status !== 'confirmed' || !step.output?.draft) return null;

  const candidate = assessAgentDraftCandidate(task.mode, step.output.draft);
  const supplied = Object.entries(candidate.draft)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined);

  const message = h('p', {
    class: 't-secondary',
    attrs: {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': '候选草稿状态',
    },
  });
  let confirming = false;

  async function adopt() {
    if (confirming || isBusy() || !isActive()) return;

    const current = editor.readDraft();
    const changes = supplied.filter(([name, value]) =>
      String(current[name] ?? '') !== String(value),
    );

    if (!changes.length) {
      message.textContent = '候选内容与编辑器相同，没有需要带入的变化。';
      return;
    }

    confirming = true;
    try {
      const snapshot = JSON.stringify(current);

      const accepted = await confirmAction({
        title: '将候选内容带入编辑器？',
        description: '下列字段会改变，空字段和其他内容保持原样。带入后仍需预览并保存。',
        confirmLabel: '确认带入',
        cancelLabel: '取消',
        details: changes.map(([name, value]) =>
          h('div', { class: 'agent-candidate-change stack-2' },
            h('strong', { text: fieldLabel(task.mode, name) }),
            h('p', { text: `当前：${displayValue(name, current[name])}` }),
            h('p', { text: `候选：${displayValue(name, value)}` }),
          ),
        ),
      });

      if (!accepted || !isActive() || isBusy()) return;

      if (JSON.stringify(editor.readDraft()) !== snapshot) {
        message.textContent = '编辑内容已变化，请重新核对候选。';
        return;
      }

      editor.applyDraft(Object.fromEntries(changes));
      message.textContent = '已带入编辑器，尚未保存。';
    } finally {
      confirming = false;
    }
  }

  const missing = Object.keys(candidate.issues)
    .map(name => fieldLabel(task.mode, name));

  return h('section', { class: 'agent-card stack-6' },
    h('h2', { class: 't-h2', text: '候选草稿' }),
    h('p', {
      class: 't-secondary',
      text: (step.provider || task.provider) === 'mock'
        ? '来源：模拟模板。候选只作演示，请核对并补充真实信息。'
        : '来源：模型建议。候选内容未经人工核对。',
    }),
    h('p', {
      class: 't-secondary',
      text: missing.length
        ? `仍需补齐或修正：${missing.join('、')}。`
        : '字段格式完整，事实及素材授权仍需人工核对。',
    }),
    h('details', { class: 'agent-history' },
      h('summary', { text: '查看候选内容' }),
      h('div', { class: 'agent-candidate-content stack-4' },
        ...supplied.map(([name, value]) =>
          h('div', { class: 'stack-2' },
            h('strong', { text: fieldLabel(task.mode, name) }),
            h('p', { text: displayValue(name, value) }),
          ),
        ),
      ),
    ),
    message,
    button({
      label: '预览并带入候选',
      onClick: () => { void adopt(); },
    }),
  );
}
export { fieldLabel as agentDraftFieldLabel };