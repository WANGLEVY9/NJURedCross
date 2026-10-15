import test from 'node:test';
import assert from 'node:assert/strict';
import { agentRoutes } from '../lib/agent/api.js';
import { createAgentTaskService } from '../lib/agent/task-service.js';
import { createMockAgentModel } from '../lib/agent/mock-model.js';
import { AgentModelError } from '../lib/agent/compatible-model.js';
import { getActiveAgentStep } from '../public/app/shared/agent-workflow.js';

function fixture({ model = createMockAgentModel() } = {}) {
  let session = { username: 'synthetic-admin' };
  let permissions = ['events', 'outreach'];
  let csrf = true;
  let count = 0;
  const responses = [];

  const service = createAgentTaskService({
    model,
    idFactory: () => `synthetic-task-${++count}`,
  });
  const ctx = {
    service,
    requireConsoleAccess(_req, res) {
      if (!session) {
        ctx.json(res, 401, { ok: false, message: '请先登录' });
        return null;
      }
      return session;
    },
    requireCsrf(_req, res) {
      if (!csrf) {
        ctx.json(res, 403, { ok: false, message: 'CSRF 校验失败' });
        return false;
      }
      return true;
    },
    getPermissions: () => permissions,
    readJson: async (req) => req.body,
    json(_res, status, payload) {
      const response = { status, payload };
      responses.push(response);
      return response;
    },
  };

  return {
    service,
    setSession(value) { session = value; },
    setPermissions(value) { permissions = value; },
    setCsrf(value) { csrf = value; },
    async request(path, method = 'GET', body = undefined) {
      responses.length = 0;
      await agentRoutes(
        { method, body },
        {},
        new URL(`http://localhost/api/console/agent${path}`),
        ctx,
      );
      return responses.at(-1);
    },
    async create(mode = 'activity') {
      const response = await this.request('/tasks', 'POST', {
        mode,
        brief: '合成任务需求',
      });
      assert.equal(response.status, 201);
      return response.payload.task;
    },
  };
}

test('unauthenticated requests are rejected', async () => {
  const f = fixture();
  f.setSession(null);
  const result = await f.request('/tasks', 'POST', {
    mode: 'activity',
    brief: '合成需求',
  });
  assert.equal(result.status, 401);
});

test('task changes require CSRF validation', async () => {
  const f = fixture();
  const task = await f.create();
  f.setCsrf(false);

  assert.equal((await f.request(
    `/tasks/${task.id}/generate`,
    'POST',
    { version: task.version },
  )).status, 403);

  const read = await f.request(`/tasks/${task.id}`);
  assert.equal(read.status, 200);
  assert.equal(read.payload.task.version, 1);
});

test('request bodies cannot impersonate another task owner', async () => {
  const f = fixture();
  const created = await f.request('/tasks', 'POST', {
    mode: 'activity',
    brief: '合成需求',
    actor: 'another-admin',
    permissions: ['events'],
  });
  assert.equal(created.status, 201);

  const id = created.payload.task.id;
  assert.equal((await f.request(`/tasks/${id}`)).status, 200);
  f.setSession({ username: 'another-admin' });
  assert.equal((await f.request(`/tasks/${id}`)).status, 404);
});

test('permissions are checked again on later requests', async () => {
  const f = fixture();
  const task = await f.create();
  f.setPermissions(['outreach']);

  assert.equal((await f.request(`/tasks/${task.id}`)).status, 403);
  assert.equal((await f.request(
    `/tasks/${task.id}/generate`,
    'POST',
    { version: task.version },
  )).status, 403);
});

test('invalid creation input and unsupported methods are rejected', async () => {
  const f = fixture();
  assert.equal((await f.request('/tasks', 'GET')).status, 405);

  for (const body of [
    null,
    [],
    { mode: 'activity', brief: '' },
    { mode: 'unknown', brief: '合成需求' },
  ]) {
    assert.equal((await f.request('/tasks', 'POST', body)).status, 400);
  }
});

