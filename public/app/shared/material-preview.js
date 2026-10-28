import { h } from '../core/dom.js';
import { button } from '../ui/primitives.js';
import { mountOverlay } from '../ui/overlay.js';
import { pdfPreview } from './pdf-preview.js';
import { materialExtension } from './reimbursement-files.js';

/** Create the viewer only on demand; closing releases the image or PDF resources. */
export function openMaterialPreview(file, { title, download, onClose } = {}) {
  const extension = materialExtension(file.originalName || file.name);
  const isImage = ['png', 'jpg', 'jpeg'].includes(extension);
  const canPreview = extension === 'pdf' || isImage;
  const titleId = `material-preview-${Math.random().toString(36).slice(2, 10)}`;
  const body = h('div', { class: 'material-preview-dialog__body', tabindex: 0, aria: { label: '原件预览内容，可滚动查看' } });
  let zoom = 1, controller, content;
  const zoomOut = button({ iconName: 'minus', ariaLabel: '缩小原件', title: '缩小', size: 'sm', variant: 'ghost', onClick: () => setZoom(zoom - .25) });
  const zoomReset = button({ label: '100%', ariaLabel: '恢复适应宽度', title: '恢复适应宽度', size: 'sm', variant: 'ghost', onClick: () => setZoom(1) });
  const zoomIn = button({ iconName: 'plus', ariaLabel: '放大原件', title: '放大', size: 'sm', variant: 'ghost', onClick: () => setZoom(zoom + .25) });
  const fullscreen = button({ label: '全屏', ariaLabel: '全屏查看原件', size: 'sm', variant: 'ghost', onClick: () => {
    const expanded = surface.classList.toggle('is-fullscreen');
    fullscreen.querySelector('span').textContent = expanded ? '退出全屏' : '全屏';
    fullscreen.setAttribute('aria-label', expanded ? '退出全屏查看' : '全屏查看原件');
    fullscreen.setAttribute('aria-pressed', String(expanded));
  } });
  fullscreen.setAttribute('aria-pressed', 'false');
  const surface = h('section', { class: 'material-preview-dialog' },
    h('header', { class: 'material-preview-dialog__head' },
      h('div', { class: 'stack-1 spacer' }, h('p', { class: 't-label', text: '原件预览' }),
        h('h2', { class: 't-h4', id: titleId, text: title || file.name })),
      button({ iconName: 'close', ariaLabel: '关闭原件预览', title: '关闭原件预览', size: 'sm', variant: 'ghost', onClick: () => controller.close() })),
    h('div', { class: 'material-preview-dialog__toolbar', aria: { label: '原件预览工具' } },
      canPreview ? h('div', { class: 'row-2' }, zoomOut, zoomReset, zoomIn, fullscreen) : null,
      download), body);
  function setZoom(value) {
    zoom = Math.max(.5, Math.min(2.5, value));
    surface.style.setProperty('--material-preview-zoom', zoom);
    zoomReset.querySelector('span').textContent = `${Math.round(zoom * 100)}%`;
    zoomOut.disabled = zoom <= .5; zoomIn.disabled = zoom >= 2.5;
  }
  controller = mountOverlay({ surface, labelledBy: titleId, onClose: () => {
    content?.dispose?.();
    if (isImage) content?.removeAttribute('src');
    body.replaceChildren();
    onClose?.();
  } });
  if (extension === 'pdf') {
    content = pdfPreview(file.url);
    body.append(content);
  } else if (isImage) {
    const status = h('p', { class: 't-caption', role: 'status', text: '正在加载图片…' });
    content = h('img', { class: 'material-original-image', src: file.url, alt: title || file.name, decoding: 'async', on: {
      load: () => status.remove(),
      error: () => { content.hidden = true; status.textContent = '图片预览暂不可用，请下载原件核对。'; },
    } });
    body.append(status, content);
  } else {
    body.append(h('p', { class: 't-secondary', text: 'Word 材料请下载原件后核对。' }));
  }
  return controller;
}
