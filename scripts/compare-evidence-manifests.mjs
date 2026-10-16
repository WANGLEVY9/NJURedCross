import { lstat, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { compareEvidenceManifests } from '../lib/events/evidence-comparison.js';

async function readManifest(path) {
  const maxBytes = 16 * 1024 * 1024;
  const listed = await lstat(path);
  if (!listed.isFile() || listed.isSymbolicLink()) {
    throw new Error('Regular manifest file required');
  }

  const handle = await open(path, 'r');
  try {
    const before = await handle.stat();
    if (
      !before.isFile()
      || before.dev !== listed.dev
      || before.ino !== listed.ino
      || before.size < 1
      || before.size > maxBytes
    ) {
      throw new Error('Invalid manifest file');
    }

    const chunks = [];
    let bytes = 0;
    for await (const chunk of handle.createReadStream({
      autoClose: false,
    })) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('Manifest file too large');
      chunks.push(chunk);
    }

    const after = await handle.stat();
    if (
      bytes !== before.size
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
    ) {
      throw new Error('Manifest file changed during reading');
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await handle.close();
  }
}

try {
  const args = process.argv.slice(2);
  const paths = new Map();

  for (const arg of args) {
    const match = arg.match(/^--(expected|actual)=(.+)$/);
    if (!match || paths.has(match[1]) || !isAbsolute(match[2])) {
      throw new Error('Invalid manifest arguments');
    }
    paths.set(match[1], match[2]);
  }

  if (args.length !== 2 || paths.size !== 2) {
    throw new Error('Expected and actual manifest paths required');
  }

  const expected = await readManifest(paths.get('expected'));
  const actual = await readManifest(paths.get('actual'));
  const result = compareEvidenceManifests(expected, actual);

  console.log(JSON.stringify({
    mode: result.mode,
    writes: result.writes,
    deletes: result.deletes,
    deletionAuthorized: result.deletionAuthorized,
    restorationVerified: result.restorationVerified,
    atomicSnapshot: result.atomicSnapshot,
    exactMatch: result.exactMatch,
    counts: result.counts,
    sampleLimit: 20,
    missingSample: result.missing.slice(0, 20),
    changedSample: result.changed.slice(0, 20),
    extraSample: result.extra.slice(0, 20),
    samplesLimited: result.missing.length > 20
      || result.changed.length > 20
      || result.extra.length > 20,
  }, null, 2));

  if (!result.exactMatch) process.exitCode = 2;
} catch {
  console.error(
    '照片清单比较失败。请检查参数、清单文件及格式；未执行写入、删除或恢复。',
  );
  process.exitCode = 1;
}