test('missing results and stale versions cannot be confirmed', async () => {
  const f = fixture();
  const task = await f.create();

  assert.equal((await f.request(
    `/tasks/${task.id}/confirm`,
    'POST',
    { version: task.version, stepId: 'brief' },
  )).status, 409);

  const generated = await f.request(
    `/tasks/${task.id}/generate`,
    'POST',
    { version: task.version },
  );
  assert.equal(generated.status, 200);

  assert.equal((await f.request(
    `/tasks/${task.id}/confirm`,
    'POST',
    { version: task.version, stepId: 'brief' },
  )).status, 409);
});

test('results can be edited and confirmed through the API', async () => {
  const f = fixture();
  const created = await f.create('writing');
  const generated = await f.request(
    `/tasks/${created.id}/generate`,
    'POST',
    { version: created.version },
  );
  const revised = await f.request(
    `/tasks/${created.id}/revise`,
    'POST',
    {
      version: generated.payload.task.version,
      stepId: 'brief',
      output: {
        title: '人工修改标题',
        summary: '人工修改说明',
        items: ['人工修改事项'],
      },
    },
  );
  assert.equal(revised.status, 200);

  const confirmed = await f.request(
    `/tasks/${created.id}/confirm`,
    'POST',
    { version: revised.payload.task.version, stepId: 'brief' },
  );
  assert.equal(confirmed.status, 200);
  assert.equal(getActiveAgentStep(confirmed.payload.task).id, 'outline');
  assert.equal(
    confirmed.payload.task.steps[0].output.title,
    '人工修改标题',
  );
});

test('the complete workflow ends in a draft and cannot generate further steps', async () => {
  const f = fixture();
  let task = await f.create('design');

  while (getActiveAgentStep(task)) {
    const stepId = getActiveAgentStep(task).id;
    const generated = await f.request(
      `/tasks/${task.id}/generate`,
      'POST',
      { version: task.version },
    );
    assert.equal(generated.status, 200);
    task = generated.payload.task;

    const confirmed = await f.request(
      `/tasks/${task.id}/confirm`,
      'POST',
      { version: task.version, stepId },
    );
    assert.equal(confirmed.status, 200);
    task = confirmed.payload.task;
  }

  assert.equal(task.status, 'draft_ready');
  assert.equal(Object.hasOwn(task, 'eventId'), false);
  assert.equal((await f.request(
    `/tasks/${task.id}/generate`,
    'POST',
    { version: task.version },
  )).status, 409);
});

test('model errors preserve the task without exposing internal details', async () => {
  const f = fixture({
    model: {
      provider: 'mock',
      generate: async () => {
        throw new Error('不应返回给网页的合成内部错误');
      },
    },
  });
  const task = await f.create();
  const result = await f.request(
    `/tasks/${task.id}/generate`,
    'POST',
    { version: task.version },
  );

  assert.equal(result.status, 500);
  assert.doesNotMatch(result.payload.message, /合成内部错误/);
  const stored = await f.request(`/tasks/${task.id}`);
  assert.equal(stored.payload.task.version, 1);
  assert.equal(stored.payload.task.steps[0].output, null);
});

test('history returns only owned tasks with current permissions', async () => {
  const api = fixture();
  const activity = await api.create('activity');
  const writing = await api.create('writing');

  api.service.create({
    actor: 'another-admin',
    permissions: ['events'],
    mode: 'activity',
    brief: '其他账号的合成任务',
  });

  let response = await api.request('/history');
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.payload.tasks.map(task => task.id).sort(),
    [activity.id, writing.id].sort(),
  );

  assert.equal(
    response.payload.tasks.some(task => 'steps' in task),
    false,
  );

  api.setPermissions(['outreach']);
  response = await api.request('/history');
  assert.deepEqual(
    response.payload.tasks.map(task => task.id),
    [writing.id],
  );

  api.setPermissions([]);
  response = await api.request('/history');
  assert.deepEqual(response.payload.tasks, []);
});

