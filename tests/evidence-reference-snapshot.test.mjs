import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp, writeFile, truncate, rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readEvidenceReferenceSnapshot,
} from '../lib/events/evidence-reference-snapshot.js';

const photoId = '00000000-0000-4000-8000-000000000001';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-reference-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function snapshot(changes = {}) {
  return {
    version: 1,
    referencesComplete: true,
    truncated: false,
    registrations: [{ 签到照片ID: photoId }],
    ...changes,
  };
}

async function save(directory, value) {
  const path = join(directory, 'snapshot.json');
  await writeFile(path, JSON.stringify(value), 'utf8');
  return path;
}

const unavailable = error =>
  error.code === 'evidence_reference_snapshot_unavailable'
  && error.statusCode === 503;

test('complete minimal reference snapshots are accepted', async t => {
  const directory = await temporaryDirectory(t);
  const path = await save(directory, snapshot());

  assert.deepEqual(await readEvidenceReferenceSnapshot(path), [
    { 签到照片ID: photoId },
  ]);
});

test('explicitly complete empty snapshots are accepted', async t => {
  const directory = await temporaryDirectory(t);
  const path = await save(directory, snapshot({ registrations: [] }));

  assert.deepEqual(await readEvidenceReferenceSnapshot(path), []);
});

test('unconfirmed or truncated snapshots are rejected', async t => {
  const directory = await temporaryDirectory(t);

  for (const changes of [
    { referencesComplete: false },
    { referencesComplete: 'true' },
    { truncated: true },
    { truncated: undefined },
    { version: 2 },
    { registrations: null },
  ]) {
    const path = await save(directory, snapshot(changes));
    await assert.rejects(readEvidenceReferenceSnapshot(path), unavailable);
  }
});

test('registration fields beyond photo references are rejected', async t => {
  const directory = await temporaryDirectory(t);
  const path = await save(directory, snapshot({
    registrations: [{
      签到照片ID: photoId,
      姓名: '模拟姓名',
    }],
  }));

  await assert.rejects(readEvidenceReferenceSnapshot(path), unavailable);
});

test('malformed photo references are rejected', async t => {
  const directory = await temporaryDirectory(t);
  const path = await save(directory, snapshot({
    registrations: [{ 签到照片ID: '../outside' }],
  }));

  await assert.rejects(readEvidenceReferenceSnapshot(path), unavailable);
});

test('invalid JSON and invalid UTF-8 fail safely', async t => {
  const directory = await temporaryDirectory(t);
  const path = join(directory, 'snapshot.json');

  for (const bytes of [
    Buffer.from('synthetic-private-invalid-json'),
    Buffer.from([0xff, 0xfe]),
  ]) {
    await writeFile(path, bytes);
    await assert.rejects(readEvidenceReferenceSnapshot(path), error => {
      assert.ok(unavailable(error));
      assert.equal(error.message.includes('synthetic-private'), false);
      return true;
    });
  }
});

test('missing files and directories cannot serve as snapshots', async t => {
  const directory = await temporaryDirectory(t);

  await assert.rejects(
    readEvidenceReferenceSnapshot(join(directory, 'missing.json')),
    error => unavailable(error) && !error.message.includes(directory),
  );
  await assert.rejects(
    readEvidenceReferenceSnapshot(directory),
    unavailable,
  );
});

test('snapshots exceeding the byte limit are rejected', async t => {
  const directory = await temporaryDirectory(t);
  const path = join(directory, 'oversized.json');
  await writeFile(path, '');
  await truncate(path, 16 * 1024 * 1024 + 1);

  await assert.rejects(readEvidenceReferenceSnapshot(path), unavailable);
});