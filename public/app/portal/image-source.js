import { h } from '../core/dom.js';
import { MEDIA } from './media-manifest.js';

export const heroSizes = '(max-width: 640px) 100vw, (max-width: 1280px) 90vw, 1280px';
export const photoSizes = '(max-width: 640px) 45vw, (max-width: 1280px) 23vw, 300px';
export const mediaFor = source => MEDIA[source];

export function managedImage(source, { priority = false, sizes = heroSizes, onFailure = () => {}, onFallback = () => {}, ...attributes } = {}) {
  const media = MEDIA[source];
  const image = h('img', {
    ...attributes,
    loading: priority ? 'eager' : 'lazy', decoding: 'async', fetchpriority: priority ? 'high' : 'low',
    width: media?.width, height: media?.height,
    referrerpolicy: 'no-referrer',
    on: {
      load: () => { delete image.dataset.fallback; },
      error: () => {
        if (media && !image.dataset.fallback) {
          image.dataset.fallback = 'pending';
          onFallback();
          image.removeAttribute('srcset');
          image.removeAttribute('sizes');
          image.src = source;
        } else {
          image.dataset.fallback = 'failed';
          onFailure();
        }
      },
    },
    sizes: media ? sizes : null, srcset: media?.srcset, src: media?.src || source,
  });
  return image;
}

// Keep the displayed frame while the next photograph downloads and decodes.
export function imageReady(image) {
  if (!image) return Promise.resolve();
  if (image.complete && image.naturalWidth) return image.decode().catch(() => {});
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timeout);
      image.removeEventListener('load', loaded);
      image.removeEventListener('error', failed);
      if (error) reject(error);
      else image.decode().catch(() => {}).then(resolve);
    };
    const loaded = () => finish();
    const failed = () => { if (image.dataset.fallback !== 'pending') finish(new Error('Image unavailable')); };
    const timeout = setTimeout(() => finish(new Error('Image timed out')), 15000);
    image.addEventListener('load', loaded);
    image.addEventListener('error', failed);
    if (image.complete && !image.naturalWidth) failed();
  });
}

export function mayPrefetch() {
  const connection = navigator.connection;
  return !document.hidden && !connection?.saveData && !/^(slow-)?2g$/.test(connection?.effectiveType || '');
}
