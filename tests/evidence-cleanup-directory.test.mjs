import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp, mkdir, writeFile, readFile, rm, link,symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readEvidenceCleanupDirectory,
} from '../lib/events/evidence-cleanup-directory.js';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-cleanup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const unavailable = error =>
  error.code === 'evidence_cleanup_directory_unavailable'
  && error.statusCode === 503;

test('empty directory returns an empty inventory', async t => {
  const directory = await temporaryDirectory(t);
  assert.deepEqual(await readEvidenceCleanupDirectory(directory), []);
});

test('regular files expose metadata without changing contents', async t => {
  const directory = await temporaryDirectory(t);
  const path = join(directory, 'photo');
  await writeFile(path, 'synthetic-photo');

  const files = await readEvidenceCleanupDirectory(directory);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'photo');
  assert.equal(files[0].isRegularFile, true);
  assert.equal(files[0].size, Buffer.byteLength('synthetic-photo'));
  assert.ok(Number.isFinite(files[0].mtimeMs));
  assert.equal(files[0].nlink, 1);
  assert.equal(await readFile(path, 'utf8'), 'synthetic-photo');
});

test('subdirectories are reported without scanning their contents', async t => {
  const directory = await temporaryDirectory(t);
  await mkdir(join(directory, 'nested'));
  await writeFile(join(directory, 'nested', 'hidden-photo'), 'synthetic');

  const files = await readEvidenceCleanupDirectory(directory);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'nested');
  assert.equal(files[0].isRegularFile, false);
});

test('hard-linked files retain their link count for preview exclusion', async t => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, 'first'), 'synthetic');
  await link(join(directory, 'first'), join(directory, 'second'));

  const files = await readEvidenceCleanupDirectory(directory);
  assert.deepEqual(files.map(file => file.name), ['first', 'second']);
  assert.ok(files.every(file => file.isRegularFile && file.nlink === 2));
});

test('inventory is sorted by filename', async t => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, 'z-photo'), 'z');
  await writeFile(join(directory, 'a-photo'), 'a');

  const files = await readEvidenceCleanupDirectory(directory);
  assert.deepEqual(files.map(file => file.name), ['a-photo', 'z-photo']);
});

test('exactly reaching the entry limit is permitted', async t => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, 'photo'), 'synthetic');

  const files = await readEvidenceCleanupDirectory(directory, {
    maxEntries: 1,
  });
  assert.equal(files.length, 1);
});

test('exceeding the entry limit rejects the entire inventory', async t => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, 'first'), 'synthetic');
  await writeFile(join(directory, 'second'), 'synthetic');

  await assert.rejects(
    readEvidenceCleanupDirectory(directory, { maxEntries: 1 }),
    unavailable,
  );
});

test('missing directories fail with a sanitized error', async t => {
  const directory = await temporaryDirectory(t);
  const missing = join(directory, 'private-missing-directory');

  await assert.rejects(readEvidenceCleanupDirectory(missing), error => {
    assert.ok(unavailable(error));
    assert.equal(error.message.includes(missing), false);
    return true;
  });
});

test('a regular file cannot be scanned as a directory', async t => {
  const directory = await temporaryDirectory(t);
  const path = join(directory, 'file');
  await writeFile(path, 'synthetic');

  await assert.rejects(readEvidenceCleanupDirectory(path), unavailable);
});

test('invalid scan options are rejected before filesystem access', async () => {
  for (const directory of [undefined, null, '', '   ', 123]) {
    await assert.rejects(
      readEvidenceCleanupDirectory(directory),
      TypeError,
    );
  }

  for (const maxEntries of [0, -1, 1.5, 100001, NaN, '10']) {
    await assert.rejects(
      readEvidenceCleanupDirectory('unused', { maxEntries }),
      TypeError,
    );
  }
});

test('linked directories are reported without reading their target', async t => {
  const directory = await temporaryDirectory(t);
  const target = await temporaryDirectory(t);
  await writeFile(join(target, 'private-photo'), 'synthetic');

  await symlink(
    target,
    join(directory, 'linked-directory'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  const files = await readEvidenceCleanupDirectory(directory);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'linked-directory');
  assert.equal(files[0].isRegularFile, false);
  assert.equal(
    await readFile(join(target, 'private-photo'), 'utf8'),
    'synthetic',
  );
});

test('a linked root directory cannot be scanned', async t => {
  const directory = await temporaryDirectory(t);
  const target = await temporaryDirectory(t);
  const linkedRoot = join(directory, 'linked-root');

  await symlink(
    target,
    linkedRoot,
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  await assert.rejects(
    readEvidenceCleanupDirectory(linkedRoot),
    unavailable,
  );
});