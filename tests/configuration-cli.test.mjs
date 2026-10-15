import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

async function fixture(t) {
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, 'configuration-cli-'));

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const files = [
    'scripts/check-local-configuration.mjs',
    'lib/maintenance/configuration-check.js',
    'lib/maintenance/configuration-storage.js',
    'lib/audit/config.js',
    'lib/http/private-state-directory.js',
  ];

  for (const file of files) {
    const destination = join(root, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(new URL(`../${file}`, import.meta.url), destination);
  }

  await mkdir(join(root, 'public'));

  function run(overrides = {}, args = []) {
    const env = { ...process.env };

    for (const key of Object.keys(env)) {
      if (
        /^(SEATABLE_|PLATFORM_|SMTP_|MATERIALS_)/.test(key)
        || key === 'NODE_ENV'
        || key === 'NODE_OPTIONS'
      ) {
        delete env[key];
      }
    }

    Object.assign(env, {
      NODE_ENV: 'development',
      SEATABLE_API_TOKEN: 'synthetic-private-business-token',
      PLATFORM_SESSION_SECRET: 'synthetic-private-secret-at-least-32-characters',
    }, overrides);

    return spawnSync(
      process.execPath,
      [join(root, 'scripts/check-local-configuration.mjs'), ...args],
      {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      },
    );
  }

  return { root, run };
}

test('CLI reports valid configuration without creating state files', async t => {
  const f = await fixture(t);
  const before = (await readdir(f.root)).sort();
  const result = f.run();

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.writes, 0);
  assert.equal(body.networkRequests, 0);
  assert.equal(body.storageChecks.length, 3);
  assert.deepEqual((await readdir(f.root)).sort(), before);
  assert.equal(result.stdout.includes('synthetic-private'), false);
});

test('CLI rejects public storage without exposing its configured path', async t => {
  const f = await fixture(t);
  const directory = join(f.root, 'public', 'synthetic-private-state');
  const result = f.run({ PLATFORM_WRITE_STATE_DIR: directory });

  assert.equal(result.status, 1);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.equal(
    body.storageChecks.some(item => (
      item.field === 'PLATFORM_WRITE_STATE_DIR'
      && item.status === 'failed'
    )),
    true,
  );
  assert.equal(result.stdout.includes(f.root), false);
  assert.equal(result.stdout.includes('synthetic-private'), false);
  assert.deepEqual(await readdir(join(f.root, 'public')), []);
});

test('CLI reports invalid credentials without printing their values', async t => {
  const f = await fixture(t);
  const secret = 'synthetic-private-short-secret';
  const result = f.run({ PLATFORM_SESSION_SECRET: secret });

  assert.equal(result.status, 1);
  const body = JSON.parse(result.stdout);
  assert.equal(body.errors.some(item => (
    item.field === 'PLATFORM_SESSION_SECRET'
    && item.code === 'invalid_session_secret'
  )), true);
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(result.stderr.includes(secret), false);
});

test('CLI rejects unsupported arguments without echoing them', async t => {
  const f = await fixture(t);
  const argument = '--synthetic-private-secret';
  const result = f.run({}, [argument]);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes(argument), false);
});