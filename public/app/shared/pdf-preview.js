import { h } from '../core/dom.js';
import { button } from '../ui/primitives.js';

/** Render only page content; PDF JavaScript, links and forms are not enabled. */
export function pdfPreview(url, { onPage = null, regions = [] } = {}) {
  const canvas = h('canvas', { class: 'material-pdf__canvas', aria: { label: 'PDF 页面预览' } });
  const status = h('span', { class: 't-caption', aria: { live: 'polite' }, text: '正在加载 PDF…' });
  let document, task, renderTask, page = 1, rendering = false, disposed = false;
  const highlights = new Map(regions.map(item => [item.page, item.seal.regions]));
  const previous = button({ label: '上一页', variant: 'ghost', size: 'sm', onClick: () => render(page - 1) });
  const next = button({ label: '下一页', variant: 'ghost', size: 'sm', onClick: () => render(page + 1) });
  previous.disabled = true; next.disabled = true;
  const node = h('div', { class: 'material-pdf' }, h('div', { class: 'row-3 row-wrap' }, previous, status, next), h('div', { class: 'material-pdf__scroll' }, canvas));
  async function render(number) {
    if (disposed || rendering || number < 1 || number > document.numPages) return;
    rendering = true; previous.disabled = true; next.disabled = true;
    try {
      const source = await document.getPage(number);
      const base = source.getViewport({ scale: 1 });
      const viewport = source.getViewport({ scale: Math.min(1.5, 850 / base.width) });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      renderTask = source.render({ canvasContext: canvas.getContext('2d'), viewport }); await renderTask.promise;
      const context = canvas.getContext('2d');
      context.strokeStyle = '#1677c8'; context.lineWidth = 3;
      for (const region of highlights.get(number) || []) context.strokeRect(region.x * canvas.width, region.y * canvas.height,
        region.width * canvas.width, region.height * canvas.height);
      page = number; status.textContent = `第 ${page} / ${document.numPages} 页`;
      onPage?.(page);
    } catch (error) { if (!disposed) status.textContent = `预览失败：${error.message}，可以下载查看。`; }
    finally { rendering = false; previous.disabled = page <= 1; next.disabled = page >= document.numPages; }
  }
  (async () => {
    try {
      const pdfjs = await import('/vendor/pdfjs/build/pdf.mjs');
      if (disposed) return;
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.mjs';
      task = pdfjs.getDocument({ url, isEvalSupported: false, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true,
        standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' });
      document = await task.promise; if (!disposed) await render(1);
    } catch { if (!disposed) status.textContent = 'PDF 预览暂不可用，可以下载查看。'; }
  })();
  node.showRegions = (number, regions) => {
    highlights.set(number, regions); if (document && !rendering && page === number) render(number);
  };
  node.dispose = () => { disposed = true; renderTask?.cancel(); task?.destroy(); };
  return node;
}
