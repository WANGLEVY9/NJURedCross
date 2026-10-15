import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvidenceManifest } from '../lib/events/evidence-manifest.js';

const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';

function fixture(names, bytes = 2) {
  const calls = [];
  return {
    calls,
    options: {
      readDirectory: async () => ({ filenames: names }),
      checksumFile: async (directory, id, options) => {
        calls.push({ directory, id, maxBytes: options.maxBytes });
        return {
          id,
          bytes,
          algorithm: 'sha256',
          digest: 'a'.repeat(64),
        };
      },
    },
  };
}

test('manifest includes sorted photo IDs and ignores unrelated filenames', async () => {
  const f = fixture([second, 'notes.txt', first]);
  const result = await createEvidenceManifest('synthetic-directory', f.options);

  assert.deepEqual(result.files.map(file => file.id), [first, second]);
  assert.equal(result.totalBytes, 4);
  assert.equal(result.ignoredFiles, 1);
  assert.equal(result.writes, 0);
  assert.equal(result.deletes, 0);
  assert.equal(result.atomicSnapshot, false);
});

test('a complete empty inventory produces an empty manifest', async () => {
  const f = fixture([]);
  const result = await createEvidenceManifest('synthetic-directory', f.options);

  assert.deepEqual(result.files, []);
  assert.equal(result.totalBytes, 0);
  assert.equal(f.calls.length, 0);
});

test('exceeding the file cap stops before reading any file contents', async () => {
  const f = fixture([first, second]);

  await assert.rejects(
    createEvidenceManifest('synthetic-directory', {
      ...f.options,
      maxFiles: 1,
    }),
    { code: 'evidence_manifest_unavailable', statusCode: 503 },
  );
  assert.equal(f.calls.length, 0);
});

test('exactly reaching the total-byte cap is accepted', async () => {
  const f = fixture([first, second]);
  const result = await createEvidenceManifest('synthetic-directory', {
    ...f.options,
    maxTotalBytes: 4,
  });

  assert.equal(result.totalBytes, 4);
  assert.deepEqual(f.calls.map(call => call.maxBytes), [4, 2]);
});

test('exceeding the total-byte cap rejects the entire manifest', async () => {
  const f = fixture([first, second]);

  await assert.rejects(
    createEvidenceManifest('synthetic-directory', {
      ...f.options,
      maxTotalBytes: 3,
    }),
    { code: 'evidence_manifest_unavailable', statusCode: 503 },
  );
  assert.deepEqual(f.calls.map(call => call.maxBytes), [3, 1]);
});

test('checksum failure cannot return a successful partial manifest', async () => {
  const failure = new Error('synthetic-read-failure');
  const f = fixture([first, second]);
  const original = f.options.checksumFile;
  f.options.checksumFile = async (directory, id, options) => {
    if (id === second) throw failure;
    return original(directory, id, options);
  };

  await assert.rejects(
    createEvidenceManifest('synthetic-directory', f.options),
    error => error === failure,
  );
});

test('invalid inventories and checksum records are rejected', async () => {
  for (const filenames of [null, [null], [first, first]]) {
    await assert.rejects(
      createEvidenceManifest('synthetic-directory', {
        readDirectory: async () => ({ filenames }),
        checksumFile: async () => {
          throw new Error('must not read');
        },
      }),
      { code: 'evidence_manifest_unavailable' },
    );
  }

  const valid = {
    id: first,
    bytes: 2,
    algorithm: 'sha256',
    digest: 'a'.repeat(64),
  };

  for (const record of [
    null,
    { ...valid, id: second },
    { ...valid, bytes: 0 },
    { ...valid, algorithm: 'invalid' },
    { ...valid, digest: 'invalid' },
  ]) {
    await assert.rejects(
      createEvidenceManifest('synthetic-directory', {
        readDirectory: async () => ({ filenames: [first] }),
        checksumFile: async () => record,
      }),
      { code: 'evidence_manifest_unavailable' },
    );
  }
});

test('invalid options are rejected before directory scanning', async () => {
  let scans = 0;
  const readDirectory = async () => { scans++; };

  for (const overrides of [
    { maxFiles: 0 },
    { maxFiles: 1.5 },
    { maxTotalBytes: 0 },
    { maxTotalBytes: NaN },
    { checksumFile: null },
  ]) {
    await assert.rejects(
      createEvidenceManifest('synthetic-directory', {
        readDirectory,
        ...overrides,
      }),
      TypeError,
    );
  }
  assert.equal(scans, 0);
});
async function directoryFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-manifest-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('real directory scanning and hashing produce the expected manifest', async t => {
  const directory = await directoryFixture(t);
  const firstBytes = Buffer.from('synthetic-first');
  const secondBytes = Buffer.from('synthetic-second');

  await writeFile(join(directory, first), firstBytes);
  await writeFile(join(directory, second), secondBytes);
  await writeFile(join(directory, 'notes.txt'), 'unrelated');

  const result = await createEvidenceManifest(directory);

  assert.equal(result.totalBytes, firstBytes.length + secondBytes.length);
  assert.equal(result.ignoredFiles, 1);
  assert.deepEqual(result.files, [
    {
      id: first,
      bytes: firstBytes.length,
      algorithm: 'sha256',
      digest: createHash('sha256').update(firstBytes).digest('hex'),
    },
    {
      id: second,
      bytes: secondBytes.length,
      algorithm: 'sha256',
      digest: createHash('sha256').update(secondBytes).digest('hex'),
    },
  ]);
  assert.deepEqual(await readFile(join(directory, first)), firstBytes);
  assert.deepEqual(await readdir(directory), [first, second, 'notes.txt'].sort());
});

test('real oversized evidence rejects the manifest without changing files', async t => {
  const directory = await directoryFixture(t);
  const bytes = Buffer.alloc(17, 7);
  await writeFile(join(directory, first), bytes);

  await assert.rejects(
    createEvidenceManifest(directory, { maxTotalBytes: 16 }),
    { code: 'evidence_checksum_unavailable', statusCode: 503 },
  );

  assert.deepEqual(await readFile(join(directory, first)), bytes);
  assert.deepEqual(await readdir(directory), [first]);
});

test('a real empty evidence file prevents successful manifest generation', async t => {
  const directory = await directoryFixture(t);
  await writeFile(join(directory, first), Buffer.alloc(0));

  await assert.rejects(
    createEvidenceManifest(directory),
    { code: 'evidence_checksum_unavailable', statusCode: 503 },
  );

  assert.deepEqual(await readdir(directory), [first]);
});