import { h } from '../core/dom.js';
import { button } from '../ui/primitives.js';

/** Shared actions for an ordinary activity and the blood programme entrance. */
export function registrationActions({ className = '', label = '查看并报名', href }) {
  return h('div', { class: `registration-actions ${className}` },
    button({ label, href, variant: 'primary', iconAfter: 'arrowRight' }));
}
