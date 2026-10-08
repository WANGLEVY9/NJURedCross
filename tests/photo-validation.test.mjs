import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { withRequestBudget } from '../lib/http/request-budget.js';
import { validateAttendancePhoto } from '../lib/events/photo-validation.js';

async function image(format, width = 32, height = 24) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 100, b: 160 },
    },
  }).toFormat(format).toBuffer();
}

test('complete JPEG, PNG and WebP images pass validation', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const bytes = await image(format);
    const before = Buffer.from(bytes);
    const result = await validateAttendancePhoto(bytes);

    assert.equal(result.contentType, `image/${format}`);
    assert.equal(result.width, 32);
    assert.equal(result.height, 24);
    assert.deepEqual(bytes, before);
  }
});

test('a plausible image header is insufficient without valid pixel data', async () => {
  const bytes = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);

  await assert.rejects(
    validateAttendancePhoto(bytes),
    { code: 'invalid_attendance_photo', statusCode: 400 },
  );
});

test('truncated JPEG, PNG and WebP images are rejected', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const bytes = await image(format);

    await assert.rejects(
      validateAttendancePhoto(bytes.subarray(0, Math.floor(bytes.length / 2))),
      { code: 'invalid_attendance_photo', statusCode: 400 },
    );
  }
});

test('unsupported SVG input is rejected without exposing decoder details', async () => {
  const bytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
      + '<rect width="10" height="10" fill="red"/></svg>',
  );

  await assert.rejects(
    validateAttendancePhoto(bytes),
    error => error.code === 'invalid_attendance_photo'
      && error.statusCode === 400
      && !error.message.includes('<svg'),
  );
});

test('images exceeding the maximum dimension are rejected', async () => {
  const bytes = await image('png', 6001, 1);

  await assert.rejects(
    validateAttendancePhoto(bytes),
    { code: 'invalid_attendance_photo', statusCode: 400 },
  );
});

test('compressed images exceeding the pixel limit are rejected', async () => {
  const bytes = await image('png', 4000, 3001);
  assert.ok(bytes.length < 4 * 1024 * 1024);

  await assert.rejects(
    validateAttendancePhoto(bytes),
    { code: 'invalid_attendance_photo', statusCode: 400 },
  );
});

test('files exceeding four megabytes are rejected before decoding', async () => {
  await assert.rejects(
    validateAttendancePhoto(Buffer.alloc(4 * 1024 * 1024 + 1)),
    { code: 'attendance_photo_too_large', statusCode: 413 },
  );
});

test('empty and non-buffer inputs are rejected', async () => {
  for (const value of [null, undefined, '', Buffer.alloc(0)]) {
    await assert.rejects(
      validateAttendancePhoto(value),
      { code: 'invalid_attendance_photo', statusCode: 400 },
    );
  }
});

test('animated WebP is rejected instead of validating only its first frame', async () => {
  const first = await image('png');
  const second = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 180, g: 30, b: 50 },
    },
  }).png().toBuffer();

  const bytes = await sharp(
    [first, second],
    { join: { animated: true } },
  ).webp({
    loop: 0,
    delay: [100, 100],
  }).toBuffer();

  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.pages, 2);

  await assert.rejects(
    validateAttendancePhoto(bytes),
    { code: 'invalid_attendance_photo', statusCode: 400 },
  );
});

test('already cancelled requests stop before photo validation begins', async () => {
  const bytes = await image('jpeg');
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    withRequestBudget(
      () => validateAttendancePhoto(bytes),
      { signal: controller.signal },
    ),
    { code: 'external_request_cancelled' },
  );
});