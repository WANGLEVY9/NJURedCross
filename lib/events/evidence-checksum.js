import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';

const photoIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function unavailable() {
  return Object.assign(
    new Error('照片文件无法完成校验，已停止读取。'),
    { statusCode: 503, code: 'evidence_checksum_unavailable' },
  );
}

/** Read one bounded regular file and calculate its SHA-256 digest. */
export async function checksumEvidenceFile(directory, id, {
  maxBytes = 4 * 1024 * 1024,
} = {}) {
  if (
    typeof directory !== 'string'
    || !directory.trim()
    || typeof id !== 'string'
    || !photoIdPattern.test(id)
    || !Number.isSafeInteger(maxBytes)
    || maxBytes < 1
    || maxBytes > 64 * 1024 * 1024
  ) {
    throw new TypeError('Invalid evidence checksum options');
  }

  let handle;
  try {
    const root = await lstat(directory);
    if (!root.isDirectory() || root.isSymbolicLink()) {
      throw unavailable();
    }

    const path = join(directory, id);
    const listed = await lstat(path);
    if (!listed.isFile() || listed.isSymbolicLink()) {
      throw unavailable();
    }

    handle = await open(path, 'r');
    const before = await handle.stat();

    if (
      !before.isFile()
      || before.dev !== listed.dev
      || before.ino !== listed.ino
      || !Number.isSafeInteger(before.size)
      || before.size < 1
      || before.size > maxBytes
    ) {
      throw unavailable();
    }

    const hash = createHash('sha256');
    let bytes = 0;

    for await (const chunk of handle.createReadStream({
      autoClose: false,
    })) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw unavailable();
      hash.update(chunk);
    }

    const after = await handle.stat();
    if (
      bytes !== before.size
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
    ) {
      throw unavailable();
    }

    return {
      id,
      bytes,
      algorithm: 'sha256',
      digest: hash.digest('hex'),
    };
  } catch {
    throw unavailable();
  } finally {
    if (handle) await handle.close();
  }
}