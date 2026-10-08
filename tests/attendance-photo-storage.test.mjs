import test from 'node:test';
import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { storePhoto } from '../lib/events/attendance-photo.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

async function fixture(t) {
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, 'attendance-photo-storage-'));
  const directory = join(root, 'photos');
  const previous = process.env.WORKFLOW_EVIDENCE_DIR;

  process.env.WORKFLOW_EVIDENCE_DIR = directory;

  t.after(async () => {
    if (previous === undefined) {
      delete process.env.WORKFLOW_EVIDENCE_DIR;
    } else {
      process.env.WORKFLOW_EVIDENCE_DIR = previous;
    }
    await rm(root, { recursive: true, force: true });
  });

  return { directory };
}

async function image(format) {
  return sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 40, g: 100, b: 160 },
    },
  }).toFormat(format).toBuffer();
}

test('valid photos are saved with their original bytes', async t => {
  const f = await fixture(t);

  for (const format of ['jpeg', 'png', 'webp']) {
    const bytes = await image(format);
    const id = await storePhoto(Readable.from([bytes]));

    assert.match(
      id,
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
    );
    assert.deepEqual(await readFile(join(f.directory, id)), bytes);
  }

  assert.equal((await readdir(f.directory)).length, 3);
});

test('damaged photos are rejected before creating the evidence directory', async t => {
  const f = await fixture(t);
  const bytes = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);

  await assert.rejects(
    storePhoto(Readable.from([bytes])),
    { code: 'invalid_attendance_photo', statusCode: 400 },
  );

  await assert.rejects(access(f.directory), { code: 'ENOENT' });
});

test('oversized uploads do not create the evidence directory', async t => {
  const f = await fixture(t);

  await assert.rejects(
    storePhoto(Readable.from([Buffer.alloc(4 * 1024 * 1024 + 1)])),
    { statusCode: 413 },
  );

  await assert.rejects(access(f.directory), { code: 'ENOENT' });
});

test('already cancelled uploads do not create the evidence directory', async t => {
  const f = await fixture(t);
  const bytes = await image('png');
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    withRequestBudget(
      () => storePhoto(Readable.from([bytes])),
      { signal: controller.signal },
    ),
    { code: 'external_request_cancelled' },
  );

  await assert.rejects(access(f.directory), { code: 'ENOENT' });
});