test('history requires login and rejects unsupported methods', async () => {
  const api = fixture();

  const unsupported = await api.request('/history', 'POST', {});
  assert.equal(unsupported.status, 405);

  api.setSession(null);
  const unauthenticated = await api.request('/history');
  assert.equal(unauthenticated.status, 401);
});

test('deletion checks the version and removes the task from history', async () => {
  const api = fixture();
  const task = await api.create();

  const stale = await api.request(`/tasks/${task.id}/delete`, 'POST', {
    version: task.version + 1,
  });
  assert.equal(stale.status, 409);

  const deleted = await api.request(`/tasks/${task.id}/delete`, 'POST', {
    version: task.version,
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.payload.deletedId, task.id);

  assert.equal((await api.request(`/tasks/${task.id}`)).status, 404);
  assert.deepEqual((await api.request('/history')).payload.tasks, []);

  assert.equal((await api.request(`/tasks/${task.id}/delete`, 'POST', {
    version: task.version,
  })).status, 404);
});

test('deletion requires CSRF, ownership and current permissions', async () => {
  const api = fixture();
  const task = await api.create();
  const path = `/tasks/${task.id}/delete`;
  const body = { version: task.version };

  api.setCsrf(false);
  assert.equal((await api.request(path, 'POST', body)).status, 403);

  api.setCsrf(true);
  api.setSession({ username: 'another-admin' });
  assert.equal((await api.request(path, 'POST', body)).status, 404);

  api.setSession({ username: 'synthetic-admin' });
  api.setPermissions([]);
  assert.equal((await api.request(path, 'POST', body)).status, 403);

  api.setPermissions(['events']);
  assert.equal((await api.request(`/tasks/${task.id}`)).status, 200);
});

test('a generating task cannot be deleted', async () => {
  let release;
  const pending = new Promise(resolve => {
    release = resolve;
  });
  const mock = createMockAgentModel();
  const api = fixture({
    model: {
      provider: 'mock',
      async generate(options) {
        await pending;
        return mock.generate(options);
      },
    },
  });

  const task = await api.create();
  const options = {
    actor: 'synthetic-admin',
    permissions: ['events'],
    id: task.id,
    version: task.version,
  };

  const generating = api.service.generate(options);

  try {
    const response = await api.request(
      `/tasks/${task.id}/delete`,
      'POST',
      { version: task.version },
    );
    assert.equal(response.status, 409);
    assert.equal(response.payload.code, 'agent_task_busy');
  } finally {
    release();
    await generating;
  }
});

test('writing draft API enforces confirmation, ownership, CSRF and version', async () => {
  const api = fixture();
  let task = await api.create('writing');
  const path = `/tasks/${task.id}/writing-draft`;
  const draft = {
    title: '合成推文标题',
    body: '合成正文',
    sourceNotes: '内部备注',
  };

  const early = await api.request(path, 'POST', {
    version: task.version,
    draft,
  });
  assert.equal(early.status, 409);

  while (task.steps.find(step => step.id === 'draft')
    .status !== 'confirmed') {
    const generated = await api.request(
      `/tasks/${task.id}/generate`,
      'POST',
      { version: task.version },
    );
    assert.equal(generated.status, 200);
    task = generated.payload.task;

    const active = getActiveAgentStep(task);
    const confirmed = await api.request(
      `/tasks/${task.id}/confirm`,
      'POST',
      { version: task.version, stepId: active.id },
    );
    assert.equal(confirmed.status, 200);
    task = confirmed.payload.task;
  }

  api.setCsrf(false);
  assert.equal((await api.request(path, 'POST', {
    version: task.version,
    draft,
  })).status, 403);

  api.setCsrf(true);
  api.setSession({ username: 'another-admin' });
  assert.equal((await api.request(path, 'POST', {
    version: task.version,
    draft,
  })).status, 404);

  api.setSession({ username: 'synthetic-admin' });
  assert.equal((await api.request(path, 'POST', {
    version: task.version,
    draft: { title: '', body: '' },
  })).status, 400);

  const saved = await api.request(path, 'POST', {
    version: task.version,
    draft,
  });

  assert.equal(saved.status, 200);
  assert.equal(saved.payload.task.writingDraft.body, '合成正文');
  assert.equal(saved.payload.task.writingDraft.sourceNotes, '内部备注');

  const stale = await api.request(path, 'POST', {
    version: task.version,
    draft,
  });
  assert.equal(stale.status, 409);
});

test('design draft API enforces confirmation, permissions, CSRF and version', async () => {
  const api = fixture();
  let task = await api.create('design');
  const path = `/tasks/${task.id}/design-draft`;
  const draft = {
    title: '合成方案',
    audience: '新生',
    headline: '合成标题',
    body: '合成正文',
    palette: 'blue',
    layout: 'announcement',
    reviewNotes: '内部备注',
  };

  assert.equal((await api.request(path, 'POST', {
    version: task.version,
    draft,
  })).status, 409);

  while (task.steps.find(step => step.id === 'preview')
    .status !== 'confirmed') {
    const generated = await api.request(
      `/tasks/${task.id}/generate`,
      'POST',
      { version: task.version },
    );
    assert.equal(generated.status, 200);
    task = generated.payload.task;

    const active = getActiveAgentStep(task);
    const confirmed = await api.request(
      `/tasks/${task.id}/confirm`,
      'POST',
      { version: task.version, stepId: active.id },
    );
    assert.equal(confirmed.status, 200);
    task = confirmed.payload.task;
  }

  api.setCsrf(false);
  assert.equal((await api.request(path, 'POST', {
    version: task.version,
    draft,
  })).status, 403);

  api.setCsrf(true);
  api.setSession({ username: 'another-admin' });
  assert.equal((await api.request(path, 'POST', {
    version: task.version,
    draft,
  })).status, 404);

  api.setSession({ username: 'synthetic-admin' });
  api.setPermissions(['events']);
  assert.equal((await api.request(path, 'POST', {
    version: task.version,
    draft,
  })).status, 403);

  api.setPermissions(['outreach']);
  assert.equal((await api.request(path, 'POST', {
    version: task.version,
    draft: { ...draft, palette: 'custom-css' },
  })).status, 400);

  const saved = await api.request(path, 'POST', {
    version: task.version,
    draft,
  });

  assert.equal(saved.status, 200);
  assert.equal(saved.payload.task.designDraft.palette, 'blue');
  assert.equal(saved.payload.task.designDraft.reviewNotes, '内部备注');

  assert.equal((await api.request(path, 'POST', {
    version: task.version,
    draft,
  })).status, 409);
});

test('model status exposes only the provider and simulation flag', async () => {
  const api = fixture();
  api.setPermissions([]);

  const response = await api.request('/status');
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, {
    ok: true,
    provider: 'mock',
    simulated: true,
  });

  assert.equal(
    (await api.request('/status', 'POST', {})).status,
    405,
  );

  api.setSession(null);
  assert.equal((await api.request('/status')).status, 401);
});

