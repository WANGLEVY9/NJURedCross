import { lstat, opendir } from 'node:fs/promises';

const photoIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function unavailable() {
  return Object.assign(
    new Error('照片目录无法完整核查，已停止操作。'),
    { statusCode: 503, code: 'evidence_directory_unavailable' },
  );
}

/** Read filenames only. Never read photo contents or modify files. */
export async function readEvidenceDirectory(directory, {
  maxEntries = 100000,
} = {}) {
  if (
    typeof directory !== 'string'
    || !directory.trim()
    || !Number.isInteger(maxEntries)
    || maxEntries < 1
    || maxEntries > 100000
  ) {
    throw new TypeError('Invalid evidence directory scan options');
  }

  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw unavailable();
    }

    const filenames = [];
    let entries = 0;
    let ignoredEntries = 0;
    const handle = await opendir(directory);

    for await (const entry of handle) {
      entries++;
      if (entries > maxEntries) throw unavailable();

      if (entry.isFile()) {
        filenames.push(entry.name);
      } else {
        // A UUID-shaped entry must be a regular evidence file.
        if (photoIdPattern.test(entry.name)) throw unavailable();
        ignoredEntries++;
      }
    }

    return {
      filenames: filenames.sort(),
      entries,
      ignoredEntries,
    };
  } catch {
    throw unavailable();
  }
}