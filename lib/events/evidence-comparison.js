const photoIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function invalidManifest() {
  return Object.assign(
    new Error('照片校验清单无效，已停止比较。'),
    { statusCode: 503, code: 'invalid_evidence_manifest' },
  );
}

function validateManifest(manifest) {
  if (
    !manifest
    || manifest.version !== 1
    || manifest.scope !== 'uuid-named-files'
    || !Array.isArray(manifest.files)
    || manifest.files.length > 100000
    || !Number.isSafeInteger(manifest.totalBytes)
    || manifest.totalBytes < 0
  ) {
    throw invalidManifest();
  }

  const files = new Map();
  let totalBytes = 0;

  for (const file of manifest.files) {
    if (
      !file
      || typeof file.id !== 'string'
      || !photoIdPattern.test(file.id)
      || files.has(file.id)
      || file.algorithm !== 'sha256'
      || typeof file.digest !== 'string'
      || !/^[a-f0-9]{64}$/.test(file.digest)
      || !Number.isSafeInteger(file.bytes)
      || file.bytes < 1
      || file.bytes > 4 * 1024 * 1024
    ) {
      throw invalidManifest();
    }

    totalBytes += file.bytes;
    if (!Number.isSafeInteger(totalBytes)) throw invalidManifest();
    files.set(file.id, file);
  }

  if (totalBytes !== manifest.totalBytes) throw invalidManifest();
  return files;
}

/** Compare validated manifests without authorizing deletion or restoration. */
export function compareEvidenceManifests(expectedManifest, actualManifest) {
  const expected = validateManifest(expectedManifest);
  const actual = validateManifest(actualManifest);

  const missing = [];
  const changed = [];
  const extra = [];

  for (const [id, file] of expected) {
    const candidate = actual.get(id);
    if (!candidate) {
      missing.push(id);
    } else if (
      file.bytes !== candidate.bytes
      || file.digest !== candidate.digest
    ) {
      changed.push(id);
    }
  }

  for (const id of actual.keys()) {
    if (!expected.has(id)) extra.push(id);
  }

  missing.sort();
  changed.sort();
  extra.sort();

  return {
    mode: 'read-only',
    writes: 0,
    deletes: 0,
    deletionAuthorized: false,
    restorationVerified: false,
    atomicSnapshot: false,
    exactMatch: missing.length === 0
      && changed.length === 0
      && extra.length === 0,
    counts: {
      expected: expected.size,
      actual: actual.size,
      missing: missing.length,
      changed: changed.length,
      extra: extra.length,
    },
    missing,
    changed,
    extra,
  };
}