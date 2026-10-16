import { h } from '../core/dom.js';
import { button, checkbox, field } from '../ui/primitives.js';
import { confirmAction } from '../ui/overlay.js';
import { agentDraftFieldLabel } from './agent-candidate-panel.js';
import {
  AGENT_SAVED_DRAFT_KEYS,
  savedAgentDraft,
  buildAgentDraftRevision,
  validateAgentDraftRevisionProposal,
} from '../shared/agent-draft-revision.js';

export function createDraftRevisionPanel({
  task,
  editor,
  onGenerate,
  isBusy,
  isActive,
}) {
  if (!task[AGENT_SAVED_DRAFT_KEYS[task.mode]]) return null;

  const saved = savedAgentDraft(task);
  const proposal = task.draftRevisionProposal
    ? validateAgentDraftRevisionProposal(task, task.draftRevisionProposal)
    : null;

  const defaultField = task.mode === 'activity'
    ? 'name'
    : task.mode === 'design'
      ? 'headline'
      : 'title';

  const selected = new Set(proposal?.fields || [defaultField]);
  const instructions = field({
    name: 'agent-revision-instruction',
    label: '草稿修改要求',
    value: proposal?.instruction || '',
    multiline: true,
    rows: 3,
    maxlength: 2000,
    hint: '例如：只把标题改得更简洁，正文和其他内容保持原样。',
  });

  const message = h('p', {
    class: 't-secondary',
    attrs: {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': '草稿修改状态',
    },
  });

  function readRequest() {
    return {
      fields: [...selected].sort(),
      instruction: instructions.control.value,
    };
  }

  const originalRequest = JSON.stringify(readRequest());
  let confirming = false;

  function changeRows(changes) {
    return changes.map(change =>
      h('div', { class: 'agent-candidate-change stack-2' },
        h('strong', {
          text: agentDraftFieldLabel(task.mode, change.name),
        }),
        h('p', {
          text: `修改前：${String(change.before ?? '') || '未填写'}`,
        }),
        h('p', {
          text: `建议：${String(change.after ?? '') || '留空'}`,
        }),
      ),
    );
  }

  async function adoptProposal() {
    if (!proposal || confirming || isBusy() || !isActive()) return;

    const current = editor.readDraft();
    const changes = proposal.fields
      .filter(name =>
        String(current[name] ?? '') !== String(proposal.draft[name]),
      )
      .map(name => ({
        name,
        before: current[name],
        after: proposal.draft[name],
      }));

    if (!changes.length) {
      message.textContent = '建议与当前编辑内容相同，无需带入。';
      return;
    }

    confirming = true;
    try {
      const snapshot = JSON.stringify(current);

      const accepted = await confirmAction({
        title: '采用这些草稿修改？',
        description: '只改变下列字段，其他编辑内容保留。带入后需要重新预览并保存。',
        confirmLabel: '确认采用',
        cancelLabel: '取消',
        details: changeRows(changes),
      });

      if (!accepted || !isActive() || isBusy()) return;

      if (JSON.stringify(editor.readDraft()) !== snapshot) {
        message.textContent = '编辑内容已变化，请重新核对修改建议。';
        return;
      }

      editor.applyDraft(Object.fromEntries(
        changes.map(change => [change.name, change.after]),
      ));

      message.textContent = '已采用到编辑器，尚未保存。';
    } finally {
      confirming = false;
    }
  }

  const node = h('section', { class: 'agent-card stack-6' },
    h('h2', { class: 't-h2', text: '指定字段修改' }),
    h('p', {
      class: 't-secondary',
      text: '基于已保存草稿生成建议，只采用所选字段。模拟模式仅演示标题类修改，其他内容保持原值。',
    }),
    h('fieldset', { class: 'agent-revision-fields' },
      h('legend', { class: 'field__label', text: '选择要修改的字段' }),
      ...Object.keys(saved).map(name => checkbox({
        label: `修改：${agentDraftFieldLabel(task.mode, name)}`,
        checked: selected.has(name),
        onChange: checked => {
          if (checked) selected.add(name);
          else selected.delete(name);
        },
      })),
    ),
    instructions,
    message,
    button({
      label: '生成修改建议',
      onClick: () => {
        if (isBusy() || !isActive()) return;

        if (editor.isDirty()) {
          message.textContent = '请先保存编辑器中的修改，再生成修改建议。';
          return;
        }

        if (!selected.size || !instructions.control.value.trim()) {
          message.textContent = '请选择字段并填写修改要求。';
          return;
        }

        void onGenerate(
          [...selected],
          instructions.control.value.trim(),
        );
      },
    }),
  );

  if (proposal) {
    const analysis = buildAgentDraftRevision(task, {
      fields: proposal.fields,
      candidate: proposal.draft,
    });

    node.append(
      h('h3', { class: 't-title', text: '已生成的修改建议' }),
      h('p', {
        class: 't-secondary',
        text: proposal.simulated
          ? '来源：模拟模板'
          : '来源：模型建议，需人工核对',
      }),
      h('div', { class: 'agent-candidate-content stack-4' },
        ...changeRows(analysis.changes),
        analysis.changes.length
          ? null
          : h('p', { text: '模型没有提出所选字段的变化。' }),
      ),
      analysis.complete
        ? null
        : h('p', {
          class: 't-secondary',
          text: '建议中仍有需要补齐或修正的信息，采用后请核对。',
        }),
      button({
        label: '预览并采用修改',
        onClick: () => { void adoptProposal(); },
      }),
    );
  }

  return {
    node,
    hasInput: () => JSON.stringify(readRequest()) !== originalRequest,
  };
}