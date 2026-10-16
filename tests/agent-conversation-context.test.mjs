import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTaskService } from '../lib/agent/task-service.js';
import { createMockAgentModel } from '../lib/agent/mock-model.js';
import { buildConversationMessages } from '../lib/agent/conversation-contract.js';

const access = {
  actor: 'synthetic-admin',
  permissions: ['events', 'materials'],
};

const context = {
  queries: ['急救'],
  checkedAt: '2026-10-14T00:00:00Z',
  items: [{
    id: 'inventory:synthetic-asset',
    title: '合成急救教具',
    detail: '当前 2',
    scope: 'materials',
    source: '物资台账',
    view: 'materials',
    target: { kind: 'inventory', id: 'synthetic-asset' },
  }],
  unavailable: [],
  truncated: true,
};

function fixture(readBusinessContext) {
  const mock = createMockAgentModel();
  const requests = [];

  const service = createAgentTaskService({
    readBusinessContext,
    model: {
      provider: 'mock',
      async generate(options) {
        requests.push(JSON.parse(
          buildConversationMessages(options)[1].content,
        ));
        return mock.generate(options);
      },
    },
  });

  const task = service.create({
    ...access,
    taskType: 'conversation',
    mode: 'activity',
    brief: '合成急救活动',
  });

  return { service, task, requests };
}

test('server reference information reaches the model and saved task', async () => {
  let received;
  const f = fixture(async options => {
    received = options;
    return structuredClone(context);
  });

  const saved = await f.service.generateConversation({
    ...access,
    id: f.task.id,
    version: f.task.version,
  });

  assert.deepEqual(received.permissions, access.permissions);
  assert.equal(f.requests[0].businessContext.items[0].source, '物资台账');
  assert.equal(saved.businessContext.items[0].title, '合成急救教具');
  assert.equal(saved.businessContext.truncated, true);
});

test('failed reads generate with explicit unavailable-source information', async () => {
  const f = fixture(async () => {
    throw new Error('synthetic read failure');
  });

  const saved = await f.service.generateConversation({
    ...access,
    id: f.task.id,
    version: f.task.version,
  });

  assert.equal(saved.status, 'awaiting_confirmation');
  assert.deepEqual(saved.businessContext.items, []);
  assert.deepEqual(saved.businessContext.unavailable, ['events', 'materials']);
});

test('revoked source permissions filter stored reference records', async () => {
  const f = fixture(async () => structuredClone(context));

  await f.service.generateConversation({
    ...access,
    id: f.task.id,
    version: f.task.version,
  });

  const filtered = f.service.get({
    ...access,
    permissions: ['events'],
    id: f.task.id,
  });

  assert.deepEqual(filtered.businessContext.items, []);
});