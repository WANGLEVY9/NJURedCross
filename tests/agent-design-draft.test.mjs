import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyAgentDesignDraft,
  validateAgentDesignDraft,
  agentDesignDraft,
} from '../public/app/shared/agent-design-draft.js';

function validDraft() {
  return {
    ...emptyAgentDesignDraft(),
    title: '合成美编方案',
    audience: '新生',
    headline: '合成主标题',
    introduction: '合成导语',
    body: '第一段合成正文。\n\n第二段合成正文。',
    footer: '合成页尾',
    imageNotes: '建议使用已获授权的活动照片',
    reviewNotes: '内部核对素材授权',
  };
}

test('empty schemes report missing fields without inventing content', () => {
  const result = validateAgentDesignDraft(emptyAgentDesignDraft());

  assert.equal(result.valid, false);
  assert.ok(result.issues.title);
  assert.ok(result.issues.audience);
  assert.ok(result.issues.headline);
  assert.ok(result.issues.body);
  assert.equal(result.draft.body, '');
});

test('valid schemes preserve content and normalize paragraph endings', () => {
  const result = agentDesignDraft({
    ...validDraft(),
    body: ' 第一段。\r\n\r\n第二段。 ',
  });

  assert.equal(result.body, '第一段。\n\n第二段。');
  assert.equal(result.palette, 'rose');
  assert.equal(result.layout, 'editorial');
});

test('unknown palettes and layouts are rejected', () => {
  assert.ok(validateAgentDesignDraft({
    ...validDraft(),
    palette: 'custom-css',
  }).issues.palette);

  assert.ok(validateAgentDesignDraft({
    ...validDraft(),
    layout: 'custom-html',
  }).issues.layout);
});

test('invalid types and excessive lengths are rejected', () => {
  assert.throws(() => validateAgentDesignDraft(null));
  assert.throws(() => validateAgentDesignDraft([]));

  assert.ok(validateAgentDesignDraft({
    ...validDraft(),
    headline: '字'.repeat(101),
  }).issues.headline);

  assert.ok(validateAgentDesignDraft({
    ...validDraft(),
    body: {},
  }).issues.body);

  assert.ok(validateAgentDesignDraft({
    ...validDraft(),
    body: '字'.repeat(10001),
  }).issues.body);
});

test('HTML strings stay as text and extra rendering instructions are excluded', () => {
  const result = agentDesignDraft({
    ...validDraft(),
    headline: '<img src=x onerror=alert(1)>',
    html: '<script>alert(1)</script>',
    css: 'body { display: none; }',
    imageUrl: 'https://example.com/private-image',
    publish: true,
  });

  assert.equal(result.headline, '<img src=x onerror=alert(1)>');

  for (const key of ['html', 'css', 'imageUrl', 'publish']) {
    assert.equal(Object.hasOwn(result, key), false);
  }

  assert.throws(() => agentDesignDraft(emptyAgentDesignDraft()));
});