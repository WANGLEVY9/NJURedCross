import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(
  new URL('../scripts/compare-evidence-manifests.mjs', import.meta.url),
);
const id = '00000000-0000-4000-8000-000000000001';

function manifest(digest = 'a'.repeat(64)) {
  return {
    version: 1,
    scope: 'uuid-named-files',
    totalBytes: 10,
    files: [{ id, bytes: 10, algorithm: 'sha256', digest }],
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'comparison-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const expected = join(directory, 'expected.json');
  const actual = join(directory, 'actual.json');
  await writeFile(expected, JSON.stringify(manifest()));
  await writeFile(actual, JSON.stringify(manifest()));

  return {
    directory,
    expected,
    actual,
    args: [`--expected=${expected}`, `--actual=${actual}`],
  };
}

function run(args) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return execute(process.execPath, [script, ...args], {
    cwd: root,
    env,
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
}

async function rejected(args) {
  await assert.rejects(run(args), error => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /照片清单比较失败/);
    return true;
  });
}

test('matching manifests exit successfully without changing inputs', async t => {
  const f = await fixture(t);
  const before = await readFile(f.expected, 'utf8');
  const output = await run(f.args);
  const result = JSON.parse(output.stdout);

  assert.equal(output.stderr, '');
  assert.equal(result.exactMatch, true);
  assert.equal(result.restorationVerified, false);
  assert.equal(result.deletionAuthorized, false);
  assert.equal(await readFile(f.expected, 'utf8'), before);
});

test('completed comparison with differences exits with code 2', async t => {
  const f = await fixture(t);
  await writeFile(f.actual, JSON.stringify(manifest('b'.repeat(64))));

  await assert.rejects(run(f.args), error => {
    assert.equal(error.code, 2);
    assert.equal(error.stderr, '');
    const result = JSON.parse(error.stdout);
    assert.equal(result.exactMatch, false);
    assert.deepEqual(result.changedSample, [id]);
    assert.equal(result.counts.changed, 1);
    return true;
  });
});

test('invalid JSON exits with code 1 and no successful report', async t => {
  const f = await fixture(t);
  await writeFile(f.actual, 'invalid-json');
  await rejected(f.args);
});

test('invalid manifest schema exits with code 1', async t => {
  const f = await fixture(t);
  await writeFile(f.actual, JSON.stringify({ files: [] }));
  await rejected(f.args);
});

test('missing files cannot be treated as empty manifests', async t => {
  const f = await fixture(t);
  await rejected([
    `--expected=${f.expected}`,
    `--actual=${join(f.directory, 'missing.json')}`,
  ]);
});

test('missing, repeated and unsupported arguments are rejected', async t => {
  const f = await fixture(t);

  for (const args of [
    [],
    [`--expected=${f.expected}`],
    [`--expected=${f.expected}`, `--expected=${f.actual}`],
    [...f.args, '--apply'],
  ]) {
    await rejected(args);
  }
});

test('relative paths are rejected', async () => {
  await rejected([
    '--expected=expected.json',
    '--actual=actual.json',
  ]);
});

test('oversized manifest files are rejected before comparison', async t => {
  const f = await fixture(t);
  await writeFile(f.actual, Buffer.alloc(16 * 1024 * 1024 + 1));
  await rejected(f.args);
});