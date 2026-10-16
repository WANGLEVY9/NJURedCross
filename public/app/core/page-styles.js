const pending = new WeakMap();

/** Homepage has no specialised service widgets; keep CSS order at its original links. */
export function ensurePageStyles(path, { document = globalThis.document, timeoutMs = 12_000 } = {}) {
  if (path === '/') return Promise.resolve();
  return Promise.all([...document.querySelectorAll('link[data-page-style]')].map(link => {
    if (link.dataset.loaded === 'true') return Promise.resolve();
    if (pending.has(link)) return pending.get(link);
    const ready = new Promise((resolve, reject) => {
      let timer;
      function cleanup() {
        clearTimeout(timer);
        link.removeEventListener('load', loaded);
        link.removeEventListener('error', failed);
      }
      function loaded() {
        cleanup();
        link.dataset.loaded = 'true';
        resolve();
      }
      function failed() {
        cleanup();
        link.removeAttribute('href');
        reject(new Error('页面样式加载失败，请刷新重试。'));
      }
      link.addEventListener('load', loaded);
      link.addEventListener('error', failed);
      timer = setTimeout(failed, timeoutMs);
      link.setAttribute('href', link.dataset.pageStyle);
    });
    const tracked = ready.finally(() => pending.delete(link));
    pending.set(link, tracked);
    return tracked;
  }));
}
