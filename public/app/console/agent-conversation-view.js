import { h } from '../core/dom.js';
import { button, field } from '../ui/primitives.js';
import {
  normalizeAgentDraftCandidate,
} from '../shared/agent-draft-candidate.js';
import {
  agentDraftFieldLabel,
} from './agent-candidate-panel.js';

const PRIMARY_FIELDS = {
  activity: [
    'name', 'capacity', 'date', 'startTime', 'endTime', 'location',
  ],
  writing: ['title', 'lead', 'body'],
  design: ['headline', 'audience', 'body'],
};

const NUMERIC_FIELDS = new Set([
  'capacity',
  'registrationLimit',
  'trainingHours',
  'travelHours',
]);

const MULTILINE_FIELDS = new Set([
  'content', 'work', 'lead', 'body', 'closing',
  'sourceNotes', 'introduction', 'footer', 'imageNotes', 'reviewNotes',
]);

export function agentConversationView({
  task,
  onConfirm,
  onGenerate,
  isBusy = () => false,
}) {
  let pending = false;
  const controls = new Map();
  let initialSnapshot = null;

  const message = h('p', {
    class: 't-secondary',
    attrs: {
      role: 'status',
      'aria-label': '对话操作状态',
      'aria-live': 'polite',
    },
  });

  const node = h('section', {
    class: 'agent-card agent-conversation stack-6',
    attrs: { 'aria-label': '工作助手对话' },
  });

  function readDraft() {
    return Object.fromEntries(
      [...controls].map(([name, item]) => [
        name,
        item.control.value,
      ]),
    );
  }

  function isDirty() {
    return initialSnapshot !== null &&
      JSON.stringify(readDraft()) !== initialSnapshot;
  }

  async function run(action) {
    if (pending || isBusy()) return;
    pending = true;
    node.inert = true;
    message.textContent = '正在处理…';

    try {
      await action();
      message.textContent = '';
    } catch (error) {
      message.textContent = error.message || '处理失败，输入内容仍保留。';
    } finally {
      pending = false;
      node.inert = false;
    }
  }

  const transcript = h('div', {
    class: 'agent-conversation__messages stack-4',
    attrs: { role: 'log', 'aria-label': '对话记录' },
  });

  for (const item of task.messages) {
    transcript.append(
      h('article', {
        class: [
          'agent-conversation__message',
          item.role === 'user'
            ? 'agent-conversation__message--user'
            : 'agent-conversation__message--assistant',
        ],
      },
        h('strong', {
          text: item.role === 'user' ? '你' : '工作助手',
        }),
        h('p', {
          class: 'agent-conversation__text',
          text: item.content,
        }),
      ),
    );
  }

  node.append(transcript);

  if (task.businessContext) {
    const context = task.businessContext;

    node.append(
      h('details', { class: 'agent-history' },
        h('summary', {
          text: `系统参考信息 · ${context.items.length} 条匹配记录`,
        }),
        h('div', { class: 'stack-4' },
          h('p', {
            class: 't-secondary',
            text: `读取于 ${new Date(context.checkedAt).toLocaleString('zh-CN')}`,
          }),
          ...context.items.map(item => h('article', {
            class: 'agent-history stack-4',
          },
            h('strong', { text: item.title }),
            h('p', { text: item.detail }),
            h('p', {
              class: 't-secondary',
              text: `来源：${item.source}`,
            }),
          )),
          context.items.length === 0
            ? h('p', { text: '本次没有匹配到可展示的记录。' })
            : null,
          context.unavailable.length
            ? h('p', {
              text: `部分来源读取失败：${context.unavailable.join('、')}`,
            })
            : null,
          context.truncated
            ? h('p', { text: '当前查询覆盖不完整。' })
            : null,
          h('p', { class: 't-secondary', text: context.note }),
        ),
      ),
    );
  }

  if (task.status === 'awaiting_confirmation') {
    const seed = normalizeAgentDraftCandidate(
      task.mode,
      task.understanding.draft,
    );
    const primary = h('div', { class: 'agent-config-grid' });
    const additional = h('div', { class: 'agent-config-grid' });

    for (const name of Object.keys(seed)) {
      const extra = {};

      if (NUMERIC_FIELDS.has(name)) {
        extra.type = 'number';
        extra.min = ['capacity', 'registrationLimit'].includes(name) ? 1 : 0;
        extra.step = ['capacity', 'registrationLimit'].includes(name)
          ? 1
          : 'any';
      } else if (name === 'date') {
        extra.type = 'date';
      } else if (MULTILINE_FIELDS.has(name)) {
        extra.multiline = true;
        extra.rows = 3;
      }

      if (name === 'region') {
        extra.options = [
          { value: '', label: '暂未确定' },
          { value: '南京活动', label: '南京活动' },
          { value: '苏州活动', label: '苏州活动' },
        ];
      }

      if (name === 'palette') {
        extra.options = [
          { value: 'rose', label: '柔和玫瑰' },
          { value: 'green', label: '沉稳青绿' },
          { value: 'blue', label: '清爽蓝灰' },
        ];
      }

      if (name === 'layout') {
        extra.options = [
          { value: 'editorial', label: '图文阅读' },
          { value: 'announcement', label: '活动通知' },
        ];
      }

      const item = field({
        name: `agent-confirm-${name}`,
        label: `需求：${agentDraftFieldLabel(task.mode, name)}`,
        value: seed[name] ?? '',
        ...extra,
      });

      controls.set(name, item);
      (PRIMARY_FIELDS[task.mode].includes(name)
        ? primary
        : additional).append(item);
    }

    initialSnapshot = JSON.stringify(readDraft());

    node.append(
      h('section', { class: 'agent-understanding stack-4' },
        h('h2', { class: 't-h2', text: '确认需求' }),
        h('p', {
          class: 't-secondary',
          text: '理解正确即可确认；需要修正的字段集中填写，未知信息可以留空。',
        }),
        primary,
        h('details', {},
          h('summary', { text: '补充其他字段（可暂时留空）' }),
          additional,
        ),
        button({
          label: '确认并生成',
          variant: 'primary',
          onClick: () => {
            void run(() => onConfirm(readDraft()));
          },
        }),
      ),
    );
  }

  if (task.status === 'awaiting_understanding') {
    node.append(button({
      label: '生成需求理解',
      variant: 'primary',
      onClick: () => { void run(() => onGenerate()); },
    }));
  }

  if (task.status === 'ready') {
    node.append(
      h('p', { text: '需求已确认，可以直接生成完整方案。' }),
      button({
        label: '生成完整方案',
        variant: 'primary',
        onClick: () => { void run(() => onGenerate()); },
      }),
    );
  }

  if (task.output) {
    node.append(
      h('section', { class: 'agent-conversation__result stack-4' },
        h('h2', { class: 't-h2', text: task.output.title }),
        h('p', {
          class: 'agent-conversation__text',
          text: task.output.summary,
        }),
        ...task.output.items.map(item => h('p', {
          class: 'agent-conversation__text',
          text: item,
        })),
        h('details', {},
          h('summary', { text: '查看生成的草稿字段' }),
          h('dl', { class: 'agent-conversation__draft' },
            ...Object.entries(task.output.draft).flatMap(([name, value]) => [
              h('dt', {
                text: agentDraftFieldLabel(task.mode, name),
              }),
              h('dd', {
                class: 'agent-conversation__text',
                text: String(value ?? '') || '暂未填写',
              }),
            ]),
          ),
        ),
        h('p', {
          class: 't-secondary',
          text: '继续在下方输入修改意见即可，无需重新确认需求。',
        }),
      ),
    );
  }

  node.append(message);
  return { node, isDirty };
}