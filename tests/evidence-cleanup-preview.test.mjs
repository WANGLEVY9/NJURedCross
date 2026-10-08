import test from 'node:test';
import assert from 'node:assert/strict';
import { previewEvidenceCleanup } from '../lib/events/evidence-cleanup-preview.js';

const nowMs = 100000;
const minAgeMs = 1000;

function photoId(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}

function file(number, changes = {}) {
  return {
    name: photoId(number),
    isRegularFile: true,
    size: 100,
    mtimeMs: nowMs - 5000,
    nlink: 1,
    ...changes,
  };
}

function preview(changes = {}) {
  return previewEvidenceCleanup({
    registrations: [],
    referencesComplete: true,
    files: [],
    nowMs,
    minAgeMs,
    ...changes,
  });
}

function unavailable(error) {
  return error.code === 'evidence_cleanup_preview_unavailable';
}

test('empty input produces a read-only preview with no deletion authority', () => {
  const result = preview();

  assert.equal(result.writes, 0);
  assert.equal(result.deletes, 0);
  assert.equal(result.deletionAuthorized, false);
  assert.equal(result.atomicSnapshot, false);
  assert.deepEqual(result.counts, {
    files: 0,
    reviewCandidates: 0,
    retained: 0,
    missingReferences: 0,
  });
});

test('old unreferenced regular files are review candidates only', () => {
  const result = preview({ files: [file(1)] });

  assert.deepEqual(result.reviewCandidates, [{
    id: photoId(1),
    bytes: 100,
    ageMs: 5000,
  }]);
  assert.equal(result.deletionAuthorized, false);
});

test('referenced photos are retained regardless of age', () => {
  const result = preview({
    registrations: [{ 签到照片ID: photoId(1) }],
    files: [file(1)],
  });

  assert.equal(result.reviewCandidates.length, 0);
  assert.deepEqual(result.retained, [{
    name: photoId(1),
    reason: 'referenced',
  }]);
});

test('recent files are retained while the exact age boundary is eligible for review', () => {
  const result = preview({
    files: [
      file(1, { mtimeMs: nowMs - minAgeMs + 1 }),
      file(2, { mtimeMs: nowMs - minAgeMs }),
    ],
  });

  assert.deepEqual(result.retained, [{
    name: photoId(1),
    reason: 'too_recent',
  }]);
  assert.equal(result.reviewCandidates[0].id, photoId(2));
});

test('future timestamps cannot become cleanup candidates', () => {
  const result = preview({
    files: [file(1, { mtimeMs: nowMs + 1 })],
  });

  assert.equal(result.reviewCandidates.length, 0);
  assert.equal(result.retained[0].reason, 'future_timestamp');
});

test('non-regular and multiply linked files are retained', () => {
  const result = preview({
    files: [
      file(1, { isRegularFile: false }),
      file(2, { nlink: 2 }),
    ],
  });

  assert.equal(result.reviewCandidates.length, 0);
  assert.deepEqual(result.retained.map(item => item.reason), [
    'non_regular_file',
    'linked_file',
  ]);
});

test('unrecognized names cannot become cleanup candidates', () => {
  const result = preview({
    files: [file(1, { name: 'unknown-file.txt' })],
  });

  assert.equal(result.reviewCandidates.length, 0);
  assert.equal(result.retained[0].reason, 'unrecognized_name');
});

test('missing referenced photos are reported without authorizing deletion', () => {
  const result = preview({
    registrations: [{ 签到照片ID: photoId(1) }],
    files: [file(2)],
  });

  assert.deepEqual(result.missingReferences, [photoId(1)]);
  assert.equal(result.counts.missingReferences, 1);
  assert.equal(result.deletionAuthorized, false);
});

test('an explicit completeness declaration is required', () => {
  for (const referencesComplete of [undefined, false, 'true']) {
    assert.throws(
      () => preview({ referencesComplete }),
      unavailable,
    );
  }
});

test('explicitly truncated registrations stop the preview', () => {
  const registrations = [];
  registrations.readMeta = { truncated: true };

  assert.throws(
    () => preview({ registrations, files: [file(1)] }),
    error => error.code === 'incomplete_operational_data',
  );
});

test('invalid metadata and duplicate filenames stop the preview', () => {
  for (const files of [
    [null],
    [file(1), file(1)],
    [file(1, { name: '../outside' })],
    [file(1, { name: 'bad\u0000name' })],
    [file(1, { size: -1 })],
    [file(1, { size: Infinity })],
    [file(1, { mtimeMs: NaN })],
    [file(1, { nlink: 0 })],
    [file(1, { isRegularFile: 'true' })],
  ]) {
    assert.throws(() => preview({ files }), unavailable);
  }

  for (const changes of [
    { nowMs: NaN },
    { minAgeMs: 0 },
    { minAgeMs: -1 },
    { files: null },
  ]) {
    assert.throws(() => preview(changes), unavailable);
  }
});

test('preview preserves input data and sorts candidate IDs', () => {
  const files = Object.freeze([
    Object.freeze(file(2)),
    Object.freeze(file(1)),
  ]);
  const registrations = Object.freeze([]);
  const before = JSON.stringify({ files, registrations });

  const result = preview({ files, registrations });

  assert.deepEqual(
    result.reviewCandidates.map(item => item.id),
    [photoId(1), photoId(2)],
  );
  assert.equal(JSON.stringify({ files, registrations }), before);
});