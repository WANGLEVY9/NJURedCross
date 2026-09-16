/* ==========================================================================
   console/lib.js — shared plumbing for console pages.
   Guarantees every data region implements loading / empty / error / retry
   without each page re-inventing it.
   ========================================================================== */

import { h, clear } from '../core/dom.js';
import { errorState, skeletonRows, skeletonMetrics, skeletonBlock, button } from '../ui/primitives.js';
import { countOnVisible } from '../core/motion.js';

/**
 * A self-contained data region.
 * @param {object} config
 * @param {() => Promise<any>} config.load
 * @param {(data:any, ctx:{reload:Function, slot:HTMLElement}) => Node|Node[]} config.render
 * @param {Node} [config.skeleton]
 * @param {string} [config.errorTitle]
 */
export function asyncRegion({ load, render, skeleton = null, errorTitle = '这个区域无法加载' }) {
  const slot = h('div', { class: 'region', attrs: { 'aria-busy': 'true' } });

  const reload = async () => {
    clear(slot);
    slot.setAttribute('aria-busy', 'true');
    slot.append(skeleton ? skeleton.cloneNode(true) : skeletonRows(4));
    try {
      const data = await load();
      clear(slot);
      slot.removeAttribute('aria-busy');
      const output = render(data, { reload, slot });
      for (const child of (Array.isArray(output) ? output : [output]).flat()) if (child) slot.append(child);
      countOnVisible(slot);
    } catch (error) {
      clear(slot);
      slot.removeAttribute('aria-busy');
      slot.append(errorState({ title: errorTitle, error, onRetry: reload }));
    }
  };

  slot.reload = reload;
  reload();
  return slot;
}

export const skeletons = { rows: skeletonRows, metrics: skeletonMetrics, block: skeletonBlock };

/** A titled workspace region with an optional action row — not a card. */
export function region({ label = '', title, description = '', actions = [], body, dense = false }) {
  return h(
    'section',
    { class: ['wsregion', dense ? 'wsregion--dense' : null].filter(Boolean) },
    h(
      'header',
      { class: 'wsregion__head' },
      h(
        'div',
        { class: 'section-head__text' },
        label ? h('p', { class: 't-label', text: label }) : null,
        h('h2', { class: 't-h3', text: title }),
        description ? h('p', { class: 't-caption', text: description }) : null,
      ),
      h('span', { class: 'spacer' }),
      ...actions,
    ),
    h('div', { class: 'wsregion__body' }, body),
  );
}

/** Two-column workspace split: primary work area plus a context column. */
export function columns(primary, secondary, { ratio = '1.6fr 1fr' } = {}) {
  const node = h('div', { class: 'wscols' }, h('div', { class: 'stack-8' }, primary), h('div', { class: 'stack-8' }, secondary));
  node.style.setProperty('--cols', ratio);
  return node;
}

/** Refresh affordance bound to a region's own reload function. */
export function reloadAction(slot, label = '刷新') {
  return button({
    label,
    variant: 'ghost',
    size: 'sm',
    iconName: 'refresh',
    iconMotion: 'spin',
    onClick: () => slot.reload?.(),
  });
}

/** Labels every write-protected action consistently. */
export const WRITE_NOTICE = '写操作会记录操作者、时间与变更摘要，并需要有效的会话与 CSRF 令牌。';
