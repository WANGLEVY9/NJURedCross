import test from 'node:test';
import assert from 'node:assert/strict';
import { agentRoutes } from '../lib/agent/api.js';
import {
  createAgentTaskService,
} from '../lib/agent/task-service.js';
import {
  createMockAgentModel,
} from '../lib/agent/mock-model.js';

function fixture() {
  let count = 0;
  let csrf = true;
  let permissions = ['events', 'outreach'];

  const service = createAgentTaskService({
    model: createMockAgentModel(),
    idFactory: () => `synthetic-api-conversation-${++count}`,
  });

  const ctx = {
    service,
    requireConsoleAccess: () => ({
      username: 'synthetic-admin',
    }),
    requireCsrf(_req, res) {
      if (csrf) return true;
      ctx.json(res, 403, { ok: false, message: 'CSRF 校验失败' });
      return false;
    },
    getPermissions: () => permissions,
    readJson: async req => req.body,
    json(res, status, payload) {
      res.result = { status, payload };
    },
  };

  return {
    setCsrf(value) { csrf = value; },
    setPermissions(value) { permissions = value; },

    async request(path, body, method = 'POST') {
      const res = {};

      await agentRoutes(
        { method, body },
        res,
        new URL(`http://localhost/api/console/agent${path}`),
        ctx,
      );

      return res.result;
    },

    async create(taskType = 'conversation') {
      const response = await this.request('/tasks', {
        mode: 'activity',
        brief: '合成急救课堂需求',
        taskType,
      });

      assert.equal(response.status, 201);
      return response.payload.task;
    },
  };
}

test('conversation API supports one confirmation and later revisions', async () => {
  const f = fixture();
  let task = await f.create();
  const path = `/tasks/${task.id}`;

  let response = await f.request(`${path}/conversation-generate`, {
    version: task.version,
  });
  assert.equal(response.status, 200);
  task = response.payload.task;
  assert.equal(task.status, 'awaiting_confirmation');

  response = await f.request(`${path}/conversation-confirm`, {
    version: task.version,
    draft: { capacity: 20 },
  });
  assert.equal(response.status, 200);
  task = response.payload.task;

  response = await f.request(`${path}/conversation-generate`, {
    version: task.version,
  });
  assert.equal(response.status, 200);
  task = response.payload.task;
  assert.equal(task.status, 'result_ready');

  response = await f.request(`${path}/conversation-generate`, {
    version: task.version,
    instruction: '增加互动建议',
  });
  assert.equal(response.status, 200);
  task = response.payload.task;

  const restored = await f.request(path, undefined, 'GET');
  assert.deepEqual(restored.payload.task, task);
});

test('CSRF and module permissions are enforced', async () => {
  const f = fixture();
  const task = await f.create();

  f.setCsrf(false);
  assert.equal((await f.request(
    `/tasks/${task.id}/conversation-generate`,
    { version: task.version },
  )).status, 403);

  f.setCsrf(true);
  f.setPermissions([]);
  assert.equal((await f.request(
    `/tasks/${task.id}/conversation-generate`,
    { version: task.version },
  )).status, 403);
});

test('stale versions and malformed confirmation fields are rejected', async () => {
  const f = fixture();
  const initial = await f.create();
  const path = `/tasks/${initial.id}`;

  const generated = await f.request(`${path}/conversation-generate`, {
    version: initial.version,
  });
  const task = generated.payload.task;

  assert.equal((await f.request(`${path}/conversation-confirm`, {
    version: initial.version,
    draft: {},
  })).status, 409);

  assert.equal((await f.request(`${path}/conversation-confirm`, {
    version: task.version,
    draft: [],
  })).status, 400);
});

test('workflow and conversation operations cannot be mixed', async () => {
  const f = fixture();
  const conversation = await f.create();

  assert.equal((await f.request(
    `/tasks/${conversation.id}/generate`,
    { version: conversation.version },
  )).status, 400);

  const workflow = await f.create('workflow');
  assert.equal((await f.request(
    `/tasks/${workflow.id}/conversation-generate`,
    { version: workflow.version },
  )).status, 400);
});