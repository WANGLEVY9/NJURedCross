import test from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createSessionRevocations } from '../lib/identity/session-revocations.js';
import { createEvidenceManifest } from '../lib/events/evidence-manifest.js';
import { compareEvidenceManifests } from '../lib/events/evidence-comparison.js';

async function fixture(t) {
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, 'private-files-restore-'));

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return { root };
}

async function photoFixture(t) {
  const f = await fixture(t);
  const source = join(f.root, 'source');
  const backup = join(f.root, 'backup');
  const restored = join(f.root, 'restored');

  for (const directory of [source, backup, restored]) {
    await mkdir(directory);
  }

  const ids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  ];

  for (const [index, id] of ids.entries()) {
    const bytes = await sharp({
      create: {
        width: 16,
        height: 12,
        channels: 3,
        background: index === 0 ? '#ff0000' : '#0000ff',
      },
    }).png().toBuffer();

    await writeFile(join(source, id), bytes, { flag: 'wx' });
  }

  const expected = await createEvidenceManifest(source);

  for (const id of ids) {
    await copyFile(
      join(source, id),
      join(backup, id),
      constants.COPYFILE_EXCL,
    );
    await copyFile(
      join(backup, id),
      join(restored, id),
      constants.COPYFILE_EXCL,
    );
  }

  return { source, backup, restored, ids, expected };
}

test('restored revocation files keep old sessions revoked without extending expiry', async t => {
  const f = await fixture(t);
  const source = join(f.root, 'source-revocations.json');
  const backup = join(f.root, 'backup-revocations.json');
  const restored = join(f.root, 'restored-revocations.json');
  let now = 1000;
  const csrf = 'synthetic-private-session-csrf';

  const store = await createSessionRevocations({
    file: source,
    now: () => now,
  });
  await store.revoke(csrf, 10000);

  await copyFile(source, backup, constants.COPYFILE_EXCL);
  await copyFile(backup, restored, constants.COPYFILE_EXCL);

  now = 2000;
  const recovered = await createSessionRevocations({
    file: restored,
    now: () => now,
  });

  assert.equal(recovered.has(csrf), true);
  assert.equal(
    (await readFile(restored, 'utf8')).includes(csrf),
    false,
  );

  now = 11000;
  assert.equal(recovered.has(csrf), false);
});

test('restored photos match original bytes and checksum manifests', async t => {
  const f = await photoFixture(t);
  const actual = await createEvidenceManifest(f.restored);
  const comparison = compareEvidenceManifests(f.expected, actual);

  assert.equal(comparison.exactMatch, true);
  assert.equal(comparison.counts.missing, 0);
  assert.equal(comparison.counts.changed, 0);
  assert.equal(comparison.counts.extra, 0);

  for (const id of f.ids) {
    assert.deepEqual(
      await readFile(join(f.restored, id)),
      await readFile(join(f.source, id)),
    );
  }
});

test('restoration verification detects both missing and changed photos', async t => {
  const f = await photoFixture(t);

  await unlink(join(f.restored, f.ids[0]));
  await writeFile(
    join(f.restored, f.ids[1]),
    'synthetic-damaged-photo',
  );

  const actual = await createEvidenceManifest(f.restored);
  const comparison = compareEvidenceManifests(f.expected, actual);

  assert.equal(comparison.exactMatch, false);
  assert.deepEqual(comparison.missing, [f.ids[0]]);
  assert.deepEqual(comparison.changed, [f.ids[1]]);
  assert.equal(comparison.counts.extra, 0);
});