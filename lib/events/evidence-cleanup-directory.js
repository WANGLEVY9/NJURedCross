import { lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';

function unavailable() {
  return Object.assign(
    new Error('照片目录元数据无法完整核查，已停止预览。'),
    { statusCode: 503, code: 'evidence_cleanup_directory_unavailable' },
  );
}

/** Read metadata only; never follow file links or read file contents. */
export async function readEvidenceCleanupDirectory(directory, {
  maxEntries = 100000,
} = {}) {
  if (
    typeof directory !== 'string'
    || !directory.trim()
    || !Number.isInteger(maxEntries)
    || maxEntries < 1
    || maxEntries > 100000
  ) {
    throw new TypeError('Invalid evidence cleanup directory options');
  }

  try {
    const before = await lstat(directory);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw unavailable();
    }

    const files = [];
    const handle = await opendir(directory);

    for await (const entry of handle) {
      if (files.length >= maxEntries) throw unavailable();

      const info = await lstat(join(directory, entry.name));
      if (
        !Number.isSafeInteger(info.size)
        || info.size < 0
        || !Number.isFinite(info.mtimeMs)
        || info.mtimeMs < 0
        || !Number.isSafeInteger(info.nlink)
        || info.nlink < 1
      ) {
        throw unavailable();
      }

      files.push({
        name: entry.name,
        isRegularFile: info.isFile() && !info.isSymbolicLink(),
        size: info.size,
        mtimeMs: info.mtimeMs,
        nlink: info.nlink,
      });
    }

    const after = await lstat(directory);
    if (
      !after.isDirectory()
      || after.isSymbolicLink()
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
    ) {
      throw unavailable();
    }

    return files.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    throw unavailable();
  }
}