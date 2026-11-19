import sharp from 'sharp';
import { createReadCache } from '../http/read-cache.js';
import { createPhotoWorkQueue } from '../events/photo-work.js';
import { observer } from '../observability.js';
import * as box from './box.js';

export const MEDIA_PREVIEW_MAX_BYTES = 512 * 1024;
const previews = createReadCache({ ttlMs: 5 * 60_000, maxEntries: 16 });
const runPreview = createPhotoWorkQueue({ concurrency: 1, maxWaiting: 3 });

export function clearMediaPreviewCache() {
  previews.clear();
}

/** Only compressed bytes are retained; original downloads and decoding are serialized. */
export function loadMediaPreview(config, media, { download = box.downloadBuffer } = {}) {
  const key = JSON.stringify([media.id, media.path, media.checksum, media.uploadedAt]);
  return previews.get(key, () => runPreview(async () => {
    const bytes = await download(config, media.path, undefined, { maxBytes: 20 * 1024 * 1024 });
    return observer.dependency('content', 'generate', async () => {
      let image;
      try {
        image = sharp(bytes, { limitInputPixels: 50_000_000, limitInputChannels: 4, failOn: 'warning' })
          .timeout({ seconds: 5 })
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
        let buffer = await image.clone().jpeg({ quality: 80, mozjpeg: true }).toBuffer();
        if (buffer.length > MEDIA_PREVIEW_MAX_BYTES) {
          buffer = await image.resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 60, mozjpeg: true }).toBuffer();
        }
        if (buffer.length > MEDIA_PREVIEW_MAX_BYTES) {
          throw Object.assign(new Error('预览图过大，请下载原图查看。'), { statusCode: 413 });
        }
        return buffer;
      } finally {
        image?.destroy();
      }
    });
  }));
}
