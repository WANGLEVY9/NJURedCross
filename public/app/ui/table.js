/* ==========================================================================
   table.js — the console data grid.
   Browsing and filtering only: business writes always leave the grid and enter
   a dedicated drawer flow, per the platform interaction rules.
   ========================================================================== */

import { searchField } from './search-field.js';
import { h, icon, clear, qsa } from '../core/dom.js';
import { captureRects, playFlip } from '../core/motion.js';
import { attachContextMenu, menuFromTrigger } from './overlay.js';
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
  buildRowAction = null,
  rowActionLabel = '操作',
  selectable = false,
  searchable = true,
  searchPlaceholder = '搜索当前列表',
  searchKeys = null,
  filters = [],
  actions = [],
  empty = null,
  countLabel = (n) => `${n} 条记录`,
  initialSort = null,
  pageSize = 0,
  mobileCards = false,
  initialQuery = '',
  onStateChange = null,
} = {}) {
  let page = 0;
  let data = rows;
  let query = typeof initialQuery === 'string' ? initialQuery : '';
  let sort = initialSort;
  const selected = new Set();

  function emitState() {
    onStateChange?.({
      query,
      sort: sort ? { ...sort } : null,
    });
  }

  const tbody = h('tbody');
  const countNode = h('span', { class: 'toolbar__count', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });
  const search = searchable
    ? searchField({
        label: searchPlaceholder,
        value: query,
        onSearch: value => {
          query = value; page = 0;
          emitState();
          render();
        },
      })
    : null;

  const headCells = columns.map((column) =>
    h(
      'th',
      {
        scope: 'col',
        class: [column.align === 'right' ? 'cell--num' : null, column.className].filter(Boolean),
        attrs: { tabindex: column.sortable === false ? null : '0', 'aria-sort': column.sortable === false ? null : sort?.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none' },
        data: { sortable: column.sortable === false ? null : 'true', key: column.key, sort: sort?.key === column.key ? sort.direction : null },
        on:
          column.sortable === false
            ? null
            : {
                keydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } },
                click: () => {
                  const direction = sort?.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc';
                  sort = { key: column.key, direction }; page = 0;
                  emitState();
                  headCells.forEach((cell) => {
                    if (cell.dataset.key === column.key) {
                      cell.dataset.sort = direction;
                      cell.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
                    } else {
                      delete cell.dataset.sort;
                      if (cell.dataset.sortable) cell.setAttribute('aria-sort', 'none');
                    }
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
    h('thead', null, h('tr', null, selectable ? h('th', { class: 'cell--tight', scope: 'col' }, h('span', { class: 'sr-only', text: '选择' })) : null, ...headCells, buildRowMenu ? h('th', { scope: 'col', text: '操作' }) : buildRowAction ? h('th', { scope: 'col', text: rowActionLabel }) : null)),
    tbody,
  );

  const wrap = h('div', { class: 'table-wrap', attrs: { tabindex: '0', role: 'region', 'aria-label': '数据列表，可左右滑动查看全部列' } }, table);
  const scrollHint = h('p', { class: 'table-mobile-hint', text: '左右滑动查看全部列；点击记录查看详情。' });
  const emptySlot = h('div', { hidden: true });

  const floatBar = h('div', { class: 'float-toolbar', hidden: true });

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    search,
    ...filters,
    h('span', { class: 'spacer' }),
    countNode,
    ...actions,
  );

  const pagination = h('nav', { class: 'table-pagination', aria: { label: '列表分页' }, hidden: true });
  const node = h('div', { class: mobileCards ? 'datatable datatable--records' : 'datatable' }, toolbar, scrollHint, wrap, emptySlot, pagination, floatBar);

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
          qsa('tr[data-selected="true"]', tbody).forEach((row) => { delete row.dataset.selected; row.querySelector('input[type="checkbox"]').checked = false; });
          syncFloatBar();
        },
      }),
    );
  }

  function render() {
    const previous = captureRects(qsa('tr[data-flip-key]', tbody));
    const list = visibleRows();
    countNode.textContent = countLabel(list.length);
    const pages = pageSize ? Math.ceil(list.length / pageSize) : 1;
    page = Math.max(0, Math.min(page, pages - 1));
    pagination.hidden = !pageSize || pages <= 1;
    pagination.replaceChildren();
    if (!pagination.hidden) pagination.append(
      button({ label: '上一页', variant: 'secondary', size: 'sm', disabled: page === 0, onClick: () => { page--; render(); pagination.querySelector('button:not(:disabled)')?.focus(); } }),
      h('span', { role: 'status', text: `第 ${page + 1} / ${pages} 页 · 每页 ${pageSize} 条` }),
      button({ label: '下一页', variant: 'secondary', size: 'sm', disabled: page >= pages - 1, onClick: () => { page++; render(); pagination.querySelector('button:not(:disabled)')?.focus(); } }),
    );
    clear(tbody);

    if (!list.length) {
      wrap.hidden = true;
      scrollHint.hidden = true;
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
                    search?.setValue('');
                    emitState();
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
    scrollHint.hidden = false;
    scrollHint.textContent = `左右滑动查看全部列${onRowClick ? '；点击记录查看详情' : ''}。`;
    emptySlot.hidden = true;

    for (const row of (pageSize ? list.slice(page * pageSize, (page + 1) * pageSize) : list)) {
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
              { class: 'cell--tight', data: { label: '操作', summary: 'true' }, on: { click: (event) => event.stopPropagation() } },
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
        ...columns.map((column, index) => {
          const content = column.render ? column.render(row) : h('span', { text: String(valueOf(row, column) ?? '—') });
          return h(
            'td',
            {
              data: { label: column.label, summary: column.strong || index < 3 || /status|approval/i.test(column.key) ? 'true' : null },
              class: [column.align === 'right' ? 'cell--num' : null, column.mono ? 't-data' : null, column.strong ? 'cell--strong' : null, column.tight ? 'cell--tight' : null, column.className].filter(Boolean),
              on: column.selectionHitArea ? { click: event => {
                const checkbox = tr.querySelector('.community-review-selection input[type="checkbox"]');
                const rect = event.currentTarget.getBoundingClientRect();
                if (column.selectionHitArea === 'full' || (checkbox && event.clientX - rect.left < rect.width / 2)) {
                  event.stopPropagation();
                  if (checkbox && !checkbox.disabled) checkbox.click();
                }
              } } : null,
            },
            content,
          );
        }),
      );
      if (buildRowMenu) {
        tr.append(h('td', { class: 'cell--tight', data: { label: '操作', summary: 'true' }, on: { click: (event) => event.stopPropagation(), keydown: (event) => event.stopPropagation() } }, button({ label: '操作', variant: 'ghost', size: 'sm', iconName: 'chevronDown', onClick: (event) => menuFromTrigger(event.currentTarget, buildRowMenu(row)) })));
      } else if (buildRowAction) {
        tr.append(h('td', { class: 'cell--tight', data: { label: '操作', summary: 'true' }, on: { click: (event) => event.stopPropagation(), keydown: (event) => event.stopPropagation() } }, buildRowAction(row)));
      }
      tbody.append(tr);
    }

    playFlip(qsa('tr[data-flip-key]', tbody), previous);
    syncFloatBar();
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
    const keys = new Set(next.map(row => String(getKey(row))));
    for (const key of selected) if (!keys.has(key)) selected.delete(key);
    render();
  };
  node.getSelection = () => [...selected];
  node.refresh = render;
  node.dispose = () => search?.dispose();
  render();
  return node;
}
