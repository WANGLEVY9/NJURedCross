import { randomUUID } from 'node:crypto';
import { lstat, open, link, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { compareEvidenceManifests } from './evidence-comparison.js';

/**
 * Save validated UTF-8 JSON without replacing an existing destination.
 * Publish only after the temporary file is completely written.
 */
export async function saveEvidenceManifest(path, manifest) {
  if (
    typeof path !== 'string'
    || !isAbsolute(path)
    || !path.toLowerCase().endsWith('.json')
  ) {
    throw new TypeError('An absolute JSON destination is required');
  }

  const text = JSON.stringify(manifest, null, 2) + '\n';
  const snapshot = JSON.parse(text);
  compareEvidenceManifests(snapshot, snapshot);

  const parent = dirname(path);
  const directory = await lstat(parent);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error('A regular private destination directory is required');
  }

  const temporary = join(parent, `.evidence-${randomUUID()}.tmp`);
  let handle;
  let created = false;

  try {
    handle = await open(temporary, 'wx', 0o600);
    created = true;
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;

    // A hard link publishes the complete file and refuses an existing target.
    await link(temporary, path);

    return {
      saved: true,
      overwritten: false,
      encoding: 'utf8',
    };
  } finally {
    try {
      if (handle) await handle.close();
    } finally {
      if (created) {
        await unlink(temporary).catch(error => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }
  }
}