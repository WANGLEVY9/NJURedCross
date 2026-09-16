/* ==========================================================================
   table.js — the console data grid.
   Browsing and filtering only: business writes always leave the grid and enter
   a dedicated drawer flow, per the platform interaction rules.
   ========================================================================== */

import { h, icon, clear, qsa } from '../core/dom.js';
import { captureRects, playFlip } from '../core/motion.js';
import { attachContextMenu } from './overlay.js';
import { button, emptyState } from './primitives.js';

/**
 * @param {object} config
 * @param {Array<{key,label,align?,sortable?,width?,render?,value?,mono?}>} config.columns
 * @param {Array<object>} config.rows
 * @param {(row:object)=>string} config.getKey
 */
export function dataTable({
  columns,
  rows = [],
  getKey = (row) => row.id,
  onRowClick = null,
  buildRowMenu = null,
  selectable = false,
  searchable = true,
  searchPlaceholder = '搜索当前列表',
  searchKeys = null,
  filters = [],
  actions = [],
  empty = null,
  countLabel = (n) => `${n} 条记录`,
  initialSort = null,
} = {}) {
  let data = rows;
  let query = '';
  let sort = initialSort;
  const selected = new Set();

  const tbody = h('tbody');
  const countNode = h('span', { class: 'toolbar__count' });
  const searchInput = searchable
    ? h('input', { class: 'input', type: 'search', placeholder: searchPlaceholder, autocomplete: 'off', attrs: { 'aria-label': searchPlaceholder } })
    : null;

  const headCells = columns.map((column) =>
    h(
      'th',
      {
        scope: 'col',
        class: column.align === 'right' ? 'cell--num' : null,
        data: { sortable: column.sortable === false ? null : 'true', key: column.key, sort: sort?.key === column.key ? sort.direction : null },
        on:
          column.sortable === false
            ? null
            : {
                click: () => {
                  const direction = sort?.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc';
                  sort = { key: column.key, direction };
                  headCells.forEach((cell) => {
                    if (cell.dataset.key === column.key) cell.dataset.sort = direction;
                    else delete cell.dataset.sort;
                  });
                  render();
                },
              },
      },
      h('span', { class: 'row-2' }, h('span', { text: column.label }), column.sortable === false ? null : icon('arrowUp', 'ico')),
    ),
  );

  const table = h(
    'table',
    { class: 'table' },
    h('thead', null, h('tr', null, selectable ? h('th', { class: 'cell--tight', scope: 'col' }, h('span', { class: 'sr-only', text: '选择' })) : null, ...headCells)),
    tbody,
  );

  const wrap = h('div', { class: 'table-wrap' }, table);
  const emptySlot = h('div', { hidden: true });

  const floatBar = h('div', { class: 'float-toolbar', hidden: true });

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    searchInput ? h('div', { class: 'input-group table__search' }, icon('search', 'ico ico--sm'), searchInput) : null,
    ...filters,
    h('span', { class: 'spacer' }),
    countNode,
    ...actions,
  );

  const node = h('div', { class: 'datatable' }, toolbar, wrap, emptySlot, floatBar);

  const valueOf = (row, column) => (column.value ? column.value(row) : row[column.key]);

  function visibleRows() {
    const needle = query.trim().toLowerCase();
    let result = data;
    if (needle) {
      const keys = searchKeys || columns.map((column) => column.key);
      result = result.filter((row) =>
        keys.some((key) => {
          const column = columns.find((c) => c.key === key);
          const raw = column ? valueOf(row, column) : row[key];
          return String(raw ?? '').toLowerCase().includes(needle);
        }),
      );
    }
    if (sort) {
      const column = columns.find((c) => c.key === sort.key);
      if (column) {
        const direction = sort.direction === 'asc' ? 1 : -1;
        result = [...result].sort((a, b) => {
          const va = valueOf(a, column);
          const vb = valueOf(b, column);
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * direction;
          return String(va ?? '').localeCompare(String(vb ?? ''), 'zh-CN') * direction;
        });
      }
    }
    return result;
  }

  function syncFloatBar() {
    if (!selectable || !selected.size) {
      floatBar.hidden = true;
      return;
    }
    clear(floatBar);
    floatBar.hidden = false;
    floatBar.append(
      h('span', { class: 't-caption', text: `已选择 ${selected.size} 项` }),
      h('span', { class: 'divider-v' }),
      button({
        label: '清除选择',
        variant: 'ghost',
        size: 'sm',
        onClick: () => {
          selected.clear();
          qsa('tr[data-selected="true"]', tbody).forEach((row) => delete row.dataset.selected);
          syncFloatBar();
        },
      }),
    );
  }

  function render() {
    const previous = captureRects(qsa('tr[data-flip-key]', tbody));
    const list = visibleRows();
    countNode.textContent = countLabel(list.length);
    clear(tbody);

    if (!list.length) {
      wrap.hidden = true;
      emptySlot.hidden = false;
      clear(emptySlot);
      emptySlot.append(
        query
          ? emptyState({
              iconName: 'search',
              title: '没有匹配的记录',
              description: `当前筛选条件下没有结果。可以清空关键词「${query}」或调整筛选。`,
              actions: [
                button({
                  label: '清空搜索',
                  variant: 'secondary',
                  iconName: 'close',
                  onClick: () => {
                    query = '';
                    if (searchInput) searchInput.value = '';
                    render();
                  },
                }),
              ],
            })
          : empty || emptyState({ iconName: 'inbox', title: '这里还没有记录', description: '当有新的业务数据时会自动出现在这里。' }),
      );
      syncFloatBar();
      return;
    }

    wrap.hidden = false;
    emptySlot.hidden = true;

    for (const row of list) {
      const key = String(getKey(row));
      const tr = h(
        'tr',
        {
          data: { flipKey: key, rowKey: key, clickable: onRowClick ? 'true' : null, selected: selected.has(key) ? 'true' : null },
          attrs: { tabindex: onRowClick ? '0' : null },
          on: {
            click: onRowClick ? () => onRowClick(row) : null,
            keydown: (event) => {
              if (event.key === 'Enter' && onRowClick) {
                event.preventDefault();
                onRowClick(row);
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const siblings = qsa('tr[data-row-key]', tbody);
                const index = siblings.indexOf(event.currentTarget);
                const next = siblings[index + (event.key === 'ArrowDown' ? 1 : -1)];
                next?.focus();
              }
            },
          },
        },
        selectable
          ? h(
              'td',
              { class: 'cell--tight', on: { click: (event) => event.stopPropagation() } },
              h('input', {
                type: 'checkbox',
                checked: selected.has(key) || undefined,
                attrs: { 'aria-label': '选择该行' },
                on: {
                  change: (event) => {
                    if (event.currentTarget.checked) {
                      selected.add(key);
                      tr.dataset.selected = 'true';
                    } else {
                      selected.delete(key);
                      delete tr.dataset.selected;
                    }
                    syncFloatBar();
                  },
                },
              }),
            )
          : null,
        ...columns.map((column) => {
          const content = column.render ? column.render(row) : h('span', { text: String(valueOf(row, column) ?? '—') });
          return h(
            'td',
            { class: [column.align === 'right' ? 'cell--num' : null, column.mono ? 't-data' : null, column.strong ? 'cell--strong' : null, column.tight ? 'cell--tight' : null].filter(Boolean) },
            content,
          );
        }),
      );
      tbody.append(tr);
    }

    playFlip(qsa('tr[data-flip-key]', tbody), previous);
    syncFloatBar();
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      query = searchInput.value;
      render();
    });
  }

  if (buildRowMenu) {
    attachContextMenu(tbody, 'tr[data-row-key]', (target) => {
      const key = target.dataset.rowKey;
      const row = data.find((item) => String(getKey(item)) === key);
      return row ? buildRowMenu(row) : [];
    });
  }

  node.setRows = (next) => {
    data = next;
    render();
  };
  node.getSelection = () => [...selected];
  node.refresh = render;
  render();
  return node;
}
