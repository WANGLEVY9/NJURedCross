import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
  access,
  realpath,
  link,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAuditStorageDirectory } from '../lib/audit/storage-directory.js';

async function fixture(t) {
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, 'audit-directory-'));
  const publicDir = join(root, 'public');
  await mkdir(publicDir);

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return { root, publicDir };
}

test('disabled audit storage does not inspect the filesystem', async () => {
  await validateAuditStorageDirectory(null, '');
});

test('an existing private directory passes without changes', async t => {
  const f = await fixture(t);
  const directory = join(f.root, 'private-state');
  await mkdir(directory);

  await validateAuditStorageDirectory({ directory }, f.publicDir);
  await access(directory);
});

test('a missing private directory is validated without being created', async t => {
  const f = await fixture(t);
  const directory = join(f.root, 'private-state', 'nested');

  await validateAuditStorageDirectory({ directory }, f.publicDir);
  await assert.rejects(access(directory), { code: 'ENOENT' });
});

test('public directory and missing descendants are rejected', async t => {
  const f = await fixture(t);

  for (const directory of [
    f.publicDir,
    join(f.publicDir, 'not-created', 'state'),
  ]) {
    await assert.rejects(
      validateAuditStorageDirectory({ directory }, f.publicDir),
      { code: 'audit_storage_directory_unavailable' },
    );
  }
});

test('a file cannot serve as a state directory or its ancestor', async t => {
  const f = await fixture(t);
  const file = join(f.root, 'blocked');
  await writeFile(file, 'synthetic');

  for (const directory of [file, join(file, 'state')]) {
    await assert.rejects(
      validateAuditStorageDirectory({ directory }, f.publicDir),
      { code: 'audit_storage_directory_unavailable' },
    );
  }
});

test('linked directories cannot redirect private state into public storage', async t => {
  const f = await fixture(t);
  const link = join(f.root, 'apparently-private');
  await symlink(
    f.publicDir,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  for (const directory of [link, join(link, 'not-created', 'state')]) {
    await assert.rejects(
      validateAuditStorageDirectory({ directory }, f.publicDir),
      { code: 'audit_storage_directory_unavailable' },
    );
  }
});

test('regular database and auxiliary files pass without modification', async t => {
  const f = await fixture(t);
  const directory = join(f.root, 'private-state');
  await mkdir(directory);

  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await writeFile(
      join(directory, 'audit-reconciliation.sqlite' + suffix),
      'synthetic-file',
    );
  }

  await validateAuditStorageDirectory({ directory }, f.publicDir);
});

test('directories cannot replace database or auxiliary files', async t => {
  const f = await fixture(t);
  const directory = join(f.root, 'private-state');
  await mkdir(directory);

  for (const name of [
    'audit-reconciliation.sqlite',
    'audit-reconciliation.sqlite-wal',
    'mail-retries.sqlite-shm',
  ]) {
    const target = join(directory, name);
    await mkdir(target);

    await assert.rejects(
      validateAuditStorageDirectory({ directory }, f.publicDir),
      { code: 'audit_storage_directory_unavailable' },
    );

    await rm(target, { recursive: true });
  }
});

test('hard-linked database files are rejected', async t => {
  const f = await fixture(t);
  const directory = join(f.root, 'private-state');
  await mkdir(directory);

  const original = join(f.root, 'synthetic-original');
  await writeFile(original, 'synthetic-file');
  await link(original, join(directory, 'audit-reconciliation.sqlite'));

  await assert.rejects(
    validateAuditStorageDirectory({ directory }, f.publicDir),
    { code: 'audit_storage_directory_unavailable' },
  );
});