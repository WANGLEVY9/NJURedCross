/* ==========================================================================
   console/materials-labels.js — batch label printing for inventory assets (D1).
   Reuses the server-side QR endpoint (bare asset code, scannable by 扫码定位).
   Prints to A4 via window.print() with a dedicated @media print scope, so the
   surrounding console never leaks into the printed page. No build tooling.
   ========================================================================== */

import { h } from '../core/dom.js';
import { openModal } from '../ui/overlay.js';
import { button, notice } from '../ui/primitives.js';
import { notify } from '../core/toast.js';
import { consoleApi } from '../core/api.js';

const LABEL_COLUMNS = 3;

function labelNode(item) {
  return h('div', { class: 'asset-label' },
    h('img', { class: 'asset-label__qr', src: consoleApi.materials.qrUrl(item.id), alt: `${item.code} 二维码` }),
    h('div', { class: 'asset-label__meta' },
      h('b', { class: 'asset-label__name', text: item.name }),
      h('code', { class: 'asset-label__code', text: item.code }),
      h('span', { class: 'asset-label__where', text: item.center || '未分类' })));
}

function labelGrid(items) {
  return h('div', { class: 'asset-label-grid' }, ...items.map(labelNode));
}

function printStylesheet() {
  return h('style', { text: [
    '@media print { @page { size: A4; margin: 10mm; } body > *:not(.print-labels) { display: none !important; } }',
    '.print-labels { position: absolute; inset: 0; }',
    '.print-labels .asset-label-grid { display: grid; grid-template-columns: repeat(' + LABEL_COLUMNS + ', 1fr); gap: 4mm; }',
    '.print-labels .asset-label { break-inside: avoid; page-break-inside: avoid; border: 1px solid #ccc; border-radius: 6px; padding: 4mm; display: flex; flex-direction: column; align-items: center; gap: 2mm; }',
    '.print-labels .asset-label__qr { width: 24mm; height: 24mm; }',
    '.print-labels .asset-label__name { font-size: 12pt; text-align: center; }',
    '.print-labels .asset-label__code { font-size: 9pt; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }',
    '.print-labels .asset-label__where { font-size: 9pt; color: #888; }',
  ].join('\n') });
}

function doPrint(items) {
  const container = h('div', { class: 'print-labels' });
  container.append(printStylesheet(), labelGrid(items));
  document.body.append(container);
  window.print();
  setTimeout(() => container.remove(), 1000);
}

export function openPrintLabels(items) {
  if (!items.length) {
    notify.info('请先勾选物资', '在库存台账中勾选要打印标签的物资。');
    return;
  }
  const preview = h('div', { class: 'asset-label-preview' });
  preview.append(labelGrid(items));

  const modal = openModal({
    title: '打印物资标签',
    width: 760,
    body: [
      notice(`已选择 ${items.length} 件物资，按 ${LABEL_COLUMNS} 列排版并自动分页。打印时请选择 A4 纸张、取消页边距缩放。`, { tone: 'info' }),
      preview,
    ],
    footer: [
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => modal.close() }),
      button({ label: '打印', variant: 'primary', iconName: 'file', onClick: () => doPrint(items) }),
    ],
  });
}
