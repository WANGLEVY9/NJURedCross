import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentContextQueries,
  readAgentBusinessContext,
} from '../lib/agent/business-context.js';

const event = {
  title: '合成急救活动',
  detail: '合成地点 · 已归档',
  view: 'activities',
  target: { kind: 'event', id: 'synthetic-event' },
};

test('briefs produce bounded search keywords', () => {
  assert.deepEqual(
    agentContextQueries('面向新生开展急救和AED培训'),
    ['急救', 'AED'],
  );
  assert.ok(agentContextQueries('合成主题，合成需求').length <= 2);
});

test('search receives only permitted business scopes', async () => {
  const calls = [];

  const result = await readAgentBusinessContext({
    brief: '急救活动',
    permissions: ['events', 'community'],
    search: async (query, scopes) => {
      calls.push({ query, scopes });
      return { ok: true, items: [event] };
    },
  });

  assert.deepEqual(calls, [{
    query: '急救',
    scopes: ['events'],
  }]);
  assert.equal(result.items[0].source, '活动记录');
});

test('no permitted source means no business reads', async () => {
  let calls = 0;

  const result = await readAgentBusinessContext({
    brief: '急救活动',
    permissions: [],
    search: async () => { calls++; },
  });

  assert.equal(calls, 0);
  assert.deepEqual(result.items, []);
});

test('failed queries preserve other results and report unavailable sources', async () => {
  const result = await readAgentBusinessContext({
    brief: '急救与AED',
    permissions: ['events'],
    search: async query => {
      if (query === 'AED') throw new Error('synthetic failure');
      return { ok: true, items: [event], truncated: true };
    },
  });

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.unavailable, ['events']);
  assert.equal(result.truncated, true);
});

test('records are deduplicated and unsupported or unauthorized records excluded', async () => {
  const inventory = {
    title: '合成教具',
    view: 'materials',
    target: { kind: 'inventory', id: 'synthetic-asset' },
  };
  const application = {
    title: '合成借用申请',
    view: 'materials',
    target: { kind: 'application', id: 'synthetic-application' },
  };

  const result = await readAgentBusinessContext({
    brief: '急救与AED',
    permissions: ['events'],
    search: async () => ({
      ok: true,
      items: [event, event, inventory, application],
    }),
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].target.id, 'synthetic-event');
});

test('oversized result sets are bounded and marked incomplete', async () => {
  const result = await readAgentBusinessContext({
    brief: '急救活动',
    permissions: ['events'],
    search: async () => ({
      ok: true,
      items: Array.from({ length: 12 }, (_, index) => ({
        ...event,
        target: { kind: 'event', id: `synthetic-${index}` },
      })),
    }),
  });

  assert.equal(result.items.length, 8);
  assert.equal(result.truncated, true);
});