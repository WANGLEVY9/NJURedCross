import { h } from '../../core/dom.js';
import { field } from '../../ui/primitives.js';

export function hoursFields(values) {
  const definitions = [
    ['location', '具体工作地点', 'text', 1000], ['dates', '正式工作日期', 'text', 4000],
    ['trainingHours', '培训时长', 'number'], ['travelHours', '交通时长', 'number'], ['serviceHours', '服务时长', 'number'],
    ['work', '志愿者具体工作内容', 'text', 500], ['remark', '备注', 'text', 1000],
  ];
  const fields = definitions.map(([key, label, type, max]) => [key, field({ label, value: values[key] ?? '', type,
    required: key !== 'remark', multiline: type === 'text', rows: key === 'dates' ? 3 : 2, maxlength: max,
    min: type === 'number' ? 0 : null, step: type === 'number' ? 'any' : null,
    hint: key === 'dates' ? '每个日期和时段单独一行。' : key === 'serviceHours' ? '0 小时记录不计入汇总和导出。' : '' })]);
  return { node: h('div', { class: 'stack-3' }, ...fields.map(([, f]) => f)),
    valid: () => fields.every(([, f]) => f.control.reportValidity()),
    values: () => Object.fromEntries(fields.map(([key, f]) => [key, f.control.value])) };
}

export function entryValues(entry, registration, event) {
  return { serviceHours: entry?.['服务时长'] ?? event['服务时长'], trainingHours: entry?.['培训时长'] ?? event['培训时长'],
    travelHours: entry?.['交通时长'] ?? event['交通时长'], work: entry?.['工作内容'] ?? event['工作内容'],
    location: entry?.['具体工作地点'] ?? event['地点'], dates: entry?.['正式工作日期'] ?? [registration['报名日期'], registration['报名时段']].filter(Boolean).join(' '), remark: entry?.['备注'] ?? '' };
}
