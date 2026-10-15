import { h } from '../../core/dom.js';
import { badge, button, checkbox } from '../../ui/primitives.js';
import { recordTable } from '../lib.js';

// Use the same record list, paging, keyboard navigation and phone cards as other workspaces.
export function serviceRecords({ rows, selected, open, onSelect, busy = false }) {
  const list = recordTable({
    rows, getKey: row => row.id, searchable: false,
    columns: [
      { key: 'name', label: '志愿者', strong: true, sortable: false, render: row => h('div', { class: 'stack-1' },
        h('strong', { text: row.name }), h('span', { class: 't-caption', text: row.studentId }),
        row.context ? h('span', { class: 't-caption', text: row.context }) : null) },
      { key: 'status', label: '状态', sortable: false, render: row => badge(row.status, { tone: row.tone }) },
      { key: 'hours', label: '志愿时长', sortable: false, render: row => h('div', { class: 'stack-1' },
        h('span', { text: `服务 ${row.hours.serviceHours ?? 0} 小时` }),
        h('span', { class: 't-caption', text: `培训 ${row.hours.trainingHours ?? 0} · 交通 ${row.hours.travelHours ?? 0}` })) },
    ],
    onRowClick: open,
    buildRowAction: row => {
      const select = row.enabled ? checkbox({ label: '选择', checked: selected.has(row.id),
        onChange: checked => onSelect(row.id, checked) }) : null;
      if (select) { select.control.disabled = busy; select.control.setAttribute('aria-label', `选择${row.name}`); }
      return h('div', { class: 'row-between row-wrap' }, select || h('span', { class: 't-caption', text: row.note || '' }),
        button({ label: row.action, variant: 'ghost', size: 'sm', iconName: 'chevronRight', onClick: () => open(row) }));
    },
  });
  list.classList.add('service-mobile-records');
  list.syncSelection = saving => {
    for (const row of list.querySelectorAll('tr[data-row-key]')) {
      const checked = selected.has(row.dataset.rowKey), input = row.querySelector('input[type="checkbox"]');
      row.dataset.selected = String(checked);
      if (input) { input.checked = checked; input.disabled = saving; input.closest('.check').dataset.checked = String(checked); }
    }
  };
  list.syncSelection(busy);
  return list;
}
