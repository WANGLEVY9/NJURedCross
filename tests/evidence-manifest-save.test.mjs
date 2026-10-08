import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveEvidenceManifest } from '../lib/events/evidence-manifest-save.js';

const id = '00000000-0000-4000-8000-000000000001';

function manifest(digest = 'a'.repeat(64)) {
  return {
    version: 1,
    scope: 'uuid-named-files',
    totalBytes: 10,
    files: [{ id, bytes: 10, algorithm: 'sha256', digest }],
    note: '合成校验清单',
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'manifest-save-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, path: join(directory, 'manifest.json') };
}

test('a complete manifest is saved as UTF-8 JSON', async t => {
  const f = await fixture(t);
  const input = manifest();
  const result = await saveEvidenceManifest(f.path, input);
  const bytes = await readFile(f.path);

  assert.deepEqual(result, {
    saved: true,
    overwritten: false,
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), input);
  assert.equal(bytes.includes(Buffer.from('合成校验清单', 'utf8')), true);
  assert.deepEqual(await readdir(f.directory), ['manifest.json']);
});

test('an existing destination is never overwritten', async t => {
  const f = await fixture(t);
  await writeFile(f.path, 'existing-private-file');

  await assert.rejects(
    saveEvidenceManifest(f.path, manifest()),
    { code: 'EEXIST' },
  );

  assert.equal(await readFile(f.path, 'utf8'), 'existing-private-file');
  assert.deepEqual(await readdir(f.directory), ['manifest.json']);
});

test('invalid manifests cannot create a destination or temporary file', async t => {
  const f = await fixture(t);

  await assert.rejects(
    saveEvidenceManifest(f.path, { files: [] }),
    { code: 'invalid_evidence_manifest' },
  );

  assert.deepEqual(await readdir(f.directory), []);
});

test('competing saves publish exactly one complete manifest', async t => {
  const f = await fixture(t);
  const inputs = [manifest('a'.repeat(64)), manifest('b'.repeat(64))];

  const results = await Promise.allSettled(
    inputs.map(input => saveEvidenceManifest(f.path, input)),
  );

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected');
  assert.equal(failed.reason.code, 'EEXIST');

  const winner = results.findIndex(result => result.status === 'fulfilled');
  assert.deepEqual(JSON.parse(await readFile(f.path, 'utf8')), inputs[winner]);
  assert.deepEqual(await readdir(f.directory), ['manifest.json']);
});

test('missing parent directories are not created automatically', async t => {
  const f = await fixture(t);

  await assert.rejects(
    saveEvidenceManifest(
      join(f.directory, 'missing', 'manifest.json'),
      manifest(),
    ),
    { code: 'ENOENT' },
  );

  assert.deepEqual(await readdir(f.directory), []);
});

test('an existing destination directory is preserved', async t => {
  const f = await fixture(t);
  await mkdir(f.path);

  await assert.rejects(saveEvidenceManifest(f.path, manifest()));

  assert.deepEqual(await readdir(f.directory), ['manifest.json']);
  assert.deepEqual(await readdir(f.path), []);
});

test('relative paths and non-JSON destinations are rejected', async t => {
  const f = await fixture(t);

  for (const path of [
    'manifest.json',
    join(f.directory, 'manifest.txt'),
    null,
  ]) {
    await assert.rejects(saveEvidenceManifest(path, manifest()), TypeError);
  }

  assert.deepEqual(await readdir(f.directory), []);
});