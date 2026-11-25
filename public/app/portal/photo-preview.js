import { h } from '../core/dom.js';
import { requestBlob } from '../core/api.js';
import { combineSignals } from '../core/abort-signals.js';
import { reportTiming } from '../core/telemetry.js';
import { button, iconButton } from '../ui/primitives.js';
import { mountOverlay } from '../ui/overlay.js';

export function openPhotoPreview({ photo, thumbnail = '', onDownload }) {
  let closed = false, loading = false, objectUrl;
  const abort = new AbortController();
  const preview = h('img', { class: 'photo-lightbox__img', alt: photo.filename, decoding: 'async' });
  const figure = h('figure', { class: 'photo-lightbox__figure', 'aria-busy': 'true' },
    thumbnail ? h('img', { class: 'photo-lightbox__img', src: thumbnail, alt: '', decoding: 'async' }) : null);
  const status = h('span', { class: 't-caption', role: 'status', text: '正在加载高清预览…' });
  const retry = button({ label: '重试', variant: 'ghost', size: 'sm', iconName: 'refresh', onClick: load });
  retry.hidden = true;
  const surface = h('div', { class: 'photo-lightbox__panel', 'aria-label': `查看 ${photo.filename}` },
    figure,
    h('div', { class: 'photo-lightbox__bar' },
      h('span', { class: 'photo-lightbox__name', text: `${photo.filename} · ${photo.center || ''} / ${photo.activity}` }),
      h('span', { class: 'row-2 row-wrap' }, status, retry,
        iconButton({ iconName: 'download', label: '下载原图', onClick: onDownload }),
        iconButton({ iconName: 'close', label: '关闭', onClick: () => controller.close() }))));
  const controller = mountOverlay({ surface, scrimClass: 'photo-lightbox', onClose: () => {
    closed = true;
    abort.abort();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  } });

  async function load() {
    if (closed || loading) return;
    loading = true;
    retry.hidden = true;
    status.textContent = '正在加载高清预览…';
    figure.setAttribute('aria-busy', 'true');
    const start = performance.now();
    const signal = combineSignals([abort.signal, AbortSignal.timeout(12_000)]);
    let outcome = 'success';
    try {
      const { blob } = await requestBlob(`/api/public/media/${encodeURIComponent(photo.id)}/preview`, { method: 'GET', signal });
      if (closed) return;
      objectUrl = URL.createObjectURL(blob);
      preview.src = objectUrl;
      signal.throwIfAborted();
      await new Promise((resolve, reject) => {
        const cancel = () => { cleanup(); reject(signal.reason); };
        const cleanup = () => signal.removeEventListener('abort', cancel);
        signal.addEventListener('abort', cancel, { once: true });
        preview.decode().then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
      });
      signal.throwIfAborted();
      if (closed) return;
      figure.replaceChildren(preview);
      status.textContent = '';
    } catch (error) {
      outcome = signal.aborted ? (closed ? 'aborted' : 'timeout') : error?.status ? 'http' : 'network';
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = undefined; }
      if (closed) return;
      status.textContent = outcome === 'timeout' ? '高清预览加载超时' : '高清预览暂时不可用';
      retry.hidden = false;
    } finally {
      loading = false;
      if (!closed) figure.removeAttribute('aria-busy');
      reportTiming({ route: '/photos', phase: 'image', durationMs: performance.now() - start, outcome });
    }
  }

  void load();
  return controller;
}
