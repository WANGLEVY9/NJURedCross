import { h, clear } from '../../core/dom.js';
import { button } from '../../ui/primitives.js';
import { dateLines } from './service-date-state.js';

// Date text may include a service time range. Keep that text intact rather than coercing to input[type=date].
export function serviceDateFields(value = '') {
  const list = h('div', { class: 'service-date-list' });
  const error = h('p', { class: 'field__error', role: 'alert', hidden: true });
  let inputs = [], disabled = false;
  const add = button({ label: '＋ 添加日期', size: 'sm', onClick: () => { appendLine(''); inputs.at(-1).focus(); } });
  function appendLine(text) {
    const index = inputs.length + 1;
    const input = h('input', { class: 'input', type: 'text', value: text, maxlength: 4000, disabled,
      required: index === 1, 'aria-label': `正式工作日期 ${index}`, placeholder: '2026-10-10 14:00–17:00', on: { input: () => { error.hidden = true; } } });
    inputs.push(input);
    list.append(h('label', { class: 'service-date-line' }, h('span', { text: `日期 ${index}` }), input));
  }
  function reset(text) { clear(list); inputs = []; const lines = dateLines(text); (lines.length ? lines : ['']).forEach(appendLine); }
  const node = h('div', { class: 'field service-date-field' }, h('span', { class: 'field__label', text: '正式工作日期' }), list, add,
    h('p', { class: 'field__hint', text: '每次服务一行，可保留日期后的时段。清空多余行即可移除；未修改的时段原样保留。' }), error);
  node.control = {
    get value() { return inputs.map(input => input.value.trim()).filter(Boolean).join('\n'); },
    set value(text) { reset(text); },
    get disabled() { return disabled; },
    set disabled(next) { disabled = Boolean(next); inputs.forEach(input => { input.disabled = disabled; }); add.disabled = disabled; },
    reportValidity() {
      if (disabled) return true;
      if (!inputs.every(input => input.reportValidity())) return false;
      if (this.value.length > 4000) { error.textContent = '正式工作日期合计不能超过4000字。'; error.hidden = false; return false; }
      error.hidden = true; return true;
    },
  };
  reset(value);
  return node;
}
