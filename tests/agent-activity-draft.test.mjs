import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyAgentActivityDraft,
  validateAgentActivityDraft,
  agentActivitySeed,
} from '../public/app/shared/agent-activity-draft.js';

function validDraft() {
  return {
    ...emptyAgentActivityDraft(),
    name: '合成急救知识活动',
    category: '急救培训',
    center: '生命中心',
    date: '2026-11-01',
    startTime: '09:00',
    endTime: '11:30',
    location: '合成地点',
    content: '合成活动内容',
    work: '合成岗位工作',
    capacity: 20,
    registrationLimit: 30,
    trainingHours: 0,
    travelHours: 0,
  };
}

test('empty drafts report missing information without inventing it', () => {
  const result = validateAgentActivityDraft(emptyAgentActivityDraft());
  assert.equal(result.valid, false);
  assert.equal(result.draft.name, '');
  assert.equal(result.draft.capacity, '');
  assert.ok(result.issues.date);
  assert.ok(result.issues.capacity);
});

test('valid drafts calculate service hours from the selected period', () => {
  const seed = agentActivitySeed(validDraft());
  assert.equal(seed.serviceHours, 2.5);
  assert.equal(seed.slot, '09:00-11:30');
  assert.equal(seed.trainingHours, 0);
});

test('invalid calendar dates and time periods are rejected', () => {
  for (const date of ['2026-02-30', '2026-13-01', '待定']) {
    assert.ok(validateAgentActivityDraft({
      ...validDraft(),
      date,
    }).issues.date);
  }

  for (const [startTime, endTime] of [
    ['09:15', '11:00'],
    ['11:00', '09:00'],
    ['09:00', '09:00'],
  ]) {
    assert.ok(validateAgentActivityDraft({
      ...validDraft(),
      startTime,
      endTime,
    }).issues.startTime);
  }
});

test('capacity and hours must meet the form constraints', () => {
  assert.ok(validateAgentActivityDraft({
    ...validDraft(),
    capacity: 1.5,
  }).issues.capacity);

  assert.ok(validateAgentActivityDraft({
    ...validDraft(),
    registrationLimit: 10,
  }).issues.registrationLimit);

  assert.ok(validateAgentActivityDraft({
    ...validDraft(),
    trainingHours: -1,
  }).issues.trainingHours);

  assert.ok(validateAgentActivityDraft({
    ...validDraft(),
    travelHours: '',
  }).issues.travelHours);
});

test('business authority fields are never included in the form seed', () => {
  const seed = agentActivitySeed({
    ...validDraft(),
    actor: 'another-admin',
    coOwners: ['another-admin'],
    submit: true,
    status: '已审批',
    templateId: 'blood_vehicle',
  });

  for (const key of ['actor', 'coOwners', 'submit', 'status', 'templateId']) {
    assert.equal(Object.hasOwn(seed, key), false);
  }
});

test('invalid configurations cannot produce a form seed', () => {
  assert.throws(() => agentActivitySeed(emptyAgentActivityDraft()));
  assert.throws(() => validateAgentActivityDraft(null));
});