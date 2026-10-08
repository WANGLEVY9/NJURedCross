import { inspectEvidenceReferences } from './evidence-inspection.js';

const photoIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function unavailable() {
  return Object.assign(
    new Error('照片清理预览输入无法确认，已停止预览。'),
    { statusCode: 503, code: 'evidence_cleanup_preview_unavailable' },
  );
}

/**
 * Build review candidates only. Never authorize or perform deletion.
 * Reference completeness is supplied by the caller, not independently proven.
 */
export function previewEvidenceCleanup({
  registrations,
  referencesComplete,
  files,
  nowMs,
  minAgeMs,
} = {}) {
  if (
    referencesComplete !== true
    || !Array.isArray(files)
    || files.length > 100000
    || !Number.isSafeInteger(nowMs)
    || nowMs < 0
    || !Number.isSafeInteger(minAgeMs)
    || minAgeMs <= 0
  ) {
    throw unavailable();
  }

  const names = new Set();

  for (const file of files) {
    if (
      !file
      || typeof file !== 'object'
      || Array.isArray(file)
      || typeof file.name !== 'string'
      || !file.name
      || file.name.length > 255
      || /[/\\\u0000-\u001f\u007f]/.test(file.name)
      || ['.', '..'].includes(file.name)
      || names.has(file.name)
      || typeof file.isRegularFile !== 'boolean'
      || !Number.isSafeInteger(file.size)
      || file.size < 0
      || !Number.isFinite(file.mtimeMs)
      || file.mtimeMs < 0
      || !Number.isSafeInteger(file.nlink)
      || file.nlink < 1
    ) {
      throw unavailable();
    }

    names.add(file.name);
  }

  const references = inspectEvidenceReferences(
    registrations,
    files.filter(file => file.isRegularFile).map(file => file.name),
  );

  const unreferenced = new Set(references.unreferenced);
  const reviewCandidates = [];
  const retained = [];

  for (const file of files) {
    let reason;

    if (!photoIdPattern.test(file.name)) {
      reason = 'unrecognized_name';
    } else if (!file.isRegularFile) {
      reason = 'non_regular_file';
    } else if (file.nlink !== 1) {
      reason = 'linked_file';
    } else if (!unreferenced.has(file.name)) {
      reason = 'referenced';
    } else if (file.mtimeMs > nowMs) {
      reason = 'future_timestamp';
    } else if (nowMs - file.mtimeMs < minAgeMs) {
      reason = 'too_recent';
    }

    if (reason) {
      retained.push({ name: file.name, reason });
    } else {
      reviewCandidates.push({
        id: file.name,
        bytes: file.size,
        ageMs: nowMs - file.mtimeMs,
      });
    }
  }

  reviewCandidates.sort((a, b) => a.id.localeCompare(b.id));
  retained.sort((a, b) => a.name.localeCompare(b.name));

  return {
    mode: 'read-only-preview',
    writes: 0,
    deletes: 0,
    deletionAuthorized: false,
    atomicSnapshot: false,
    referenceCompleteness: 'caller-supplied',
    policy: { nowMs, minAgeMs },
    counts: {
      files: files.length,
      reviewCandidates: reviewCandidates.length,
      retained: retained.length,
      missingReferences: references.missing.length,
    },
    reviewCandidates,
    retained,
    missingReferences: references.missing,
  };
}