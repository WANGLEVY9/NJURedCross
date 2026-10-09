import { h, icon } from '../core/dom.js';

/** A shared brand introduction; the actions remain specific to each service. */
export function plazaHeader({ label, title, description, actions = [], iconName = 'heart', note = '' }) {
  return h('header', { class: 'discovery-intro plaza-intro' },
    h('div', { class: 'plaza-intro__copy' },
      h('p', { class: 'discovery-intro__eyebrow', text: label }),
      h('h1', { class: 't-h1', text: title }),
      h('p', { class: 't-secondary', text: description })),
    h('div', { class: 'plaza-intro__side' },
      h('span', { class: 'plaza-intro__symbol', aria: { hidden: 'true' } }, icon(iconName, 'ico')),
      actions.length ? h('div', { class: 'plaza-intro__actions' }, ...actions) : null,
      note ? h('p', { class: 'plaza-intro__note', text: note }) : null));
}

export function serviceFlow(items, label = '参与流程') {
  return h('section', { class: 'service-flow', aria: { label } },
    ...items.map(({ title, description, iconName }, index) => h('div', { class: 'service-flow__item' },
      h('span', { class: 'service-flow__step', aria: { hidden: 'true' } }, icon(iconName || 'check', 'ico ico--sm')),
      h('div', null, h('h3', { text: `${index + 1}. ${title}` }), h('p', { text: description })))));
}
