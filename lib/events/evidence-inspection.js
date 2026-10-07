import { assertCompleteRows } from './safety.js';

const photoIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function invalidInput() {
  return Object.assign(
    new Error('照片核查输入无效，已停止核查。'),
    { statusCode: 503, code: 'invalid_evidence_inventory' },
  );
}

/**
 * Compare complete registration references with a directory inventory.
 * Unreferenced files are reconciliation candidates, never deletion approval.
 */
export function inspectEvidenceReferences(registrations, filenames) {
  assertCompleteRows(registrations);

  if (!Array.isArray(filenames)) throw invalidInput();

  const referenced = new Set();
  for (const row of registrations) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw invalidInput();
    }

    const id = row['签到照片ID'];
    if (id === undefined || id === null || id === '') continue;
    if (typeof id !== 'string' || !photoIdPattern.test(id)) {
      throw invalidInput();
    }
    referenced.add(id);
  }

  const present = new Set();
  let ignoredFiles = 0;
  for (const name of filenames) {
    if (typeof name !== 'string' || !name || present.has(name)) {
      throw invalidInput();
    }
    if (!photoIdPattern.test(name)) {
      ignoredFiles++;
      continue;
    }
    present.add(name);
  }

  const missing = [...referenced].filter(id => !present.has(id)).sort();
  const unreferenced = [...present].filter(id => !referenced.has(id)).sort();

  return {
    mode: 'read-only',
    writes: 0,
    deletes: 0,
    deletionAuthorized: false,
    counts: {
      referenced: referenced.size,
      present: present.size,
      missing: missing.length,
      unreferenced: unreferenced.length,
      ignoredFiles,
    },
    missing,
    unreferenced,
  };
}
/** Coordinate read-only inspection with explicitly supplied data sources. */
export async function inspectAttendanceEvidence({
  loadRegistrations,
  loadDirectory,
}) {
  if (
    typeof loadRegistrations !== 'function'
    || typeof loadDirectory !== 'function'
  ) {
    throw new TypeError('Evidence inspection requires explicit readers');
  }

  const registrations = await loadRegistrations();
  assertCompleteRows(registrations);

  const inventory = await loadDirectory();
  if (
    !inventory
    || !Number.isInteger(inventory.ignoredEntries)
    || inventory.ignoredEntries < 0
  ) {
    throw invalidInput();
  }

  const result = inspectEvidenceReferences(
    registrations,
    inventory.filenames,
  );

  return {
    ...result,
    atomicSnapshot: false,
    ignoredDirectoryEntries: inventory.ignoredEntries,
  };
}