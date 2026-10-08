import { lstat, open } from 'node:fs/promises';
import { inspectEvidenceReferences } from './evidence-inspection.js';

function unavailable() {
  return Object.assign(
    new Error('照片引用快照无法可靠读取，已停止预览。'),
    { code: 'evidence_reference_snapshot_unavailable', statusCode: 503 },
  );
}

export async function readEvidenceReferenceSnapshot(path) {
  const maxBytes = 16 * 1024 * 1024;
  let handle;

  try {
    if (typeof path !== 'string' || !path.trim()) {
      throw unavailable();
    }

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
      || before.size < 1
      || before.size > maxBytes
    ) {
      throw unavailable();
    }

    const chunks = [];
    let bytes = 0;

    for await (const chunk of handle.createReadStream({
      autoClose: false,
    })) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw unavailable();
      chunks.push(chunk);
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

    const text = new TextDecoder('utf-8', { fatal: true })
      .decode(Buffer.concat(chunks));
    const snapshot = JSON.parse(text);

    if (
      !snapshot
      || typeof snapshot !== 'object'
      || Array.isArray(snapshot)
      || snapshot.version !== 1
      || snapshot.referencesComplete !== true
      || snapshot.truncated !== false
      || !Array.isArray(snapshot.registrations)
      || snapshot.registrations.length > 100000
    ) {
      throw unavailable();
    }

    for (const row of snapshot.registrations) {
      if (
        !row
        || typeof row !== 'object'
        || Array.isArray(row)
        || Object.keys(row).some(key => key !== '签到照片ID')
      ) {
        throw unavailable();
      }
    }

    inspectEvidenceReferences(snapshot.registrations, []);
    return snapshot.registrations;
  } catch {
    throw unavailable();
  } finally {
    await handle?.close();
  }
}