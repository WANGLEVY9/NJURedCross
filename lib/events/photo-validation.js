import sharp from 'sharp';
import { createPhotoWorkQueue } from './photo-work.js';

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 12_000_000;
const MAX_DIMENSION = 6000;
const runPhotoWork = createPhotoWorkQueue({
  concurrency: 2,
  maxWaiting: 4,
});

function invalid() {
  return Object.assign(
    new Error('图片无效、损坏或超出尺寸限制，仅支持静态 JPEG、PNG、WebP。'),
    { statusCode: 400, code: 'invalid_attendance_photo' },
  );
}

async function decodeAttendancePhoto(bytes, maxBytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw invalid();
  }

  if (bytes.length > maxBytes) {
    throw Object.assign(
      new Error(`图片不能超过${maxBytes / 1024 / 1024}MB。`),
      { statusCode: 413, code: 'attendance_photo_too_large' },
    );
  }

  let image;

  try {
    image = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: MAX_PIXELS,
      limitInputChannels: 4,
    }).timeout({ seconds: 5 });

    const metadata = await image.metadata();

    if (
      !['jpeg', 'png', 'webp'].includes(metadata.format)
      || !Number.isInteger(metadata.width)
      || !Number.isInteger(metadata.height)
      || metadata.width < 1
      || metadata.height < 1
      || metadata.width > MAX_DIMENSION
      || metadata.height > MAX_DIMENSION
      || metadata.width * metadata.height > MAX_PIXELS
      || (metadata.pages ?? 1) !== 1
    ) {
      throw invalid();
    }

    // Decode the complete image rather than trusting its header or metadata.
    const decoded = await image.raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = decoded.info;

    if (
      width !== metadata.width
      || height !== metadata.height
      || !Number.isInteger(channels)
      || channels < 1
      || channels > 4
      || decoded.data.length !== width * height * channels
    ) {
      throw invalid();
    }

    return {
      contentType: {
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
      }[metadata.format],
      width,
      height,
    };
  } catch {
    throw invalid();
  } finally {
    image?.destroy();
  }
}

export function validateAttendancePhoto(bytes, { maxBytes = MAX_FILE_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) throw new TypeError('图片字节上限无效');
  return runPhotoWork(() => decodeAttendancePhoto(bytes, maxBytes));
}