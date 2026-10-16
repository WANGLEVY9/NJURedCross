import test from 'node:test';
import assert from 'node:assert/strict';
import { agentActivityHandoff } from '../public/app/shared/agent-activity-handoff.js';

function task() {
  return {
    mode: 'activity',
    steps: [{ id: 'configuration', status: 'confirmed' }],
    activityDraft: {
      name: '合成活动',
      category: '急救培训',
      center: '',
      region: '南京活动',
      date: '2026-11-01',
      startTime: '09:00',
      endTime: '11:00',
      location: '合成地点',
      position: '',
      content: '合成内容',
      work: '合成工作',
      capacity: 20,
      registrationLimit: 30,
      trainingHours: 0,
      travelHours: 0,
    },
  };
}

test('confirmed saved configurations produce independent form seeds', () => {
  const source = task();
  const seed = agentActivityHandoff(source);

  assert.equal(seed.name, '合成活动');
  assert.equal(seed.serviceHours, 2);

  seed.name = '修改副本';
  assert.equal(source.activityDraft.name, '合成活动');
});

test('wrong modes, unconfirmed steps and missing configurations are rejected', () => {
  assert.throws(() => agentActivityHandoff({
    ...task(),
    mode: 'writing',
  }));

  assert.throws(() => agentActivityHandoff({
    ...task(),
    steps: [{ id: 'configuration', status: 'ready' }],
  }));

  assert.throws(() => agentActivityHandoff({
    ...task(),
    activityDraft: null,
  }));
});

test('invalid saved configurations cannot be handed over', () => {
  const source = task();
  source.activityDraft.date = '2026-02-30';
  assert.throws(() => agentActivityHandoff(source));
});

test('handoff excludes approval instructions and owner assignments', () => {
  const source = task();
  source.activityDraft.submit = true;
  source.activityDraft.coOwners = ['another-admin'];

  const seed = agentActivityHandoff(source);

  assert.equal(Object.hasOwn(seed, 'submit'), false);
  assert.equal(Object.hasOwn(seed, 'coOwners'), false);
});