test('safe model failures retain their status and leave the task unchanged', async () => {
  for (const [statusCode, code, message] of [
    [504, 'agent_model_timeout', '模型请求超时，已有内容仍保留，请稍后重试'],
    [502, 'agent_model_auth', '模型服务认证失败，请检查服务端配置'],
    [429, 'agent_model_rate_limit', '模型服务暂时繁忙或额度不足，请稍后重试'],
  ]) {
    const api = fixture({
      model: {
        provider: 'deepseek',
        async generate() {
          throw new AgentModelError(statusCode, code, message);
        },
      },
    });

    const task = await api.create();
    const response = await api.request(
      `/tasks/${task.id}/generate`,
      'POST',
      { version: task.version },
    );

    assert.equal(response.status, statusCode);
    assert.equal(response.payload.code, code);
    assert.equal(response.payload.message, message);

    const preserved = await api.request(`/tasks/${task.id}`);
    assert.deepEqual(preserved.payload.task, task);
  }
});

test('generation updates its source when a mock task switches to DeepSeek', async () => {
  const model = {
    provider: 'mock',
    async generate() {
      return {
        output: {
          title: '合成真实模型结果',
          summary: '合成说明',
          items: ['合成建议'],
        },
      };
    },
  };

  const api = fixture({ model });
  const task = await api.create();

  assert.equal(task.simulated, true);

  model.provider = 'deepseek';

  const response = await api.request(
    `/tasks/${task.id}/generate`,
    'POST',
    { version: task.version },
  );

  assert.equal(response.status, 200);
  assert.equal(response.payload.task.provider, 'deepseek');
  assert.equal(response.payload.task.simulated, false);
  assert.equal(response.payload.task.steps[0].provider, 'deepseek');
  assert.equal(response.payload.task.steps[0].simulated, false);

  assert.deepEqual((await api.request('/status')).payload, {
    ok: true,
    provider: 'deepseek',
    simulated: false,
  });
});

