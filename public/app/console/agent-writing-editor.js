import { h } from '../core/dom.js';
import { field, button } from '../ui/primitives.js';
import {
  AGENT_WRITING_FIELDS,
  emptyAgentWritingDraft,
  validateAgentWritingDraft,
  agentWritingText,
} from '../shared/agent-writing-draft.js';

export function agentWritingEditor({ task, onSave, initialDraft = null }) {
  const seed = task.writingDraft || initialDraft || emptyAgentWritingDraft();
  const controls = new Map();
  const preview = h('div', { class: 'agent-writing-preview stack-4' });
  const message = h('p', {
    class: 't-secondary',
    attrs: {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': '推文草稿状态',
    },
  });

  let previewSnapshot = null;
  let copying = false;

  const fields = h('div', { class: 'stack-6' });

  for (const [name, definition] of Object.entries(AGENT_WRITING_FIELDS)) {
    const node = field({
      name: `agent-writing-${name}`,
      label: `推文：${definition.label}`,
      value: seed[name],
      maxlength: definition.maximum,
      multiline: name !== 'title',
      rows: name === 'body' ? 12 : 4,
      hint: name === 'sourceNotes'
        ? '仅用于内部核对，不进入预览正文或复制内容。'
        : '',
    });

    controls.set(name, node);
    fields.append(node);
  }

  function read() {
    return Object.fromEntries(
      [...controls].map(([name, node]) => [name, node.control.value]),
    );
  }

  const original = JSON.stringify(read());
  const isDirty = () => JSON.stringify(read()) !== original;

  function validate() {
    const result = validateAgentWritingDraft(read());

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
    previewSnapshot = null;
    preview.replaceChildren();

    const result = validate();
    if (!result) return;

    previewSnapshot = JSON.stringify(read());

    preview.append(
      h('h3', { class: 't-title', text: '推文正文预览' }),
      h('strong', { text: result.draft.title }),
      ...['lead', 'body', 'closing']
        .filter(name => result.draft[name])
        .map(name => h('p', { text: result.draft[name] })),
    );

    message.textContent = '请核对事实、隐私及素材授权，再保存草稿。';
  }

  async function copySavedDraft() {
    if (copying) return;

    if (isDirty()) {
      message.textContent = '推文有未保存修改，请先预览并保存。';
      return;
    }

    if (!task.writingDraft) {
      message.textContent = '请先保存推文草稿。';
      return;
    }

    copying = true;

    try {
      await navigator.clipboard.writeText(
        agentWritingText(task.writingDraft),
      );
      message.textContent = '已复制正文，不包含内部核对备注。';
    } catch {
      message.textContent = '复制失败，请检查浏览器剪贴板权限；已保存草稿仍保留。';
    } finally {
      copying = false;
    }
  }

  const node = h('section', { class: 'agent-card stack-6' },
    h('h2', { class: 't-h2', text: '推文草稿编辑' }),
    h('p', {
      class: 't-secondary',
      text: '请填写并核对真实内容。模型方案仍需人工审核，保存草稿或复制正文不会自动向外部渠道发布。',
    }),
    fields,
    message,
    preview,
    h('div', { class: 'row-4 row-wrap' },
      button({
        label: '预览推文正文',
        onClick: showPreview,
      }),
      button({
        label: '保存推文草稿',
        variant: 'primary',
        onClick: () => {
          if (
            previewSnapshot === null ||
            previewSnapshot !== JSON.stringify(read())
          ) {
            message.textContent = '请先预览当前正文；修改字段后需要重新预览。';
            return;
          }

          const result = validate();
          if (result) void onSave(result.draft);
        },
      }),
      button({
        label: '复制已保存正文',
        disabled: !task.writingDraft,
        onClick: () => { void copySavedDraft(); },
      }),
    ),
  );

  return {
    node,
    readDraft: read,
    isDirty,
    applyDraft(patch) {
      for (const [name, value] of Object.entries(patch)) {
        const target = controls.get(name);
        if (!target) continue;
        target.control.value = String(value);
        target.setError('');
      }
      previewSnapshot = null;
      preview.replaceChildren();
      message.textContent = '已带入候选内容，请核对、重新预览并保存。';
    },
  };
}