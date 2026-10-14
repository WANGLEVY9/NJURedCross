import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAgentDraftCandidate,
  assessAgentDraftCandidate,
} from '../public/app/shared/agent-draft-candidate.js';

test('incomplete activity candidates retain missing facts without inventing them', () => {
  const result = assessAgentDraftCandidate('activity', {
    name: '合成活动建议',
  });

  assert.equal(result.complete, false);
  assert.equal(result.draft.region, '');
  assert.equal(result.draft.date, '');
  assert.equal(result.draft.capacity, '');
  assert.ok(result.issues.date);
  assert.ok(result.issues.capacity);
});

test('numeric fields normalize valid values and preserve explicit zero hours', () => {
  const draft = normalizeAgentDraftCandidate('activity', {
    capacity: '20',
    registrationLimit: 30,
    trainingHours: 0,
    travelHours: null,
  });

  assert.equal(draft.capacity, 20);
  assert.equal(draft.registrationLimit, 30);
  assert.equal(draft.trainingHours, 0);
  assert.equal(draft.travelHours, '');
});

test('writing candidates preserve paragraphs and report missing required content', () => {
  const result = assessAgentDraftCandidate('writing', {
    title: ' 合成标题 ',
    lead: '第一行。\r\n第二行。',
  });

  assert.equal(result.draft.title, '合成标题');
  assert.equal(result.draft.lead, '第一行。\n第二行。');
  assert.equal(result.complete, false);
  assert.ok(result.issues.body);
});

test('design candidates accept supported style suggestions', () => {
  const result = assessAgentDraftCandidate('design', {
    title: '合成方案',
    audience: '新生',
    headline: '合成标题',
    body: '合成正文',
    palette: 'green',
    layout: 'announcement',
  });

  assert.equal(result.complete, true);
  assert.equal(result.draft.palette, 'green');
});

test('authority fields and arbitrary rendering instructions are rejected', () => {
  for (const [mode, input] of [
    ['activity', { coOwners: ['another-admin'] }],
    ['activity', { submit: true }],
    ['writing', { publish: true }],
    ['design', { html: '<script>test</script>' }],
    ['design', { imageUrl: 'https://example.com/image' }],
  ]) {
    assert.throws(() => normalizeAgentDraftCandidate(mode, input));
  }
});

test('invalid field types, numeric ranges and unsupported options are rejected', () => {
  for (const input of [
    { capacity: -1 },
    { capacity: 1.5 },
    { capacity: true },
    { trainingHours: '待确认' },
    { startTime: '09:15' },
    { region: '未知地区' },
  ]) {
    assert.throws(() => normalizeAgentDraftCandidate('activity', input));
  }

  assert.throws(() => normalizeAgentDraftCandidate('writing', {
    title: '字'.repeat(101),
  }));

  assert.throws(() => normalizeAgentDraftCandidate('design', {
    palette: 'custom-css',
  }));

  assert.throws(() => normalizeAgentDraftCandidate('writing', []));
});

test('normalization does not mutate its input and unsupported modes fail', () => {
  const input = { title: '合成标题', body: '合成正文' };
  const before = structuredClone(input);

  const result = normalizeAgentDraftCandidate('writing', input);
  result.title = '修改副本';

  assert.deepEqual(input, before);
  assert.throws(() => normalizeAgentDraftCandidate('unknown', {}));
});