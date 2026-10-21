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
  // v3.1：13 列 → 15 列，新增「中心」「活动名」，用于按部门三级归位。
  assert.equal(SUBMISSION_ATTACHMENT_COLUMNS.length, 15);
  assert.equal(new Set(SUBMISSION_ATTACHMENT_COLUMNS).size, SUBMISSION_ATTACHMENT_COLUMNS.length);
  assert.ok(SUBMISSION_ATTACHMENT_COLUMNS.includes('中心'), '缺存储归位列「中心」');
  assert.ok(SUBMISSION_ATTACHMENT_COLUMNS.includes('活动名'), '缺存储归位列「活动名」');
});

test('attachment identifiers remain unique within one millisecond and uppercase-safe', (t) => {
  t.mock.method(Date, 'now', () => 1792555200000);
  const seen = new Set();
  for (let index = 0; index < 200; index += 1) {
    const id = attachmentIdentifier();
    assert.match(id, /^ATT-[0-9A-Z]+-[0-9A-F]{24}$/);
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
    center: '博爱中心',
    activity: '急救培训 AED',
  };
  const row = attachmentRow(attachment);
  assert.deepEqual(Object.keys(row).sort(), [...SUBMISSION_ATTACHMENT_COLUMNS].sort());
  assert.equal(row['大小'], '2048');
  assert.equal(row['校验和'], 'a'.repeat(64));
  assert.equal(row['中心'], '博爱中心');
  assert.equal(row['活动名'], '急救培训 AED');
  const restored = attachmentFromRow(row);
  assert.deepEqual(restored, { ...attachment, checksum: 'a'.repeat(64) });
});

test('attachmentFromRow tolerates legacy rows and normalizes defaults', () => {
  const restored = attachmentFromRow({ 附件ID: 'ATT-LEGACY-01' });
  assert.equal(restored.id, 'ATT-LEGACY-01');
  assert.equal(restored.size, 0);
  assert.equal(restored.provider, ATTACHMENT_PROVIDER_ALIYUN_OSS);
  assert.equal(restored.status, ATTACHMENT_STATUS.pending);
  assert.equal(restored.center, '', '旧行缺「中心」列回落空串');
  assert.equal(restored.activity, '', '旧行缺「活动名」列回落空串');
  assert.deepEqual(attachmentFromRow(null), {
    id: '', submissionId: '', filename: '', mimeType: '', size: 0, checksum: '',
    provider: ATTACHMENT_PROVIDER_ALIYUN_OSS, bucket: '', objectKey: '',
    status: ATTACHMENT_STATUS.pending, uploader: '', uploadedAt: '', boundAt: '',
    center: '', activity: '',
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
