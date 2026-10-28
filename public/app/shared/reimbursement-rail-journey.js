import { h } from '../core/dom.js';
import { field } from '../ui/primitives.js';

export function railJourneyFields(prefix, value = {}) {
  const from = field({ label: '出发站', name: `${prefix}FromStation`, value: value.fromStation || '', maxlength: 50, placeholder: '例如：南京南' });
  const to = field({ label: '到达站', name: `${prefix}ToStation`, value: value.toStation || '', maxlength: 50, placeholder: '例如：上海虹桥' });
  const journey = field({ label: '行程类型', name: `${prefix}Journey`, value: value.journey || '单程', options: ['单程', '往返'] });
  const fields = [from, to, journey];
  return { fields, node: h('div', { class: 'stack-2 material-rail-journey' }, h('div', { class: 'formgrid' }, ...fields),
    h('p', { class: 't-caption', text: '火车票命名为“姓名-火车票-出发站-到达站（单程/往返）-外出事宜.pdf”；外出事宜使用上方报销事由。' })),
    value() { return from.control.value.trim() || to.control.value.trim() ? { fromStation: from.control.value.trim(), toStation: to.control.value.trim(), journey: journey.control.value } : undefined; },
    validate(required = true) {
      fields.forEach(field => field.setError(null)); if (!required && !from.control.value.trim() && !to.control.value.trim()) return null;
      let invalid;
      for (const field of fields) if (!field.control.value.trim()) { field.setError('请填写此项'); invalid ||= field.control; }
      if (!invalid && from.control.value.trim() === to.control.value.trim()) { to.setError('出发站与到达站不能相同'); invalid = to.control; }
      return invalid || null;
    } };
}
