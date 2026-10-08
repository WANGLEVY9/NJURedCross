import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvidenceManifest } from '../lib/events/evidence-manifest.js';
import { compareEvidenceManifests } from '../lib/events/evidence-comparison.js';

const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';

function file(id, overrides = {}) {
  return {
    id,
    bytes: 10,
    algorithm: 'sha256',
    digest: 'a'.repeat(64),
    ...overrides,
  };
}

function manifest(files) {
  return {
    version: 1,
    scope: 'uuid-named-files',
    totalBytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
    files,
  };
}

test('identical manifests match without authorizing deletion or restoration', () => {
  const input = manifest([file(first)]);
  const result = compareEvidenceManifests(input, input);

  assert.equal(result.exactMatch, true);
  assert.equal(result.writes, 0);
  assert.equal(result.deletes, 0);
  assert.equal(result.deletionAuthorized, false);
  assert.equal(result.restorationVerified, false);
  assert.equal(result.atomicSnapshot, false);
  assert.deepEqual(result.counts, {
    expected: 1,
    actual: 1,
    missing: 0,
    changed: 0,
    extra: 0,
  });
});

test('missing files are reported in the expected-to-actual direction', () => {
  const result = compareEvidenceManifests(
    manifest([file(first)]),
    manifest([]),
  );

  assert.equal(result.exactMatch, false);
  assert.deepEqual(result.missing, [first]);
  assert.deepEqual(result.extra, []);
});

test('extra files are reported without deletion authorization', () => {
  const result = compareEvidenceManifests(
    manifest([]),
    manifest([file(second)]),
  );

  assert.deepEqual(result.extra, [second]);
  assert.equal(result.deletionAuthorized, false);
});

test('digest changes are detected even when file sizes match', () => {
  const result = compareEvidenceManifests(
    manifest([file(first)]),
    manifest([file(first, { digest: 'b'.repeat(64) })]),
  );

  assert.deepEqual(result.changed, [first]);
  assert.equal(result.exactMatch, false);
});

test('size changes are detected independently of the digest', () => {
  const result = compareEvidenceManifests(
    manifest([file(first)]),
    manifest([file(first, { bytes: 11 })]),
  );

  assert.deepEqual(result.changed, [first]);
});

test('file ordering does not affect comparison', () => {
  const result = compareEvidenceManifests(
    manifest([file(first), file(second)]),
    manifest([file(second), file(first)]),
  );

  assert.equal(result.exactMatch, true);
});

test('empty validated manifests match without proving recovery', () => {
  const result = compareEvidenceManifests(manifest([]), manifest([]));

  assert.equal(result.exactMatch, true);
  assert.equal(result.counts.expected, 0);
  assert.equal(result.restorationVerified, false);
});

test('invalid manifest headers and totals are rejected', () => {
  const valid = manifest([file(first)]);

  for (const invalid of [
    null,
    { ...valid, version: 2 },
    { ...valid, scope: 'invalid' },
    { ...valid, files: null },
    { ...valid, totalBytes: 99 },
    { ...valid, totalBytes: NaN },
  ]) {
    for (const pair of [[invalid, valid], [valid, invalid]]) {
      assert.throws(
        () => compareEvidenceManifests(...pair),
        { code: 'invalid_evidence_manifest', statusCode: 503 },
      );
    }
  }
});

test('duplicate IDs and malformed file records are rejected', () => {
  const valid = manifest([file(first)]);

  const invalidFiles = [
    [file(first), file(first)],
    [null],
    [file('../outside')],
    [file(first, { bytes: 0 })],
    [file(first, { bytes: 4 * 1024 * 1024 + 1 })],
    [file(first, { algorithm: 'invalid' })],
    [file(first, { digest: 'invalid' })],
  ];

  for (const files of invalidFiles) {
    const invalid = {
      version: 1,
      scope: 'uuid-named-files',
      totalBytes: 10,
      files,
    };

    assert.throws(
      () => compareEvidenceManifests(valid, invalid),
      { code: 'invalid_evidence_manifest', statusCode: 503 },
    );
  }
});

test('comparison leaves the supplied manifests unchanged', () => {
  const expected = manifest([file(first)]);
  const actual = manifest([file(second)]);
  const before = JSON.stringify({ expected, actual });

  compareEvidenceManifests(expected, actual);

  assert.equal(JSON.stringify({ expected, actual }), before);
});async function backupFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'evidence-comparison-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const source = join(root, 'source');
  const backup = join(root, 'backup');
  await mkdir(source);
  await mkdir(backup);

  for (const id of [first, second]) {
    await writeFile(join(source, id), `synthetic-${id}`);
    await copyFile(join(source, id), join(backup, id));
  }

  return { source, backup };
}

test('copied temporary files produce matching manifests', async t => {
  const f = await backupFixture(t);
  const expected = await createEvidenceManifest(f.source);
  const actual = await createEvidenceManifest(f.backup);

  const result = compareEvidenceManifests(expected, actual);

  assert.equal(result.exactMatch, true);
  assert.equal(result.counts.expected, 2);
  assert.equal(result.counts.actual, 2);
  assert.equal(result.restorationVerified, false);
});

test('temporary backup changes report missing, changed and extra files', async t => {
  const f = await backupFixture(t);
  const third = '00000000-0000-4000-8000-000000000003';
  const expected = await createEvidenceManifest(f.source);

  await writeFile(join(f.backup, first), 'synthetic-changed');
  await unlink(join(f.backup, second));
  await writeFile(join(f.backup, third), 'synthetic-extra');

  const actual = await createEvidenceManifest(f.backup);
  const result = compareEvidenceManifests(expected, actual);

  assert.equal(result.exactMatch, false);
  assert.deepEqual(result.missing, [second]);
  assert.deepEqual(result.changed, [first]);
  assert.deepEqual(result.extra, [third]);
  assert.equal(result.deletionAuthorized, false);
});
