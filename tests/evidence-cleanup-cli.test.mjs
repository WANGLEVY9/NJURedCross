import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp, mkdir, writeFile, readFile, readdir, utimes, rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const script = fileURLToPath(
  new URL('../scripts/preview-evidence-cleanup.mjs', import.meta.url),
);
const nowMs = Date.UTC(2026, 9, 8);
const oldTime = new Date(Date.UTC(2020, 0, 1));
const id = number =>
  `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cleanup-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const directory = join(root, 'photos');
  const references = join(root, 'references.json');
  await mkdir(directory);

  async function saveReferences(changes = {}) {
    await writeFile(references, JSON.stringify({
      version: 1,
      referencesComplete: true,
      truncated: false,
      registrations: [],
      ...changes,
    }), 'utf8');
  }

  async function addFile(name) {
    const path = join(directory, name);
    await writeFile(path, 'synthetic-evidence');
    await utimes(path, oldTime, oldTime);
  }

  await saveReferences();

  const args = [
    `--references=${references}`,
    `--directory=${directory}`,
    '--min-age-ms=86400000',
    `--now-ms=${nowMs}`,
  ];

  async function run(extra = []) {
    return execute(process.execPath, [script, ...args, ...extra], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
  }

  return {
    directory, references, saveReferences, addFile, args, run,
  };
}

function failed(error) {
  assert.equal(error.code, 1);
  assert.equal(error.stdout, '');
  assert.match(error.stderr, /no files were modified/);
  return true;
}

test('CLI previews an old unreferenced file without authorizing deletion', async t => {
  const f = await fixture(t);
  await f.addFile(id(1));

  const result = JSON.parse((await f.run()).stdout);
  assert.equal(result.counts.reviewCandidates, 1);
  assert.equal(result.reviewCandidates[0].id, id(1));
  assert.equal(result.writes, 0);
  assert.equal(result.deletes, 0);
  assert.equal(result.networkRequests, 0);
  assert.equal(result.deletionAuthorized, false);
  assert.equal(result.atomicSnapshot, false);
});

test('CLI excludes referenced files from candidates', async t => {
  const f = await fixture(t);
  await f.addFile(id(1));
  await f.saveReferences({
    registrations: [{ 签到照片ID: id(1) }],
  });

  const result = JSON.parse((await f.run()).stdout);
  assert.deepEqual(result.reviewCandidates, []);
  assert.equal(result.retainedReasons.referenced, 1);
});

test('CLI does not expose unknown filenames or input paths', async t => {
  const f = await fixture(t);
  const privateName = 'synthetic-private-name.txt';
  await f.addFile(privateName);

  const { stdout } = await f.run();
  const result = JSON.parse(stdout);
  assert.equal(result.retainedReasons.unrecognized_name, 1);
  assert.equal(stdout.includes(privateName), false);
  assert.equal(stdout.includes(f.directory), false);
  assert.equal(stdout.includes(f.references), false);
});

test('CLI rejects unconfirmed references', async t => {
  const f = await fixture(t);
  await f.saveReferences({ referencesComplete: false });
  await assert.rejects(f.run(), failed);
});

test('CLI sanitizes malformed snapshot failures', async t => {
  const f = await fixture(t);
  await writeFile(f.references, 'synthetic-private-invalid-json');

  await assert.rejects(f.run(), error => {
    assert.ok(failed(error));
    assert.equal(error.stderr.includes('synthetic-private'), false);
    assert.equal(error.stderr.includes(f.references), false);
    return true;
  });
});

test('CLI rejects write flags, repeated options and invalid ages', async t => {
  const f = await fixture(t);

  for (const extra of [
    ['--apply'],
    ['--delete=true'],
    ['--min-age-ms=1'],
  ]) {
    await assert.rejects(f.run(extra), failed);
  }

  const invalidAgeArgs = f.args.map(argument =>
    argument.startsWith('--min-age-ms=') ? '--min-age-ms=0' : argument,
  );
  await assert.rejects(
    execute(process.execPath, [script, ...invalidAgeArgs], {
      timeout: 5000,
    }),
    failed,
  );
});

test('CLI limits samples while preserving the full candidate count', async t => {
  const f = await fixture(t);
  for (let number = 1; number <= 21; number++) {
    await f.addFile(id(number));
  }

  const result = JSON.parse((await f.run()).stdout);
  assert.equal(result.counts.reviewCandidates, 21);
  assert.equal(result.reviewCandidates.length, 20);
  assert.equal(result.samplesLimited, true);
});

test('CLI leaves snapshot and evidence contents unchanged', async t => {
  const f = await fixture(t);
  await f.addFile(id(1));

  const snapshotBefore = await readFile(f.references);
  const namesBefore = await readdir(f.directory);

  await f.run();

  assert.deepEqual(await readFile(f.references), snapshotBefore);
  assert.deepEqual(await readdir(f.directory), namesBefore);
  assert.equal(
    await readFile(join(f.directory, id(1)), 'utf8'),
    'synthetic-evidence',
  );
});