import { h, icon } from '../core/dom.js';

/** One input contract for local filtering and remote queries. */
export function searchField({ value = '', label = '搜索', placeholder = label, onSearch, delay = 180 } = {}) {
  let timer, composing = false;
  const input = h('input', { class: 'input', type: 'search', value, placeholder, autocomplete: 'off', 'aria-label': label });
  const clear = h('button', { class: 'search-field__clear', type: 'button', 'aria-label': '清除搜索', hidden: !value }, icon('close', 'ico ico--sm'));
  const node = h('div', { class: 'search-field' }, icon('search', 'ico ico--sm'), input, clear);
  const sync = () => { clear.hidden = !input.value; };
  const emit = () => { clearTimeout(timer); onSearch?.(input.value); };
  input.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
  input.addEventListener('compositionend', () => { composing = false; sync(); clearTimeout(timer); timer = setTimeout(emit, delay); });
  input.addEventListener('input', event => {
    sync(); clearTimeout(timer);
    if (!composing && !event.isComposing) timer = setTimeout(emit, delay);
  });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !composing && !event.isComposing) emit(); });
  clear.addEventListener('click', () => { node.setValue(''); input.focus(); emit(); });
  node.input = input;
  node.setValue = next => { clearTimeout(timer); input.value = next; sync(); };
  node.dispose = () => clearTimeout(timer);
  return node;
}
