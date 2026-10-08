import { readEvidenceDirectory } from './evidence-directory.js';
import { checksumEvidenceFile } from './evidence-checksum.js';

const photoIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function unavailable() {
  return Object.assign(
    new Error('照片校验清单无法完整生成，已停止核查。'),
    { statusCode: 503, code: 'evidence_manifest_unavailable' },
  );
}

/** Build a bounded checksum manifest without writing or deleting files. */
export async function createEvidenceManifest(directory, {
  maxFiles = 1000,
  maxTotalBytes = 256 * 1024 * 1024,
  readDirectory = readEvidenceDirectory,
  checksumFile = checksumEvidenceFile,
} = {}) {
  if (
    !Number.isInteger(maxFiles)
    || maxFiles < 1
    || maxFiles > 100000
    || !Number.isSafeInteger(maxTotalBytes)
    || maxTotalBytes < 1
    || maxTotalBytes > 1024 * 1024 * 1024
    || typeof readDirectory !== 'function'
    || typeof checksumFile !== 'function'
  ) {
    throw new TypeError('Invalid evidence manifest options');
  }

  const inventory = await readDirectory(directory);
  if (
    !inventory
    || !Array.isArray(inventory.filenames)
    || inventory.filenames.some(name => typeof name !== 'string')
    || new Set(inventory.filenames).size !== inventory.filenames.length
  ) {
    throw unavailable();
  }

  const ids = inventory.filenames.filter(name => photoIdPattern.test(name)).sort();
  if (ids.length > maxFiles) throw unavailable();

  const files = [];
  let totalBytes = 0;

  for (const id of ids) {
    const remaining = maxTotalBytes - totalBytes;
    if (remaining < 1) throw unavailable();

    const result = await checksumFile(directory, id, {
      maxBytes: Math.min(4 * 1024 * 1024, remaining),
    });

    if (
      !result
      || result.id !== id
      || result.algorithm !== 'sha256'
      || typeof result.digest !== 'string'
      || !/^[a-f0-9]{64}$/.test(result.digest)
      || !Number.isSafeInteger(result.bytes)
      || result.bytes < 1
      || result.bytes > Math.min(4 * 1024 * 1024, remaining)
    ) {
      throw unavailable();
    }

    totalBytes += result.bytes;
    files.push({
      id,
      bytes: result.bytes,
      algorithm: 'sha256',
      digest: result.digest,
    });
  }

  return {
    version: 1,
    mode: 'read-only',
    writes: 0,
    deletes: 0,
    atomicSnapshot: false,
    scope: 'uuid-named-files',
    totalBytes,
    ignoredFiles: inventory.filenames.length - ids.length,
    files,
  };
}