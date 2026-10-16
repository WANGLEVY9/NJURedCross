import { inspectEvidenceReferences } from './evidence-inspection.js';
import { previewEvidenceCleanup } from './evidence-cleanup-preview.js';

export async function inspectEvidenceCleanup({
  loadRegistrations,
  loadFiles,
  referencesComplete,
  nowMs,
  minAgeMs,
} = {}) {
  if (
    typeof loadRegistrations !== 'function'
    || typeof loadFiles !== 'function'
  ) {
    throw new TypeError('Invalid evidence cleanup readers');
  }

  // Validate options before accessing either data source.
  previewEvidenceCleanup({
    registrations: [],
    referencesComplete,
    files: [],
    nowMs,
    minAgeMs,
  });

  const registrations = await loadRegistrations();

  // Reject truncated or malformed references before scanning files.
  inspectEvidenceReferences(registrations, []);

  const files = await loadFiles();

  return previewEvidenceCleanup({
    registrations,
    referencesComplete,
    files,
    nowMs,
    minAgeMs,
  });
}