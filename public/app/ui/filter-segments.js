import { h, setVars } from '../core/dom.js';

/** Equal-width filter choices: the indicator stays aligned through resizing. */
export function filterSegments({ items, value = '', onChange, ariaLabel }) {
  const buttons = items.map(item => h('button', {
    type: 'button', role: 'radio', aria: { label: item.label },
    on: { click: () => choose(item.value) },
  }, h('span', { class: item.compactLabel ? 'filter-segments__full-label' : '', text: item.label }),
  item.compactLabel ? h('span', { class: 'filter-segments__compact-label', text: item.compactLabel, aria: { hidden: 'true' } }) : null));
  const node = h('div', {
    class: 'filter-segments', role: 'radiogroup', aria: { label: ariaLabel },
    vars: { '--choices': items.length },
  }, h('span', { class: 'filter-segments__indicator', aria: { hidden: 'true' } }), ...buttons);
  function update(next) {
    const index = Math.max(0, items.findIndex(item => item.value === next));
    setVars(node, { '--choice': index });
    buttons.forEach((button, i) => {
      button.setAttribute('aria-checked', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
  }
  function choose(next) { update(next); onChange?.(next); }
  node.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    const step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + step + items.length) % items.length;
    node.classList.add('filter-segments--keyboard');
    choose(items[index].value);
    buttons[index].focus();
  });
  node.addEventListener('pointerdown', () => node.classList.remove('filter-segments--keyboard'));
  node.setValue = update;
  update(value);
  return node;
}
