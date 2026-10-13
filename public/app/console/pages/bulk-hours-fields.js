import { h } from '../../core/dom.js';
import { field } from '../../ui/primitives.js';
import { serviceDateFields } from './service-date-fields.js';

const definitions = [
  ['location', '具体工作地点', 'text', 1000],
  ['dates', '正式工作日期', 'textarea', 4000],
  ['trainingHours', '培训时长', 'number'],
  ['travelHours', '交通时长', 'number'],
  ['serviceHours', '服务时长', 'number'],
  ['work', '志愿者具体工作内容', 'textarea', 500],
  ['remark', '备注', 'textarea', 1000],
];

export function bulkHoursFields(initial = {}) {
  const enabled = new Set();
  const error = h('p', { class: 'field__error', attrs: { role: 'alert', 'aria-live': 'polite' }, hidden: true });
  const fields = definitions.map(([key, label, type, maxlength]) => {
    const input = key === 'dates' ? serviceDateFields(initial[key]) : field({ label, value: initial[key] ?? '', type: type === 'number' ? 'number' : 'text',
      multiline: type === 'textarea', rows: key === 'dates' ? 3 : 2, maxlength,
      min: type === 'number' ? 0 : null, step: type === 'number' ? 'any' : null,
      hint: key === 'dates' ? '每个日期和时段单独一行。' : key === 'serviceHours' ? '0 小时记录不计入汇总和导出。' : '' });
    input.control.disabled = true;
    const toggle = h('input', { type: 'checkbox', 'aria-label': `批量修改${label}`, on: { change: e => {
      input.control.disabled = !e.target.checked;
      input.classList.toggle('is-enabled', e.target.checked);
      if (e.target.checked) enabled.add(key); else enabled.delete(key);
      error.hidden = true;
    } } });
    return [key, h('div', { class: 'service-bulk-field' }, h('label', { class: 'service-bulk-toggle' }, toggle, h('span', { text: `修改${label}` })), input), input];
  });
  return {
    node: h('div', { class: 'stack-3' }, h('p', { class: 't-caption', text: '只勾选需要统一修改的字段；未勾选字段会保留每条记录原值。' }), error, ...fields.map(([, row]) => row)),
    valid: () => {
      if (!enabled.size) { error.textContent = '请至少勾选一个要批量修改的字段。'; error.hidden = false; return false; }
      error.hidden = true;
      return fields.filter(([key]) => enabled.has(key)).every(([, , input]) => input.control.reportValidity());
    },
    patch: () => Object.fromEntries(fields.filter(([key]) => enabled.has(key)).map(([key, , input]) => [key, input.control.value])),
  };
}
