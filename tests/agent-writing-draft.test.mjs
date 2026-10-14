import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyAgentWritingDraft,
  validateAgentWritingDraft,
  agentWritingDraft,
  agentWritingText,
} from '../public/app/shared/agent-writing-draft.js';

function validDraft() {
  return {
    title: '合成活动推文',
    lead: '合成导语',
    body: '第一段合成正文。\n\n第二段合成正文。',
    closing: '合成报名提示',
    sourceNotes: '内部核对备注，不应进入对外正文',
  };
}

test('empty drafts require a title and body without inventing content', () => {
  const result = validateAgentWritingDraft(emptyAgentWritingDraft());

  assert.equal(result.valid, false);
  assert.ok(result.issues.title);
  assert.ok(result.issues.body);
  assert.equal(result.draft.body, '');
});

test('drafts preserve paragraphs and normalize line endings', () => {
  const result = agentWritingDraft({
    ...validDraft(),
    body: ' 第一段。\r\n\r\n第二段。\r第三段。 ',
  });

  assert.equal(result.body, '第一段。\n\n第二段。\n第三段。');
});

test('copy text includes public content and excludes internal notes', () => {
  assert.equal(
    agentWritingText(validDraft()),
    '合成活动推文\n\n合成导语\n\n第一段合成正文。\n\n第二段合成正文。\n\n合成报名提示',
  );

  assert.equal(
    agentWritingText(validDraft()).includes('内部核对备注'),
    false,
  );

  assert.equal(
    agentWritingText({
      title: '只有标题和正文',
      body: '合成正文',
    }),
    '只有标题和正文\n\n合成正文',
  );
});

test('invalid types and excessive lengths are rejected', () => {
  assert.throws(() => validateAgentWritingDraft(null));
  assert.throws(() => validateAgentWritingDraft([]));

  assert.ok(validateAgentWritingDraft({
    ...validDraft(),
    title: '字'.repeat(101),
  }).issues.title);

  assert.ok(validateAgentWritingDraft({
    ...validDraft(),
    body: '字'.repeat(20001),
  }).issues.body);

  assert.ok(validateAgentWritingDraft({
    ...validDraft(),
    sourceNotes: {},
  }).issues.sourceNotes);
});

test('publication instructions and account fields are excluded', () => {
  const result = agentWritingDraft({
    ...validDraft(),
    publish: true,
    channel: '外部渠道',
    actor: 'another-admin',
    approved: true,
  });

  assert.deepEqual(Object.keys(result).sort(), [
    'title',
    'lead',
    'body',
    'closing',
    'sourceNotes',
  ].sort());

  assert.throws(() => agentWritingText(emptyAgentWritingDraft()));
});