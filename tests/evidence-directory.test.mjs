import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEvidenceDirectory } from '../lib/events/evidence-directory.js';

const photoId = '00000000-0000-4000-8000-000000000001';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-directory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('an empty directory produces a complete empty inventory', async t => {
  const directory = await fixture(t);
  const result = await readEvidenceDirectory(directory);

  assert.deepEqual(result, {
    filenames: [],
    entries: 0,
    ignoredEntries: 0,
  });
});

test('ordinary files are listed without modifying their contents', async t => {
  const directory = await fixture(t);
  await writeFile(join(directory, photoId), 'synthetic-evidence');
  await writeFile(join(directory, 'notes.txt'), 'synthetic-note');

  const result = await readEvidenceDirectory(directory);

  assert.deepEqual(result.filenames, [photoId, 'notes.txt'].sort());
  assert.equal(result.entries, 2);
  assert.equal(result.ignoredEntries, 0);
  assert.equal(
    await readFile(join(directory, photoId), 'utf8'),
    'synthetic-evidence',
  );
});

test('unrelated subdirectories are counted but not traversed', async t => {
  const directory = await fixture(t);
  const nested = join(directory, 'unrelated');
  await mkdir(nested);
  await writeFile(join(nested, photoId), 'nested-evidence');

  const result = await readEvidenceDirectory(directory);

  assert.deepEqual(result.filenames, []);
  assert.equal(result.entries, 1);
  assert.equal(result.ignoredEntries, 1);
});

test('a UUID-shaped directory cannot masquerade as a photo', async t => {
  const directory = await fixture(t);
  await mkdir(join(directory, photoId));

  await assert.rejects(
    readEvidenceDirectory(directory),
    { code: 'evidence_directory_unavailable', statusCode: 503 },
  );
});

test('a missing directory is not reported as an empty inventory', async t => {
  const directory = await fixture(t);

  await assert.rejects(
    readEvidenceDirectory(join(directory, 'missing')),
    { code: 'evidence_directory_unavailable', statusCode: 503 },
  );
});

test('a regular file cannot be used as the evidence directory', async t => {
  const directory = await fixture(t);
  const file = join(directory, 'ordinary-file');
  await writeFile(file, 'synthetic');

  await assert.rejects(
    readEvidenceDirectory(file),
    { code: 'evidence_directory_unavailable', statusCode: 503 },
  );
});

test('exactly reaching the entry cap is allowed', async t => {
  const directory = await fixture(t);
  await writeFile(join(directory, photoId), 'synthetic');

  const result = await readEvidenceDirectory(directory, {
    maxEntries: 1,
  });

  assert.equal(result.entries, 1);
  assert.deepEqual(result.filenames, [photoId]);
});

test('exceeding the cap rejects the entire inventory', async t => {
  const directory = await fixture(t);
  await writeFile(join(directory, 'first'), 'synthetic');
  await writeFile(join(directory, 'second'), 'synthetic');

  await assert.rejects(
    readEvidenceDirectory(directory, { maxEntries: 1 }),
    { code: 'evidence_directory_unavailable', statusCode: 503 },
  );
});

test('invalid scan options are rejected', async () => {
  for (const directory of ['', null, 123]) {
    await assert.rejects(readEvidenceDirectory(directory), TypeError);
  }

  for (const maxEntries of [0, -1, 1.5, 100001]) {
    await assert.rejects(
      readEvidenceDirectory('synthetic-directory', { maxEntries }),
      TypeError,
    );
  }
});