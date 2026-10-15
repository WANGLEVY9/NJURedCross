import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(
  new URL('../scripts/export-evidence-manifest.mjs', import.meta.url),
);
const id = '00000000-0000-4000-8000-000000000001';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'manifest-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
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
    assert.match(error.stderr, /照片校验清单导出失败/);
    return true;
  });
}

test('an explicit empty directory exports a valid empty manifest', async t => {
  const directory = await fixture(t);
  const output = await run([`--directory=${directory}`]);
  const result = JSON.parse(output.stdout);

  assert.equal(output.stderr, '');
  assert.equal(result.version, 1);
  assert.equal(result.scope, 'uuid-named-files');
  assert.equal(result.totalBytes, 0);
  assert.deepEqual(result.files, []);
  assert.equal(result.writes, 0);
  assert.equal(result.deletes, 0);
  assert.ok(Number.isFinite(Date.parse(result.generatedAt)));
});

test('exported file checksums match the temporary file contents', async t => {
  const directory = await fixture(t);
  const bytes = Buffer.from('synthetic-evidence');
  await writeFile(join(directory, id), bytes);

  const output = await run([`--directory=${directory}`]);
  const result = JSON.parse(output.stdout);

  assert.deepEqual(result.files, [{
    id,
    bytes: bytes.length,
    algorithm: 'sha256',
    digest: createHash('sha256').update(bytes).digest('hex'),
  }]);
  assert.deepEqual(await readFile(join(directory, id)), bytes);
});

test('missing or unsupported arguments cannot start export', async () => {
  for (const args of [
    [],
    ['--apply'],
    ['--directory='],
    ['--directory=relative', '--apply'],
  ]) {
    await rejected(args);
  }
});

test('relative directories are rejected', async () => {
  await rejected(['--directory=relative-directory']);
});

test('missing directories cannot produce a successful empty manifest', async t => {
  const directory = await fixture(t);
  await rejected([`--directory=${join(directory, 'missing')}`]);
});

test('public directories are rejected', async () => {
  for (const directory of [
    join(root, 'public'),
    join(root, 'public', 'synthetic-evidence'),
  ]) {
    await rejected([`--directory=${directory}`]);
  }
});

test('invalid evidence prevents partial JSON output', async t => {
  const directory = await fixture(t);
  await writeFile(join(directory, id), Buffer.alloc(0));

  await rejected([`--directory=${directory}`]);
  assert.equal((await readFile(join(directory, id))).length, 0);
});

test('an explicit output saves complete UTF-8 JSON in a separate directory', async t => {
  const directory = await fixture(t);
  const reports = await fixture(t);
  const outputPath = join(reports, 'manifest.json');
  const bytes = Buffer.from('synthetic-evidence');
  await writeFile(join(directory, id), bytes);

  const output = await run([
    `--directory=${directory}`,
    `--output=${outputPath}`,
  ]);

  const summary = JSON.parse(output.stdout);
  const saved = JSON.parse(await readFile(outputPath, 'utf8'));

  assert.equal(summary.saved, true);
  assert.equal(summary.overwritten, false);
  assert.equal(summary.encoding, 'utf8');
  assert.equal(summary.files, 1);
  assert.equal(saved.files[0].id, id);
  assert.equal(saved.files[0].bytes, bytes.length);
  assert.equal(
    saved.files[0].digest,
    createHash('sha256').update(bytes).digest('hex'),
  );
  assert.deepEqual(await readdir(reports), ['manifest.json']);
});

test('CLI saving refuses to overwrite an existing destination', async t => {
  const directory = await fixture(t);
  const reports = await fixture(t);
  const outputPath = join(reports, 'manifest.json');
  await writeFile(outputPath, 'existing-private-file');

  await rejected([
    `--directory=${directory}`,
    `--output=${outputPath}`,
  ]);

  assert.equal(await readFile(outputPath, 'utf8'), 'existing-private-file');
  assert.deepEqual(await readdir(reports), ['manifest.json']);
});

test('output inside the evidence directory is rejected', async t => {
  const directory = await fixture(t);

  await rejected([
    `--directory=${directory}`,
    `--output=${join(directory, 'manifest.json')}`,
  ]);

  assert.deepEqual(await readdir(directory), []);
});

test('a missing output directory is not created automatically', async t => {
  const directory = await fixture(t);
  const reports = await fixture(t);

  await rejected([
    `--directory=${directory}`,
    `--output=${join(reports, 'missing', 'manifest.json')}`,
  ]);

  assert.deepEqual(await readdir(reports), []);
});

test('invalid evidence cannot publish an output manifest', async t => {
  const directory = await fixture(t);
  const reports = await fixture(t);
  await writeFile(join(directory, id), Buffer.alloc(0));

  await rejected([
    `--directory=${directory}`,
    `--output=${join(reports, 'manifest.json')}`,
  ]);

  assert.deepEqual(await readdir(reports), []);
});