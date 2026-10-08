import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rm,
  writeFile,
  link,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectConfigurationStorage } from '../lib/maintenance/configuration-storage.js';

async function fixture(t) {
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, 'configuration-storage-'));
  await mkdir(join(root, 'public'));

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return { root };
}

function failed(result, field) {
  return result.checks.some(
    item => item.field === field && item.status === 'failed',
  );
}

test('development defaults pass without creating private directories', async t => {
  const f = await fixture(t);
  const before = await readdir(f.root);

  const result = await inspectConfigurationStorage({}, f);

  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 3);
  assert.deepEqual(await readdir(f.root), before);
});

test('public storage is rejected even with audit disabled', async t => {
  const f = await fixture(t);
  const result = await inspectConfigurationStorage({
    PLATFORM_AUDIT_RECONCILIATION_ENABLED: 'false',
    PLATFORM_WRITE_STATE_DIR: join(f.root, 'public', 'state'),
  }, f);

  assert.equal(result.ok, false);
  assert.equal(failed(result, 'PLATFORM_WRITE_STATE_DIR'), true);
  assert.deepEqual(await readdir(join(f.root, 'public')), []);
});

test('public or hard-linked revocation files are rejected', async t => {
  const f = await fixture(t);
  const original = join(f.root, 'synthetic-original');
  const linked = join(f.root, 'revocations.json');
  await writeFile(original, 'synthetic-file');
  await link(original, linked);

  for (const file of [
    join(f.root, 'public', 'revocations.json'),
    linked,
  ]) {
    const result = await inspectConfigurationStorage({
      PLATFORM_SESSION_REVOCATIONS_FILE: file,
    }, f);

    assert.equal(failed(result, 'PLATFORM_SESSION_REVOCATIONS_FILE'), true);
  }
});

test('production requires explicit storage and an absolute revocation path', async t => {
  const f = await fixture(t);

  const missing = await inspectConfigurationStorage({
    NODE_ENV: 'production',
  }, f);

  assert.equal(failed(missing, 'PLATFORM_WRITE_STATE_DIR'), true);
  assert.equal(failed(missing, 'PLATFORM_SESSION_REVOCATIONS_FILE'), true);

  const relative = await inspectConfigurationStorage({
    NODE_ENV: 'production',
    PLATFORM_WRITE_STATE_DIR: join(f.root, 'private-state'),
    PLATFORM_SESSION_REVOCATIONS_FILE: 'relative-revocations.json',
  }, f);

  assert.equal(failed(relative, 'PLATFORM_SESSION_REVOCATIONS_FILE'), true);
});

test('enabled audit requires its complete private storage configuration', async t => {
  const f = await fixture(t);
  const incomplete = await inspectConfigurationStorage({
    PLATFORM_AUDIT_RECONCILIATION_ENABLED: 'true',
  }, f);

  assert.equal(
    failed(incomplete, 'PLATFORM_AUDIT_RECONCILIATION_ENABLED'),
    true,
  );

  const complete = await inspectConfigurationStorage({
    NODE_ENV: 'production',
    PLATFORM_AUDIT_RECONCILIATION_ENABLED: 'true',
    SEATABLE_BUSINESS_BASE_UUID: '00000000-0000-4000-8000-000000000001',
    PLATFORM_WRITE_STATE_DIR: join(f.root, 'private-state'),
    PLATFORM_SESSION_REVOCATIONS_FILE: join(f.root, 'session', 'revocations.json'),
  }, f);

  assert.equal(complete.ok, true);
  assert.deepEqual(await readdir(f.root), ['public']);
});

test('failed checks expose no configured paths or private values', async t => {
  const f = await fixture(t);
  const result = await inspectConfigurationStorage({
    PLATFORM_WRITE_STATE_DIR: join(f.root, 'public', 'synthetic-private'),
    PLATFORM_SESSION_SECRET: 'synthetic-private-secret',
    SEATABLE_API_TOKEN: 'synthetic-private-token',
  }, f);

  const output = JSON.stringify(result);
  assert.equal(output.includes(f.root), false);
  assert.equal(output.includes('synthetic-private'), false);
});