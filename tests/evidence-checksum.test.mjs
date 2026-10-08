import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checksumEvidenceFile } from '../lib/events/evidence-checksum.js';

const id = '00000000-0000-4000-8000-000000000001';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-checksum-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('checksum matches SHA-256 without changing the file', async t => {
  const directory = await fixture(t);
  const bytes = Buffer.from('synthetic-evidence');
  await writeFile(join(directory, id), bytes);

  const result = await checksumEvidenceFile(directory, id);

  assert.deepEqual(result, {
    id,
    bytes: bytes.length,
    algorithm: 'sha256',
    digest: createHash('sha256').update(bytes).digest('hex'),
  });
  assert.deepEqual(await readFile(join(directory, id)), bytes);
});

test('a changed file produces a different digest', async t => {
  const directory = await fixture(t);
  await writeFile(join(directory, id), 'first');
  const first = await checksumEvidenceFile(directory, id);

  await writeFile(join(directory, id), 'second');
  const second = await checksumEvidenceFile(directory, id);

  assert.notEqual(first.digest, second.digest);
});

test('a file exactly at the configured limit is accepted', async t => {
  const directory = await fixture(t);
  await writeFile(join(directory, id), Buffer.alloc(16, 7));

  const result = await checksumEvidenceFile(directory, id, {
    maxBytes: 16,
  });

  assert.equal(result.bytes, 16);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});

test('an oversized file is rejected and remains unchanged', async t => {
  const directory = await fixture(t);
  const bytes = Buffer.alloc(17, 7);
  await writeFile(join(directory, id), bytes);

  await assert.rejects(
    checksumEvidenceFile(directory, id, { maxBytes: 16 }),
    { code: 'evidence_checksum_unavailable', statusCode: 503 },
  );
  assert.deepEqual(await readFile(join(directory, id)), bytes);
});

test('empty files cannot produce a successful evidence checksum', async t => {
  const directory = await fixture(t);
  await writeFile(join(directory, id), Buffer.alloc(0));

  await assert.rejects(
    checksumEvidenceFile(directory, id),
    { code: 'evidence_checksum_unavailable', statusCode: 503 },
  );
});

test('missing evidence is rejected without creating a file', async t => {
  const directory = await fixture(t);

  await assert.rejects(
    checksumEvidenceFile(directory, id),
    { code: 'evidence_checksum_unavailable', statusCode: 503 },
  );
  await assert.rejects(readFile(join(directory, id)), { code: 'ENOENT' });
});

test('a directory cannot masquerade as an evidence file', async t => {
  const directory = await fixture(t);
  await mkdir(join(directory, id));

  await assert.rejects(
    checksumEvidenceFile(directory, id),
    { code: 'evidence_checksum_unavailable', statusCode: 503 },
  );
});

test('invalid IDs and size limits are rejected before reading', async () => {
  for (const value of ['../outside', '', null, 'invalid-id']) {
    await assert.rejects(
      checksumEvidenceFile('synthetic-directory', value),
      TypeError,
    );
  }

  for (const maxBytes of [0, -1, 1.5, NaN, 64 * 1024 * 1024 + 1]) {
    await assert.rejects(
      checksumEvidenceFile('synthetic-directory', id, { maxBytes }),
      TypeError,
    );
  }
});