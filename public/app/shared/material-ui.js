import { h, icon } from '../core/dom.js';
import { badge } from '../ui/primitives.js';

export function materialSection(title, description, step = '') {
  return h('div', { class: 'material-section-head' },
    step ? h('span', { class: 'material-step', text: step }) : null,
    h('div', {}, h('h2', { class: 't-h3', text: title }),
      description ? h('p', { class: 't-caption', text: description }) : null));
}

export function materialEmpty(title, description, iconName = 'inbox') {
  return h('div', { class: 'material-empty' }, icon(iconName),
    h('h3', { class: 't-h3', text: title }), h('p', { class: 't-secondary', text: description }));
}

export function reimbursementStatus(item) {
  return badge(item.statusLabel, { tone: item.status === 'approved' ? 'success' : item.status === 'returned' ? 'warning' : 'info' });
}
