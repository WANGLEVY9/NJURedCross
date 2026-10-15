import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readEvidenceReferenceSnapshot,
} from '../lib/events/evidence-reference-snapshot.js';
import {
  readEvidenceCleanupDirectory,
} from '../lib/events/evidence-cleanup-directory.js';
import {
  inspectEvidenceCleanup,
} from '../lib/events/evidence-cleanup-inspection.js';

function positiveInteger(value) {
  if (!/^[0-9]+$/.test(value || '')) {
    throw new Error('Invalid integer option');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error('Invalid integer option');
  }
  return number;
}

try {
  const options = new Map();
  const allowed = new Set([
    'references',
    'directory',
    'min-age-ms',
    'now-ms',
  ]);

  for (const argument of process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (!match || !allowed.has(match[1]) || options.has(match[1])) {
      throw new Error('Invalid or repeated option');
    }
    options.set(match[1], match[2]);
  }

  const references = options.get('references');
  const directory = options.get('directory');

  if (
    !references || !isAbsolute(references)
    || !directory || !isAbsolute(directory)
  ) {
    throw new Error('Absolute input paths required');
  }

  const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
  const relativeDirectory = relative(publicDirectory, resolve(directory));
  if (
    relativeDirectory === ''
    || (
      !isAbsolute(relativeDirectory)
      && relativeDirectory !== '..'
      && !relativeDirectory.startsWith(`..${sep}`)
    )
  ) {
    throw new Error('Public directory cannot be scanned');
  }

  const minAgeMs = positiveInteger(options.get('min-age-ms'));
  const nowMs = options.has('now-ms')
    ? positiveInteger(options.get('now-ms'))
    : Date.now();

  const result = await inspectEvidenceCleanup({
    loadRegistrations: () => readEvidenceReferenceSnapshot(references),
    loadFiles: () => readEvidenceCleanupDirectory(directory),
    referencesComplete: true,
    nowMs,
    minAgeMs,
  });

  const retainedReasons = Object.create(null);
  for (const item of result.retained) {
    retainedReasons[item.reason] = (retainedReasons[item.reason] || 0) + 1;
  }

  const sampleLimit = 20;
  console.log(JSON.stringify({
    mode: result.mode,
    writes: 0,
    deletes: 0,
    networkRequests: 0,
    deletionAuthorized: false,
    atomicSnapshot: false,
    referenceCompleteness: result.referenceCompleteness,
    policy: result.policy,
    counts: result.counts,
    retainedReasons,
    sampleLimit,
    reviewCandidates: result.reviewCandidates.slice(0, sampleLimit),
    missingReferences: result.missingReferences.slice(0, sampleLimit),
    samplesLimited:
      result.reviewCandidates.length > sampleLimit
      || result.missingReferences.length > sampleLimit,
  }, null, 2));
} catch {
  console.error('Evidence cleanup preview failed; no files were modified.');
  process.exitCode = 1;
}