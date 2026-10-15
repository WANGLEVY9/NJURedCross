import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Single-process storage. The file must live on persistent local storage.
 * Store hashes rather than raw session CSRF values.
 */
export async function createSessionRevocations({ file, now = Date.now }) {
  let entries = new Map();
  let pending = Promise.resolve();

  try {
    const document = JSON.parse(await readFile(file, 'utf8'));
    if (
      document.version !== 1 ||
      !Array.isArray(document.entries)
    ) {
      throw new Error('Invalid session revocation file');
    }

    for (const entry of document.entries) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry[0]) ||
        !Number.isFinite(entry[1]) ||
        entries.has(entry[0])
      ) {
        throw new Error('Invalid session revocation entry');
      }
      entries.set(entry[0], entry[1]);
    }

    entries = new Map(
      [...entries].filter(([, expiry]) => expiry > now()),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  async function save(snapshot) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    let handle;

    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(
        JSON.stringify({ version: 1, entries: [...snapshot] }) + '\n',
        'utf8',
      );
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, file);
    } finally {
      if (handle) await handle.close();
      await unlink(temporary).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  return {
    has(csrf) {
      const expiry = entries.get(digest(csrf));
      return Number.isFinite(expiry) && expiry > now();
    },

    revoke(csrf, expiry) {
      if (
        typeof csrf !== 'string' ||
        !csrf ||
        !Number.isFinite(expiry) ||
        expiry <= now()
      ) {
        return Promise.reject(new Error('Invalid session revocation'));
      }

      const key = digest(csrf);

      const operation = pending.then(async () => {
        const snapshot = new Map(
          [...entries].filter(([, expires]) => expires > now()),
        );
        snapshot.set(key, Math.max(snapshot.get(key) || 0, expiry));

        await save(snapshot);
        entries = snapshot;
      });
      
      // A failed write must not prevent later requests from retrying.
      pending = operation.catch(() => {});
      return operation;
    },
  };
}