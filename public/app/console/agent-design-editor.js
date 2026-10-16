import { h } from '../core/dom.js';
import { field, button } from '../ui/primitives.js';
import {
  AGENT_DESIGN_FIELDS,
  AGENT_DESIGN_PALETTES,
  AGENT_DESIGN_LAYOUTS,
  emptyAgentDesignDraft,
  validateAgentDesignDraft,
} from '../shared/agent-design-draft.js';

export function agentDesignEditor({ task, onSave, initialDraft = null }) {
  const seed = task.designDraft || initialDraft || emptyAgentDesignDraft();
  const controls = new Map();
  const fields = h('div', { class: 'stack-6' });
  const preview = h('article', {
    class: 'agent-design-preview',
    attrs: { 'aria-label': '美编版式预览' },
  });

  const message = h('p', {
    class: 't-secondary',
    attrs: {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': '美编方案状态',
    },
  });

  let previewSnapshot = null;

  function addField(name, label, extra = {}) {
    const node = field({
      name: `agent-design-${name}`,
      label,
      value: seed[name],
      ...extra,
    });
    controls.set(name, node);
    fields.append(node);
  }

  addField('palette', '美编：配色方案', {
    options: AGENT_DESIGN_PALETTES,
  });

  addField('layout', '美编：版式方案', {
    options: AGENT_DESIGN_LAYOUTS,
  });

  for (const [name, definition] of Object.entries(AGENT_DESIGN_FIELDS)) {
    addField(name, `美编：${definition.label}`, {
      maxlength: definition.maximum,
      multiline: !['title', 'audience', 'headline'].includes(name),
      rows: name === 'body' ? 8 : 3,
      hint: ['imageNotes', 'reviewNotes'].includes(name)
        ? '保存在方案中，不进入对外版式预览。'
        : '',
    });
  }

  function read() {
    return Object.fromEntries(
      [...controls].map(([name, node]) => [name, node.control.value]),
    );
  }

  const original = JSON.stringify(read());

  function showPlaceholder() {
    preview.removeAttribute('data-palette');
    preview.removeAttribute('data-layout');
    preview.replaceChildren(
      h('p', {
        class: 'agent-design-placeholder',
        text: '填写内容后点击“预览美编方案”。',
      }),
    );
  }

  function validate() {
    const result = validateAgentDesignDraft(read());

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
    showPlaceholder();

    const result = validate();
    if (!result) return;

    const draft = result.draft;
    previewSnapshot = JSON.stringify(read());
    preview.dataset.palette = draft.palette;
    preview.dataset.layout = draft.layout;

    preview.replaceChildren(
      h('header', { class: 'agent-design-cover' },
        h('p', { class: 'agent-design-kicker', text: '图文版式示意' }),
        h('h3', { text: draft.headline }),
        draft.introduction
          ? h('p', { text: draft.introduction })
          : null,
      ),
      h('div', {
        class: 'agent-design-image-placeholder',
        text: '配图位置示意 · 请另行选择已获授权的素材',
      }),
      h('div', { class: 'agent-design-body' },
        h('p', { text: draft.body }),
      ),
      draft.footer
        ? h('footer', { class: 'agent-design-footer' },
          h('p', { text: draft.footer }),
        )
        : null,
    );

    message.textContent = '请核对内容与素材建议，修改后需重新预览再保存。';
  }

  showPlaceholder();

  const node = h('section', { class: 'agent-card stack-6' },
    h('h2', { class: 't-h2', text: '美编方案编辑' }),
    h('p', {
      class: 't-secondary',
      text: '使用固定布局展示文字和配图位置。当前不分析图片、不生成图片，也不向外部渠道发布。',
    }),
    h('div', { class: 'agent-design-workspace' },
      fields,
      h('aside', { class: 'agent-design-preview-wrap stack-4' },
        h('h3', { class: 't-title', text: '版式预览' }),
        preview,
      ),
    ),
    message,
    h('div', { class: 'row-4 row-wrap' },
      button({
        label: '预览美编方案',
        onClick: showPreview,
      }),
      button({
        label: '保存美编方案',
        variant: 'primary',
        onClick: () => {
          if (
            previewSnapshot === null ||
            previewSnapshot !== JSON.stringify(read())
          ) {
            message.textContent = '请先预览当前方案；修改内容或样式后需要重新预览。';
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
      showPlaceholder();
      message.textContent = '已带入候选内容，请核对、重新预览并保存。';
    },
  };
}