import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'material-inspection-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const directory of [
    'scripts',
    'lib/materials',
    'lib/http',
    'public',
    'state',
  ]) {
    await mkdir(join(root, directory), { recursive: true });
  }

  await writeFile(join(root, 'package.json'), '{"type":"module"}');

  for (const file of [
    'scripts/inspect-material-state.mjs',
    'lib/materials/inspection.js',
    'lib/http/private-state-directory.js',
  ]) {
    await copyFile(
      new URL(`../${file}`, import.meta.url),
      join(root, file),
    );
  }

  const directory = join(root, 'state');
  const file = join(directory, 'material-receipts.sqlite');

  function createDatabase() {
    const db = new DatabaseSync(file);
    try {
      db.exec(`
        CREATE TABLE material_receipts (
          operation_key TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          document TEXT NOT NULL
        );
        INSERT INTO material_receipts VALUES (
          'private-operation',
          'flow_attempted',
          '{"actor":"private-person"}'
        );
      `);
    } finally {
      db.close();
    }
  }

  async function run(args = [], overrides = {}) {
    const options = {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PLATFORM_WRITE_STATE_DIR: directory,
        ...overrides,
      },
      timeout: 10000,
      encoding: 'utf8',
    };

    try {
      const result = await exec(
        process.execPath,
        [join(root, 'scripts/inspect-material-state.mjs'), ...args],
        options,
      );
      return { ...result, code: 0 };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      return {
        code: error.code,
        stdout: error.stdout,
        stderr: error.stderr,
      };
    }
  }

  return { root, directory, file, createDatabase, run };
}

test('CLI reports counts without exposing private fields', async t => {
  const f = await fixture(t);
  f.createDatabase();

  const result = await f.run();
  assert.equal(result.code, 0);

  const output = JSON.parse(result.stdout);
  assert.equal(output.unfinished, 1);
  assert.equal(output.states.flow_attempted, 1);
  assert.equal(output.writes, 0);
  assert.equal(output.networkRequests, 0);
  assert.equal(result.stdout.includes('private-person'), false);
  assert.equal(result.stdout.includes('private-operation'), false);
});

test('missing database fails without creating a replacement', async t => {
  const f = await fixture(t);
  const result = await f.run();

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes(f.root), false);
  await assert.rejects(stat(f.file), { code: 'ENOENT' });
});

test('unsupported arguments fail before opening the database', async t => {
  const f = await fixture(t);
  const result = await f.run(['--apply']);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  await assert.rejects(stat(f.file), { code: 'ENOENT' });
});

test('production requires an explicit state directory', async t => {
  const f = await fixture(t);
  const result = await f.run([], {
    NODE_ENV: 'production',
    PLATFORM_WRITE_STATE_DIR: '',
  });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  await assert.rejects(stat(join(f.root, '.write-state')), {
    code: 'ENOENT',
  });
});

test('a state directory inside public is rejected', async t => {
  const f = await fixture(t);
  const result = await f.run([], {
    PLATFORM_WRITE_STATE_DIR: join(f.root, 'public'),
  });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  await assert.rejects(
    stat(join(f.root, 'public', 'material-receipts.sqlite')),
    { code: 'ENOENT' },
  );
});

test('invalid database contents produce a sanitized failure', async t => {
  const f = await fixture(t);
  await writeFile(f.file, 'private-invalid-database');

  const result = await f.run();
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('private-invalid-database'), false);
  assert.equal(result.stderr.includes(f.root), false);
});