async function prepareSavedRevisionTask(api) {
  let task = await api.create('writing');

  while (task.status !== 'draft_ready') {
    const generated = await api.request(
      `/tasks/${task.id}/generate`,
      'POST',
      { version: task.version },
    );
    assert.equal(generated.status, 200);
    task = generated.payload.task;

    const active = getActiveAgentStep(task);
    const confirmed = await api.request(
      `/tasks/${task.id}/confirm`,
      'POST',
      { version: task.version, stepId: active.id },
    );
    assert.equal(confirmed.status, 200);
    task = confirmed.payload.task;
  }

  const saved = await api.request(
    `/tasks/${task.id}/writing-draft`,
    'POST',
    {
      version: task.version,
      draft: {
        title: '原标题',
        body: '原正文',
        sourceNotes: '原核对备注',
      },
    },
  );
  assert.equal(saved.status, 200);
  return saved.payload.task;
}

test('draft revision API protects ownership, CSRF and versions while preserving saved content', async () => {
  const api = fixture();
  const task = await prepareSavedRevisionTask(api);
  const path = `/tasks/${task.id}/revise-draft`;
  const body = {
    version: task.version,
    fields: ['title'],
    instruction: '只改标题',
  };

  api.setCsrf(false);
  assert.equal((await api.request(path, 'POST', body)).status, 403);

  api.setCsrf(true);
  api.setSession({ username: 'another-admin' });
  assert.equal((await api.request(path, 'POST', body)).status, 404);

  api.setSession({ username: 'synthetic-admin' });
  assert.equal((await api.request(path, 'POST', {
    ...body,
    fields: [],
  })).status, 400);

  const response = await api.request(path, 'POST', body);
  assert.equal(response.status, 200);

  const proposed = response.payload.task;
  assert.deepEqual(proposed.writingDraft, task.writingDraft);
  assert.deepEqual(proposed.steps, task.steps);
  assert.equal(proposed.status, task.status);
  assert.equal(
    proposed.draftRevisionProposal.draft.title,
    '原标题（模拟修改）',
  );

  assert.equal((await api.request(path, 'POST', body)).status, 409);
});

test('model timeouts during revision preserve the saved draft and task version', async () => {
  const mock = createMockAgentModel();
  const api = fixture({
    model: {
      provider: 'mock',
      async generate(input) {
        if (input.task.draftRevision) {
          throw new AgentModelError(
            504,
            'agent_model_timeout',
            '模型请求超时，已有内容仍保留，请稍后重试',
          );
        }
        return mock.generate(input);
      },
    },
  });

  const task = await prepareSavedRevisionTask(api);

  const response = await api.request(
    `/tasks/${task.id}/revise-draft`,
    'POST',
    {
      version: task.version,
      fields: ['title'],
      instruction: '只改标题',
    },
  );

  assert.equal(response.status, 504);
  assert.equal(response.payload.code, 'agent_model_timeout');

  assert.deepEqual(
    (await api.request(`/tasks/${task.id}`)).payload.task,
    task,
  );
});