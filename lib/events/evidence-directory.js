import { lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';

const photoIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function unavailable() {
  return Object.assign(
    new Error('照片目录无法完整核查，已停止操作。'),
    { statusCode: 503, code: 'evidence_directory_unavailable' },
  );
}

/** Read names and file sizes without reading contents or modifying files. */
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
    let photoBytes = 0;
    let otherFileBytes = 0;
    const handle = await opendir(directory);

    for await (const entry of handle) {
      entries++;
      if (entries > maxEntries) throw unavailable();

      if (entry.isFile()) {
        const file = await lstat(join(directory, entry.name));
        if (
          !file.isFile()
          || file.isSymbolicLink()
          || !Number.isSafeInteger(file.size)
          || file.size < 0
        ) {
          throw unavailable();
        }

        filenames.push(entry.name);
        if (photoIdPattern.test(entry.name)) {
          photoBytes += file.size;
        } else {
          otherFileBytes += file.size;
        }

        if (!Number.isSafeInteger(photoBytes + otherFileBytes)) {
          throw unavailable();
        }
      } else {
        if (photoIdPattern.test(entry.name)) throw unavailable();
        ignoredEntries++;
      }
    }

    return {
      filenames: filenames.sort(),
      entries,
      ignoredEntries,
      storage: {
        photoBytes,
        otherFileBytes,
        totalFileBytes: photoBytes + otherFileBytes,
        includesSubdirectories: false,
      },
    };
  } catch {
    throw unavailable();
  }
}