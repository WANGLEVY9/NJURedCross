import { h } from '../core/dom.js';

/**
 * 内建广场 owns its own wait. The page renders this preview immediately and
 * swaps in the real view once the capability check and the module graph land,
 * so the plaza never shows a blank frame or the previous page without a sign
 * that something is loading. Styles live in warmth.css and only serve this
 * page; the reveal is delayed so a fast load never flashes it.
 */
export function warmthPreview() {
  return h(
    'div',
    { class: 'warmth-preview' },
    h(
      'div',
      { class: 'warmth-preview__frame', aria: { hidden: 'true' } },
      h('span', { class: 'warmth-preview__eyebrow' }),
      h('span', { class: 'warmth-preview__line' }),
      h('span', { class: 'warmth-preview__line warmth-preview__line--short' }),
      h('span', { class: 'warmth-preview__line warmth-preview__line--text' }),
      h(
        'div',
        { class: 'warmth-preview__cards' },
        h('span', { class: 'warmth-preview__card' }),
        h('span', { class: 'warmth-preview__card' }),
        h('span', { class: 'warmth-preview__card' }),
      ),
    ),
    h('p', { class: 'sr-only', attrs: { role: 'status' }, text: '正在载入内建广场，请稍候' }),
  );
}
