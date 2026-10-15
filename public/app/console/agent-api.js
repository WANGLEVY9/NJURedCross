import { request } from '../core/api.js';

const ROOT = '/api/console/agent/tasks';

function taskPath(id) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('缺少任务编号');
  }
  return `${ROOT}/${encodeURIComponent(id)}`;
}

export const agentApi = Object.freeze({
  createConversation({ mode, brief }) {
    return request(ROOT, {
      method: 'POST',
      body: {
        taskType: 'conversation',
        mode,
        brief,
      },
    });
  },

  generateConversation({ id, version, instruction = '' }) {
    return request(`${taskPath(id)}/conversation-generate`, {
      method: 'POST',
      body: { version, instruction },
    });
  },

  confirmConversation({ id, version, draft }) {
    return request(`${taskPath(id)}/conversation-confirm`, {
      method: 'POST',
      body: { version, draft },
    });
  },

  proposeDraftRevision({ id, version, fields, instruction }) {
    return request(`${taskPath(id)}/revise-draft`, {
      method: 'POST',
      body: { version, fields, instruction },
    });
  },
  status() {
    return request('/api/console/agent/status');
  },
  saveDesignDraft({ id, version, draft }) {
    return request(`${taskPath(id)}/design-draft`, {
      method: 'POST',
      body: { version, draft },
    });
  },
  saveWritingDraft({ id, version, draft }) {
    return request(`${taskPath(id)}/writing-draft`, {
      method: 'POST',
      body: { version, draft },
    });
  },
  saveActivityDraft({ id, version, draft }) {
    return request(`${taskPath(id)}/activity-draft`, {
      method: 'POST',
      body: { version, draft },
    });
  },
  remove({ id, version }) {
    return request(`${taskPath(id)}/delete`, {
      method: 'POST',
      body: { version },
    });
  },
  history() {
    return request('/api/console/agent/history');
  },
  create({ mode, brief }) {
    return request(ROOT, {
      method: 'POST',
      body: { mode, brief },
    });
  },

  get(id) {
    return request(taskPath(id));
  },

  generate({ id, version, instruction = '' }) {
    return request(`${taskPath(id)}/generate`, {
      method: 'POST',
      body: { version, instruction },
    });
  },

  revise({ id, version, stepId, output }) {
    return request(`${taskPath(id)}/revise`, {
      method: 'POST',
      body: { version, stepId, output },
    });
  },

  confirm({ id, version, stepId }) {
    return request(`${taskPath(id)}/confirm`, {
      method: 'POST',
      body: { version, stepId },
    });
  },
});