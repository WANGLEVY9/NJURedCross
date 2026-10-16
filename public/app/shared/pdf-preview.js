import { h } from '../core/dom.js';

/** Continuous pages with lazy, bounded canvases; PDF scripts, links and forms stay disabled. */
export function pdfPreview(url, { regions = [] } = {}) {
  const status = h('span', { class: 't-caption', aria: { live: 'polite' }, text: '正在加载 PDF…' });
  const scroll = h('div', { class: 'material-pdf__scroll', tabindex: 0, aria: { label: 'PDF 连续预览，可上下滚动' } });
  const node = h('div', { class: 'material-pdf' }, h('div', { class: 'row-3' }, status), scroll);
  const highlights = new Map(regions.map(item => [item.page, item.seal?.regions || []]));
  const pages = new Map(), visible = new Set(), resident = new Set();
  let document, task, renderTask, observer, rendering = false, disposed = false;
  function drawRegions(number) {
    const entry = pages.get(number); if (!entry) return;
    entry.overlay.replaceChildren(...(highlights.get(number) || []).map(region => {
      const box = h('span', { class: 'material-pdf__region', aria: { label: '疑似红章位置' } });
      Object.assign(box.style, { left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` });
      return box;
    }));
  }
  function evict() {
    for (const number of resident) {
      if (resident.size <= 6) break;
      if (visible.has(number)) continue;
      const entry = pages.get(number);
      entry.canvas.width = 0; entry.canvas.height = 0; entry.canvas.hidden = true;
      entry.loaded = false; entry.message.hidden = false; resident.delete(number);
    }
  }
  async function renderVisible() {
    if (rendering || disposed || !document) return;
    rendering = true;
    try {
      for (;;) {
        const number = [...visible].find(number => !pages.get(number).loaded && !pages.get(number).failed);
        if (!number || disposed) break;
        const entry = pages.get(number);
        let source;
        try {
          source = await document.getPage(number); if (disposed) break;
          const base = source.getViewport({ scale: 1 });
          const scale = Math.min(1.5, 850 / base.width, Math.sqrt(4_000_000 / (base.width * base.height)));
          const viewport = source.getViewport({ scale });
          entry.frame.style.setProperty('--pdf-page-ratio', `${base.width} / ${base.height}`);
          entry.canvas.width = Math.ceil(viewport.width); entry.canvas.height = Math.ceil(viewport.height);
          renderTask = source.render({ canvasContext: entry.canvas.getContext('2d'), viewport });
          await renderTask.promise; if (disposed) break;
          entry.loaded = true; entry.canvas.hidden = false; entry.message.hidden = true;
          resident.add(number); drawRegions(number); evict();
        } catch (error) {
          if (disposed) break;
          entry.failed = true; entry.canvas.width = 0; entry.canvas.height = 0;
          entry.message.textContent = `第 ${number} 页预览失败：${error.message}，可下载查看。`;
        } finally { source?.cleanup(); }
      }
    } finally { rendering = false; }
  }
  (async () => {
    try {
      const pdfjs = await import('/vendor/pdfjs/build/pdf.mjs'); if (disposed) return;
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.mjs';
      task = pdfjs.getDocument({ url, isEvalSupported: false, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true,
        standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' });
      document = await task.promise; if (disposed) return;
      status.textContent = `共 ${document.numPages} 页 · 上下滚动查看完整材料`;
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const number = Number(entry.target.dataset.page);
          if (entry.isIntersecting) visible.add(number); else visible.delete(number);
        }
        evict(); renderVisible();
      }, { root: scroll, rootMargin: '400px 0px' });
      for (let number = 1; number <= document.numPages; number++) {
        const canvas = h('canvas', { class: 'material-pdf__canvas', hidden: true, aria: { label: `PDF 第 ${number} 页` } });
        const message = h('p', { class: 't-caption material-pdf__placeholder', text: `第 ${number} 页正在加载…` });
        const overlay = h('div', { class: 'material-pdf__regions' });
        const frame = h('div', { class: 'material-pdf__page', data: { page: number } }, message, canvas, overlay);
        pages.set(number, { canvas, frame, overlay, message, loaded: false, failed: false });
        scroll.append(h('div', { class: 'material-pdf__sheet' }, h('p', { class: 't-caption', text: `第 ${number} 页` }), frame));
        observer.observe(frame);
      }
    } catch { if (!disposed) status.textContent = 'PDF 预览暂不可用，可以下载查看。'; }
  })();
  node.showRegions = (number, regions) => { highlights.set(number, regions || []); drawRegions(number); };
  node.dispose = () => { disposed = true; observer?.disconnect(); renderTask?.cancel(); task?.destroy(); };
  return node;
}
