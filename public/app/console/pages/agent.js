import { h } from '../../core/dom.js';
import { hasPermission } from '../../core/api.js';
import { patchQuery, registerLeaveGuard, navigate } from '../../core/router.js';
import { confirmAction } from '../../ui/overlay.js';
import { button, field, pageHead } from '../../ui/primitives.js';
import { AGENT_FLOWS } from '../../shared/agent-workflow.js';
import { agentApi } from '../agent-api.js';
import { agentActivityEditor } from '../agent-activity-editor.js';
import { agentWritingEditor } from '../agent-writing-editor.js';
import { agentDesignEditor } from '../agent-design-editor.js';
import {
  agentConversationView,
} from '../agent-conversation-view.js';
import { createDraftRevisionPanel } from '../agent-draft-revision-panel.js';
import { createDraftCandidatePanel } from '../agent-candidate-panel.js';

export default async function agentPage() {
  let disposed = false;
  let busy = false;
  let task = null;
  let modelStatus = null;
  let modelStatusRequest = 0;

  const modeHeading = h('strong', {
    text: '正在读取模型模式…',
  });
  const modeDescription = h('p', {
    class: 't-secondary',
    text: '请稍候，确认服务器配置后即可创建任务。',
  });
  let hasOutputChanges = () => false;
  let hasActivityChanges = () => false;
  let hasWritingChanges = () => false;
  let hasDesignChanges = () => false;
  let hasRevisionInput = () => false;
  let confirmingRevisionInput = false;

  const availableModes = Object.entries(AGENT_FLOWS)
    .filter(([, flow]) => hasPermission(flow.scope));

  const feedback = h('p', {
    class: 't-secondary',
    attrs: {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': '任务操作状态',
    },
  });

  const taskSlot = h('div', { class: 'stack-6' });
  const historySlot = h('div', { class: 'stack-4' });
  const historyFeedback = h('p', {
    class: 't-secondary',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  let historyRequest = 0;

  const modeField = field({
    name: 'agent-mode',
    label: '助手类型',
    value: availableModes[0]?.[0] || '',
    options: availableModes.map(([value, flow]) => ({
      value,
      label: flow.label,
    })),
  });

  const briefField = field({
    name: 'agent-brief',
    label: '任务需求',
    multiline: true,
    rows: 6,
    maxlength: 4000,
    placeholder: '例如：筹备一次面向新生的急救知识活动，预计 30 人参加。',
    hint: '可以填写目标、受众、时间、地点和已有资料。',
  });

  function renderTask() {
    hasOutputChanges = () => false;
    hasActivityChanges = () => false;
    hasWritingChanges = () => false;
    hasDesignChanges = () => false;
    hasRevisionInput = () => false;
    const openEditorId = taskSlot.querySelector(
      'details[data-conversation-editor][open]',
    )?.dataset.taskId;

    taskSlot.replaceChildren();
    createButton.textContent = task?.taskType === 'conversation'
      ? '发送'
      : '创建任务';

    if (!task) return;

    const renderedTask = task;

    if (task.taskType === 'conversation') {
      const conversation = agentConversationView({
        task: renderedTask,
        isBusy: () => busy,
        onGenerate: async () => {
          if (!modelStatus || disposed || task !== renderedTask) return;

          await perform(() => agentApi.generateConversation({
            id: renderedTask.id,
            version: renderedTask.version,
          }));
        },
        onConfirm: async draft => {
          if (!modelStatus || disposed || task !== renderedTask) return;

          if (briefField.control.value.trim()) {
            feedback.textContent = '输入框还有未发送的内容，请先发送或清空，再确认需求。';
            return;
          }

          const accepted = await perform(
            () => agentApi.confirmConversation({
              id: renderedTask.id,
              version: renderedTask.version,
              draft,
            }),
            { allowRevisionInput: true },
          );

          if (
            !accepted ||
            disposed ||
            task?.id !== renderedTask.id ||
            task.status !== 'ready'
          ) {
            return;
          }

          await perform(() => agentApi.generateConversation({
            id: task.id,
            version: task.version,
          }));
        },
      });

      hasRevisionInput = conversation.isDirty;
      taskSlot.append(conversation.node);

      if (renderedTask.status === 'result_ready') {
        const definitions = {
          activity: {
            createEditor: agentActivityEditor,
            save: agentApi.saveActivityDraft,
            flag: 'allowActivityChanges',
            label: '编辑活动配置（可选）',
          },
          writing: {
            createEditor: agentWritingEditor,
            save: agentApi.saveWritingDraft,
            flag: 'allowWritingChanges',
            label: '编辑推文草稿（可选）',
          },
          design: {
            createEditor: agentDesignEditor,
            save: agentApi.saveDesignDraft,
            flag: 'allowDesignChanges',
            label: '编辑美编方案（可选）',
          },
        };
        const definition = definitions[renderedTask.mode];

        const editor = definition.createEditor({
          task: renderedTask,
          initialDraft: renderedTask.output.draft,
          onSave: draft => {
            if (disposed || task !== renderedTask) return;

            return perform(() => definition.save({
              id: renderedTask.id,
              version: renderedTask.version,
              draft,
            }), {
              [definition.flag]: true,
              keepConversationInput: true,
            });
          },
        });

        if (renderedTask.mode === 'activity') {
          hasActivityChanges = editor.isDirty;
        } else if (renderedTask.mode === 'writing') {
          hasWritingChanges = editor.isDirty;
        } else {
          hasDesignChanges = editor.isDirty;
        }

        taskSlot.append(
          h('details', {
            class: 'agent-history stack-4',
            data: {
              conversationEditor: true,
              taskId: renderedTask.id,
            },
            attrs: {
              open: openEditorId === renderedTask.id,
            },
          },
            h('summary', { text: definition.label }),
            editor.node,
          ),
        );

        if (
          renderedTask.mode === 'activity' &&
          renderedTask.activityDraft
        ) {
          taskSlot.append(
            h('section', { class: 'agent-card stack-4' },
              h('h2', {
                class: 't-h2',
                text: '交接到活动管理',
              }),
              h('p', {
                class: 't-secondary',
                text: '带入的是已保存配置。活动创建和审批仍在活动管理页面核对后提交。',
              }),
              button({
                label: '带入活动创建表单',
                variant: 'primary',
                onClick: () => {
                  if (busy || disposed) return;

                  if (hasActivityChanges()) {
                    feedback.textContent = '配置已有修改，请先重新预览并保存。';
                    return;
                  }

                  void navigate(
                    `/console/events?agentTask=${encodeURIComponent(renderedTask.id)}`,
                  );
                },
              }),
            ),
          );
        }
      }

      return;
    }

    function appendCandidate(editor) {
      const candidate = createDraftCandidatePanel({
        task: renderedTask,
        editor,
        isBusy: () => busy,
        isActive: () => !disposed && task === renderedTask,
      });

      if (candidate) taskSlot.append(candidate);
      const revisionPanel = createDraftRevisionPanel({
        task: renderedTask,
        editor,
        isBusy: () => busy,
        isActive: () => !disposed && task === renderedTask,
        onGenerate: (fields, instruction) => {
          if (!modelStatus) {
            feedback.textContent = '请先刷新模型状态。';
            return;
          }

          return perform(() => agentApi.proposeDraftRevision({
            id: renderedTask.id,
            version: renderedTask.version,
            fields,
            instruction,
          }), { allowRevisionInput: true });
        },
      });

      if (revisionPanel) {
        hasRevisionInput = revisionPanel.hasInput;
        taskSlot.append(revisionPanel.node);
      }
    }

    const active = task.steps.find(step => step.status !== 'confirmed');
    const confirmed = task.steps.filter(step => step.status === 'confirmed');

    const progress = h('section', { class: 'agent-card stack-6' },
      h('h2', {
        class: 't-h2',
        text: `${AGENT_FLOWS[task.mode].label}任务`,
      }),
      h('p', { class: 't-secondary', text: task.brief }),
      h('p', {
        class: 't-secondary',
        text: `任务编号：${task.id}`,
      }),
      h('ol', { class: 'stack-4' },
        ...task.steps.map(step => h('li', {
          text: `${step.label} · ${
            step.status === 'confirmed'
              ? '已确认'
              : step.status === 'ready'
                ? '待确认'
                : '待生成'
          }`,
        })),
      ),
    );

    const sourceLabel = task.provider === 'mock'
      ? '模拟模板'
      : task.provider === 'deepseek'
        ? 'DeepSeek'
        : '兼容模型';

    progress.append(
      h('p', {
        class: 't-secondary',
        text: `${
          task.steps.some(step => step.output)
            ? '最近一次生成来源'
            : '任务创建时使用'
        }：${sourceLabel}`,
      }),
    );

    taskSlot.append(progress);
    if (
      task.mode === 'design' &&
      task.steps.some(step =>
        step.id === 'preview' && step.status === 'confirmed',
      )
    ) {
      const designEditor = agentDesignEditor({
        task,
        onSave: draft => perform(() => agentApi.saveDesignDraft({
          id: task.id,
          version: task.version,
          draft,
        }), { allowDesignChanges: true }),
      });

      hasDesignChanges = designEditor.isDirty;
      taskSlot.append(designEditor.node);
      appendCandidate(designEditor);
    }
    if (
      task.mode === 'writing' &&
      task.steps.some(step =>
        step.id === 'draft' && step.status === 'confirmed',
      )
    ) {
      const writingEditor = agentWritingEditor({
        task,
        onSave: draft => perform(() => agentApi.saveWritingDraft({
          id: task.id,
          version: task.version,
          draft,
        }), { allowWritingChanges: true }),
      });

      hasWritingChanges = writingEditor.isDirty;
      taskSlot.append(writingEditor.node);
      appendCandidate(writingEditor);
    }
    if (
      task.mode === 'activity' &&
      task.steps.some(step =>
        step.id === 'configuration' && step.status === 'confirmed',
      )
    ) {
      const activityEditor = agentActivityEditor({
        task,
        onSave: draft => perform(() => agentApi.saveActivityDraft({
          id: task.id,
          version: task.version,
          draft,
        }), { allowActivityChanges: true }),
      });

      hasActivityChanges = activityEditor.isDirty;
      taskSlot.append(activityEditor.node);
      appendCandidate(activityEditor);

      if (task.activityDraft) {
        taskSlot.append(
          h('section', { class: 'agent-card stack-4' },
            h('h2', { class: 't-h2', text: '交接到活动管理' }),
            h('p', {
              class: 't-secondary',
              text: '将已保存的配置带入新建活动表单。请再次核对负责人及其他字段，再决定保存草稿或提交审批。',
            }),
            button({
              label: '带入活动创建表单',
              variant: 'primary',
              onClick: () => {
                if (busy) return;

                if (hasActivityChanges()) {
                  feedback.textContent = '配置已有修改，请先重新预览并保存。';
                  return;
                }

                void navigate(
                  `/console/events?agentTask=${encodeURIComponent(task.id)}`,
                );
              },
            }),
          ),
        );
      }
    }

    if (active) {
      const instruction = field({
        name: 'agent-instruction',
        label: '补充要求',
        multiline: true,
        rows: 3,
        maxlength: 2000,
        hint: '补充要求用于下一轮生成；模拟模式仅记录这些要求。',
      });

      const editor = h('div', { class: 'stack-6' });
      let readOutput = null;
      let originalOutput = '';

      function hasChanges() {
        return readOutput !== null
          && JSON.stringify(readOutput()) !== originalOutput;
      }

      hasOutputChanges = hasChanges;

      if (active.output) {
        const title = field({
          name: 'agent-output-title',
          label: '结果标题',
          value: active.output.title,
          maxlength: 200,
        });

        const summary = field({
          name: 'agent-output-summary',
          label: '结果说明',
          value: active.output.summary,
          multiline: true,
          rows: 3,
          maxlength: 4000,
        });

        const items = active.output.items.map((value, index) => field({
          name: `agent-output-item-${index}`,
          label: `内容 ${index + 1}`,
          value,
          multiline: true,
          rows: 3,
          maxlength: 4000,
        }));

        readOutput = () => ({
          title: title.control.value,
          summary: summary.control.value,
          items: items.map(item => item.control.value),
          ...(active.output.draft
            ? { draft: structuredClone(active.output.draft) }
            : {}),
        });

        originalOutput = JSON.stringify(readOutput());
        editor.append(title, summary, ...items);
      }

      const generateButton = button({
        label: active.output ? '重新生成方案' : '生成方案',
        variant: active.output ? 'secondary' : 'primary',
        onClick: () => {
          if (!modelStatus) {
            feedback.textContent = '请先刷新模型状态，确认当前模式后再生成。';
            return;
          }
          if (hasChanges()) {
            feedback.textContent = '请先保存编辑内容，再重新生成方案。';
            return;
          }

          void perform(() => agentApi.generate({
            id: task.id,
            version: task.version,
            instruction: instruction.control.value,
          }));
        },
      });

      const actions = h('div', { class: 'row-4 row-wrap' },
        generateButton,
      );

      if (active.output) {
        actions.append(
          button({
            label: '保存编辑',
            onClick: () => {
              const output = readOutput();
              if (!output.title.trim() || !output.summary.trim()) {
                feedback.textContent = '结果标题和结果说明不能为空。';
                return;
              }

              void perform(() => agentApi.revise({
                id: task.id,
                version: task.version,
                stepId: active.id,
                output,
              }));
            },
          }),
          button({
            label: '确认本步',
            variant: 'primary',
            onClick: () => {
              if (hasChanges()) {
                feedback.textContent = '内容有修改，请先点击“保存编辑”。';
                return;
              }

              void perform(() => agentApi.confirm({
                id: task.id,
                version: task.version,
                stepId: active.id,
              }));
            },
          }),
        );
      }

      taskSlot.append(
        h('section', { class: 'agent-card stack-6' },
          h('h2', { class: 't-h2', text: active.label }),
          instruction,
          editor,
          actions,
        ),
      );
    } else {
      taskSlot.append(
        h('section', { class: 'agent-card stack-4' },
          h('h2', { class: 't-h2', text: '全部步骤已确认' }),
          h('p', {
            class: 't-secondary',
            text: '模拟草稿已整理完成，可在下方查看。尚未创建真实活动或发布推文。',
          }),
        ),
      );
    }

    if (confirmed.length) {
      taskSlot.append(
        h('section', { class: 'agent-card stack-6' },
          h('h2', { class: 't-h2', text: '已确认内容' }),
          ...confirmed.map(step => h('details', {
            class: 'agent-history',
          },
            h('summary', { text: step.label }),
            h('div', { class: 'stack-4' },
              h('h3', { class: 't-title', text: step.output.title }),
              h('p', { text: step.output.summary }),
              ...step.output.items.map(text => h('p', { text })),
            ),
          )),
        ),
      );
    }
  }

  async function perform(action, {
    allowActivityChanges = false,
    allowWritingChanges = false,
    allowDesignChanges = false,
    allowRevisionInput = false,
    keepConversationInput = false,
  } = {}) {
    if (busy || disposed) return;

    if (!allowActivityChanges && hasActivityChanges()) {
      feedback.textContent = '活动配置尚未保存，请先预览并保存配置。';
      return;
    }
    if (!allowWritingChanges && hasWritingChanges()) {
      feedback.textContent = '推文尚未保存，请先预览并保存草稿。';
      return;
    }
    if (!allowDesignChanges && hasDesignChanges()) {
      feedback.textContent = '美编方案尚未保存，请先预览并保存。';
      return;
    }
    if (!allowRevisionInput && hasRevisionInput()) {
      if (confirmingRevisionInput) return;
      confirmingRevisionInput = true;

      let accepted;
      try {
        accepted = await confirmAction({
          title: '放弃尚未提交的修改要求？',
          description: '继续操作会重新加载任务，当前尚未提交的字段选择和修改要求将丢失。',
          confirmLabel: '放弃并继续',
          cancelLabel: '取消',
        });
      } finally {
        confirmingRevisionInput = false;
      }

      if (!accepted || disposed || busy) return;
    }
    busy = true;
    taskSlot.inert = true;
    createButton.disabled = true;
    modeField.control.disabled = true;
    briefField.control.disabled = true;
    feedback.textContent = '正在处理…';
    const submittedInput = briefField.control.value;

    try {
      const payload = await action();
      if (disposed) return;
      task = payload.task;
      briefField.control.value = task.taskType === 'conversation'
        ? (keepConversationInput ? submittedInput : '')
        : task.brief;
      modeField.control.value = task.mode;
      patchQuery({ task: task.id });
      renderTask();
      feedback.textContent = '任务已更新。';
      void loadHistory();
      return payload;
    } catch (error) {
      if (!disposed) {
        feedback.textContent = error.message || '处理失败，请重试。';
      }
    } finally {
      busy = false;
      taskSlot.inert = false;
      if (!disposed) {
        createButton.disabled = !modelStatus || availableModes.length === 0;
        modeField.control.disabled =
          availableModes.length === 0 ||
          task?.taskType === 'conversation';
        briefField.control.disabled = availableModes.length === 0;
      }
    }
  }

  function hasUnsavedInput() {
    const brief = briefField.control.value.trim();
    const unsavedBrief = task?.taskType === 'conversation'
      ? brief !== ''
      : brief !== '' && brief !== task?.brief;
    const instruction = taskSlot.querySelector(
      '[name="agent-instruction"]',
    );

    return unsavedBrief
      || hasOutputChanges()
      || hasActivityChanges()
      || hasWritingChanges()
      || hasDesignChanges()
      || hasRevisionInput()
      || Boolean(instruction?.value.trim());
  }

  function beforeUnload(event) {
    if (!busy && !hasUnsavedInput()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  window.addEventListener('beforeunload', beforeUnload);

  async function canLeaveTask() {
    if (disposed) return true;

    if (busy) {
      feedback.textContent = '任务正在处理，请完成后再离开。';
      return false;
    }

    if (!hasUnsavedInput()) return true;

    return confirmAction({
      title: '离开并放弃未保存的内容？',
      description: '已保存的任务仍可通过当前地址恢复，未保存的编辑和补充要求将丢失。',
      confirmLabel: '放弃并离开',
      cancelLabel: '继续编辑',
      tone: 'danger',
    });
  }

  const removeLeaveGuard = registerLeaveGuard(canLeaveTask);

  async function sendConversation() {
    if (busy || disposed || !modelStatus) return;

    if (hasRevisionInput()) {
      feedback.textContent = '需求卡有未确认的字段修改，请先点击“确认并生成”。';
      return;
    }

    const instruction = briefField.control.value.trim();

    if (!instruction && task.status === 'result_ready') {
      feedback.textContent = '请在输入框填写修改意见。';
      briefField.control.focus();
      return;
    }

    if (instruction.length > 2000) {
      feedback.textContent = '每次补充或修改意见请控制在2000字以内。';
      return;
    }

    if (task.status === 'ready' && instruction) {
      feedback.textContent = '需求已经确认，请先生成完整方案，再提出修改意见。';
      return;
    }

    const current = task;

    await perform(() => agentApi.generateConversation({
      id: current.id,
      version: current.version,
      instruction,
    }));
  }

  const createButton = button({
    label: '创建任务',
    variant: 'primary',
    disabled: availableModes.length === 0,
    onClick: () => {
      if (task?.taskType === 'conversation') {
        void sendConversation();
        return;
      }

      if (!modelStatus) {
        feedback.textContent = '请先刷新模型状态，确认当前模式后再创建任务。';
        return;
      }
      if (task && (
        hasOutputChanges()
        || hasActivityChanges()
        || hasWritingChanges()
        || hasDesignChanges()
        || hasRevisionInput()
        || taskSlot.querySelector('[name="agent-instruction"]')
          ?.value.trim()
      )) {
        feedback.textContent = '请先保存编辑内容或处理补充要求，再创建新任务。';
        return;
      }

      const brief = briefField.control.value.trim();
      if (!brief) {
        feedback.textContent = '请先填写任务需求。';
        briefField.control.focus();
        return;
      }

      void (async () => {
        const created = await perform(() => agentApi.createConversation({
          mode: modeField.control.value,
          brief,
        }));

        if (
          !created ||
          disposed ||
          task?.id !== created.task.id ||
          task.taskType !== 'conversation'
        ) {
          return;
        }

        await perform(() => agentApi.generateConversation({
          id: task.id,
          version: task.version,
        }));
      })();
    },
  });

  const newConversationButton = button({
    label: '新对话',
    variant: 'ghost',
    onClick: async () => {
      if (!await canLeaveTask() || disposed || busy) return;

      task = null;
      briefField.control.value = '';
      modeField.control.disabled = availableModes.length === 0;
      patchQuery({ task: null });
      renderTask();
      feedback.textContent = '请输入新的需求。';
      briefField.control.focus();
    },
  });

  async function loadModelStatus() {
    const requestId = ++modelStatusRequest;
    modeHeading.textContent = '正在读取模型模式…';

    try {
      const payload = await agentApi.status();
      if (disposed || requestId !== modelStatusRequest) return;

      if (
        !['mock', 'deepseek', 'compatible'].includes(payload.provider) ||
        typeof payload.simulated !== 'boolean' ||
        payload.simulated !== (payload.provider === 'mock')
      ) {
        throw new Error('服务器返回的模型状态不正确');
      }

      modelStatus = {
        provider: payload.provider,
        simulated: payload.simulated,
      };

      modeHeading.textContent = payload.simulated
        ? '当前为模拟模式'
        : payload.provider === 'deepseek'
          ? '当前为 DeepSeek 模型模式'
          : '当前为兼容模型模式';

      modeDescription.textContent = payload.simulated
        ? '使用固定模板演示流程，不发送模型请求。已保存任务存放在服务器本地文件中。'
        : '生成时会将需求、当前方案及按权限查询到的相关系统记录发送给模型服务。结果仍需人工核对，不会自动创建活动或发布。';
    } catch (error) {
      if (disposed || requestId !== modelStatusRequest) return;

      modelStatus = null;
      modeHeading.textContent = '模型状态暂不可用';
      modeDescription.textContent =
        error.message || '请刷新模型状态后再创建或生成任务。';
    } finally {
      if (!disposed && requestId === modelStatusRequest) {
        createButton.disabled =
          busy || !modelStatus || availableModes.length === 0;
      }
    }
  }

  let confirmingDeletion = false;

  async function deleteTask(saved) {
    if (disposed || confirmingDeletion) return;

    if (busy) {
      feedback.textContent = '任务正在处理，请完成后再删除。';
      return;
    }

    confirmingDeletion = true;

    try {
      const deletingCurrent = task?.id === saved.id;
      const hasUnsaved = deletingCurrent && hasUnsavedInput();
      const version = deletingCurrent ? task.version : saved.version;

      const confirmed = await confirmAction({
        title: '删除这个任务？',
        description: hasUnsaved
          ? '当前任务有未保存内容。删除会同时放弃这些内容，并永久删除已保存记录，无法恢复。'
          : '任务及已保存的方案将从本地存储中永久删除，无法恢复。',
        details: [
          AGENT_FLOWS[saved.mode].label,
          saved.brief,
        ],
        confirmLabel: '确认删除',
        cancelLabel: '取消',
        tone: 'danger',
      });

      if (!confirmed || disposed) return;

      if (busy) {
        feedback.textContent = '任务正在处理，请完成后再删除。';
        return;
      }

      busy = true;
      taskSlot.inert = true;
      historySlot.inert = true;
      createButton.disabled = true;
      modeField.control.disabled = true;
      briefField.control.disabled = true;
      feedback.textContent = '正在删除任务…';

      try {
        const payload = await agentApi.remove({
          id: saved.id,
          version,
        });

        if (disposed) return;

        if (payload.deletedId !== saved.id) {
          throw new Error('删除结果无法确认，请刷新历史列表核对。');
        }

        if (task?.id === saved.id) {
          task = null;
          briefField.control.value = '';
          patchQuery({ task: null });
          renderTask();
        }

        feedback.textContent = '任务已删除。';
        await loadHistory();
      } catch (error) {
        if (!disposed) {
          feedback.textContent =
            error.message || '删除失败，任务仍保留，请重试。';
        }
      } finally {
        busy = false;
        taskSlot.inert = false;
        historySlot.inert = false;

        if (!disposed) {
          createButton.disabled = !modelStatus || availableModes.length === 0;
        modeField.control.disabled =
          availableModes.length === 0 ||
          task?.taskType === 'conversation';
          briefField.control.disabled = availableModes.length === 0;
        }
      }
    } finally {
      confirmingDeletion = false;
    }
  }

  async function loadHistory() {
    const requestId = ++historyRequest;
    historyFeedback.textContent = '正在加载历史任务…';

    try {
      const payload = await agentApi.history();
      if (disposed || requestId !== historyRequest) return;

      historySlot.replaceChildren();

      if (!payload.tasks.length) {
        historyFeedback.textContent = '暂时没有可查看的历史任务。';
        return;
      }

      historyFeedback.textContent = `${payload.tasks.length} 个历史任务`;

      for (const saved of payload.tasks) {
        const status = saved.status === 'result_ready'
          ? '方案已生成'
          : saved.status === 'draft_ready'
            ? '草稿已完成'
            : saved.status === 'awaiting_confirmation'
              ? '等待确认'
              : saved.status === 'ready'
                ? '需求已确认'
                : '待继续';

        historySlot.append(
          h('article', { class: 'agent-history stack-4' },
            h('div', { class: 'row-4 row-wrap' },
              h('strong', {
                text: AGENT_FLOWS[saved.mode].label,
              }),
              h('span', { class: 't-secondary', text: status }),
            ),
            h('p', { text: saved.brief }),
            h('p', {
              class: 't-secondary',
              text: `更新于 ${new Date(saved.updatedAt).toLocaleString('zh-CN')}`,
            }),
            h('div', { class: 'row-4 row-wrap' },
              button({
                label: '打开任务',
                ariaLabel: `打开任务 ${saved.id}`,
                onClick: async () => {
                  if (!await canLeaveTask() || disposed || busy) return;
                  await perform(
                    () => agentApi.get(saved.id),
                    {
                      allowActivityChanges: true,
                      allowWritingChanges: true,
                      allowRevisionInput: true,
                    },
                  );
                },
              }),
              button({
                label: '删除任务',
                ariaLabel: `删除任务 ${saved.id}`,
                variant: 'ghost',
                onClick: () => { void deleteTask(saved); },
              }),
            ),
          ),
        );
      }
    } catch (error) {
      if (!disposed && requestId === historyRequest) {
        historyFeedback.textContent =
          error.message || '历史任务加载失败，请点击刷新重试。';
      }
    }
  }

  const node = h('div', {
    class: 'view wspad wspad--wide stack-6 agent-page',
  },
    pageHead({
      title: '工作助手',
      description: '协助筹备活动、整理推文与规划美编方案。',
    }),
    h('section', { class: 'agent-card agent-mode-note stack-4' },
      h('div', { class: 'row-4 row-wrap' },
        modeHeading,
        button({
          label: '刷新模型状态',
          variant: 'ghost',
          onClick: () => { void loadModelStatus(); },
        }),
      ),
      modeDescription,
    ),
    taskSlot,
    h('section', { class: 'agent-card stack-6' },
      h('h2', { class: 't-h2', text: '对话输入' }),
      availableModes.length
        ? h('div', { class: 'stack-6' },
          modeField,
          briefField,
          h('div', { class: 'row-4 row-wrap' },
            createButton,
            newConversationButton,
          ),
        )
        : h('p', {
          class: 't-secondary',
          text: '当前账号需要活动管理或宣传管理权限才能创建任务。',
        }),
      feedback,
    ),
    h('section', { class: 'agent-card stack-6' },
      h('div', { class: 'row-4 row-wrap' },
        h('h2', { class: 't-h2', text: '历史任务' }),
        button({
          label: '刷新历史',
          onClick: () => { void loadHistory(); },
        }),
      ),
      historyFeedback,
      historySlot,
    ),
  );

  createButton.disabled = true;
  void loadModelStatus();
  void loadHistory();
  const savedId = new URLSearchParams(location.search).get('task');
  if (savedId) {
    void perform(() => agentApi.get(savedId));
  }

  return {
    title: '工作助手',
    node,
    dispose() {
      disposed = true;
      removeLeaveGuard();
      window.removeEventListener('beforeunload', beforeUnload);
    },
  };
}