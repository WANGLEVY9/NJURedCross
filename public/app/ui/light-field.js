import { h } from '../core/dom.js';

/** Decorative, bounded light marks. The caller owns positioning and lifetime. */
export function lightField({ className = '', quiet = false } = {}) {
  return h('div', {
    class: ['light-field', quiet ? 'light-field--quiet' : null, className].filter(Boolean).join(' '),
    aria: { hidden: 'true' },
  }, h('span', { class: 'light-field__spark' }), h('span', { class: 'light-field__spark' }),
  h('span', { class: 'light-field__spark' }), h('span', { class: 'light-field__spark' }));
}
