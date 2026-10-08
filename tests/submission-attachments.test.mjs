import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBMISSION_ATTACHMENT_TABLE,
  SUBMISSION_ATTACHMENT_COLUMNS,
  ATTACHMENT_PROVIDER_ALIYUN_OSS,
  ATTACHMENT_STATUS,
  attachmentIdentifier,
  attachmentRow,
  attachmentFromRow,
  formatAttachmentRefs,
  parseAttachmentRefs,
} from '../lib/attachment/store.js';

test('attachment table contract stays stable', () => {
  assert.equal(SUBMISSION_ATTACHMENT_TABLE, '投稿附件表');
  assert.equal(SUBMISSION_ATTACHMENT_COLUMNS.length, 13);
  assert.equal(new Set(SUBMISSION_ATTACHMENT_COLUMNS).size, SUBMISSION_ATTACHMENT_COLUMNS.length);
});

test('attachment identifiers are prefixed, unique and uppercase-safe', () => {
  const seen = new Set();
  for (let index = 0; index < 200; index += 1) {
    const id = attachmentIdentifier();
    assert.match(id, /^ATT-[0-9A-Z]+-[0-9A-F]{6}$/);
    assert.ok(!seen.has(id));
    seen.add(id);
  }
});

test('attachmentRow covers every declared column and round-trips', () => {
  const attachment = {
    id: 'ATT-TEST-01',
    submissionId: 'SUB-TEST-01',
    filename: '现场照片.jpg',
    mimeType: 'image/jpeg',
    size: 2048,
    checksum: 'A'.repeat(64),
    provider: ATTACHMENT_PROVIDER_ALIYUN_OSS,
    bucket: 'nju-rc-submissions',
    objectKey: 'submissions/2026/ATT-TEST-01/abc.jpg',
    status: ATTACHMENT_STATUS.uploaded,
    uploader: '251880207@smail.nju.edu.cn',
    uploadedAt: '2026-10-05T12:00:00.000Z',
    boundAt: '2026-10-05T12:05:00.000Z',
  };
  const row = attachmentRow(attachment);
  assert.deepEqual(Object.keys(row).sort(), [...SUBMISSION_ATTACHMENT_COLUMNS].sort());
  assert.equal(row['大小'], '2048');
  assert.equal(row['校验和'], 'a'.repeat(64));
  const restored = attachmentFromRow(row);
  assert.deepEqual(restored, { ...attachment, checksum: 'a'.repeat(64) });
});

test('attachmentFromRow tolerates legacy rows and normalizes defaults', () => {
  const restored = attachmentFromRow({ 附件ID: 'ATT-LEGACY-01' });
  assert.equal(restored.id, 'ATT-LEGACY-01');
  assert.equal(restored.size, 0);
  assert.equal(restored.provider, ATTACHMENT_PROVIDER_ALIYUN_OSS);
  assert.equal(restored.status, ATTACHMENT_STATUS.pending);
  assert.deepEqual(attachmentFromRow(null), {
    id: '', submissionId: '', filename: '', mimeType: '', size: 0, checksum: '',
    provider: ATTACHMENT_PROVIDER_ALIYUN_OSS, bucket: '', objectKey: '',
    status: ATTACHMENT_STATUS.pending, uploader: '', uploadedAt: '', boundAt: '',
  });
});

test('attachment refs encode and decode with legacy fallbacks', () => {
  assert.equal(formatAttachmentRefs([]), '[]');
  assert.equal(formatAttachmentRefs(['ATT-A', 'ATT-A', ' ATT-B ', '']), '["ATT-A","ATT-B"]');
  assert.deepEqual(parseAttachmentRefs(''), []);
  assert.deepEqual(parseAttachmentRefs(null), []);
  assert.deepEqual(parseAttachmentRefs('not-json'), []);
  assert.deepEqual(parseAttachmentRefs('{"a":1}'), []);
  assert.deepEqual(parseAttachmentRefs('["ATT-A","ATT-A",42,""]'), ['ATT-A']);
  assert.deepEqual(parseAttachmentRefs(formatAttachmentRefs(['ATT-A', 'ATT-B'])), ['ATT-A', 'ATT-B']);
});
