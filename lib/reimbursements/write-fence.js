import { readFile, writeFile, rename, unlink, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { storageFailure } from './material-codec.js';

/** Recovery marker only, not financial data storage. The host holds its existing
 * cross-process write lock. A lost remote ACK must survive an application restart. */
export function createReimbursementWriteFence(path) {
  async function read() {
    const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!info) return null;
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 2048) throw storageFailure('reimbursement_fence_invalid');
    let value;
    try { value = JSON.parse(await readFile(path, 'utf8')); } catch { throw storageFailure('reimbursement_fence_invalid'); }
    if (typeof value.id !== 'string' || !Number.isSafeInteger(value.version) || !/^[a-f0-9]{64}$/.test(value.digest)) throw storageFailure('reimbursement_fence_invalid');
    return value;
  }
  return { read,
    async save(value) {
      if (await read()) throw storageFailure('reimbursement_commit_unknown');
      const temporary = `${path}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600, flush: true }); await rename(temporary, path); }
      finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    },
    async clear(id) { const value = await read(); if (value?.id === id) await unlink(path); },
  };
}
