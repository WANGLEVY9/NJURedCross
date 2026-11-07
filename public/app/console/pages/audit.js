/* ==========================================================================
   console/pages/audit.js — 全平台操作日志。
   按时间、操作人、角色、板块与结果检索；数据由服务端按时间倒序限量返回，
   不再整表读取（审计表已超过单次读取上限）。
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { consoleApi, hasPermission } from '../../core/api.js';
import { asyncRegion, region } from '../lib.js';
import { dataTable } from '../../ui/table.js';
import {
  pageHead, button, badge, notice, emptyState, segmented, skeletonRows,
} from '../../ui/primitives.js';
import * as fmt from '../../core/format.js';

const PAGE_SIZE = 50;

const RANGE_OPTIONS = [
  { value: '7', label: '近 7 天' },
  { value: '30', label: '近 30 天' },
  { value: 'all', label: '全部' },
];

const RESULT_OPTIONS = [
  { value: '', label: '全部结果' },
  { value: 'success', label: '成功' },
  { value: 'rejected', label: '被拒绝' },
  { value: 'failed', label: '失败' },
];

function rangeStart(value) {
  if (!value || value === 'all') return '';
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1) return '';
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export default async function auditPage(context, shell) {
  const state = { range: '7', actor: '', board: '', result: '', before: '', page: 1, boards: [] };

  const actorInput = h('input', {
    class: 'input audit-log__input', type: 'search', name: 'actor',
    placeholder: '姓名、账号或邮箱', 'aria-label': '操作人', maxlength: 120, value: state.actor,
  });
  const boardSelect = h('select', { class: 'input audit-log__select', name: 'board', 'aria-label': '板块' },
    h('option', { value: '', text: '全部板块' }));
  const resultSelect = h('select', { class: 'input audit-log__select', name: 'result', 'aria-label': '结果' },
    ...RESULT_OPTIONS.map(item => h('option', { value: item.value, text: item.label })));

  const applyFilters = () => {
    state.actor = actorInput.value.trim();
    state.board = boardSelect.value;
    state.result = resultSelect.value;
    state.before = ''; state.page = 1;
    listRegion.reload();
  };
  actorInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyFilters(); } });

  const rangeSegmented = segmented({
    items: RANGE_OPTIONS,
    value: state.range,
    ariaLabel: '时间范围',
    onChange: value => {
      state.range = value; state.before = ''; state.page = 1;
      rangeSegmented.setValue(value);
      listRegion.reload();
    },
  });

  const summary = h('p', { class: 't-caption audit-log__summary', role: 'status' });
  const pager = h('div', { class: 'audit-log__pager' });
  const detail = h('div', { class: 'audit-log__detail', hidden: true });

  function renderDetail(entry) {
    detail.hidden = false;
    detail.replaceChildren(
      h('h3', { class: 'audit-log__detail-title', text: entry.action || '操作详情' }),
      h('dl', { class: 'audit-log__facts' },
        ...[
          ['时间', entry.at ? fmt.fullDateTime(entry.at) : '—'],
          ['操作人', entry.actor],
          ['角色', entry.role],
          ['板块', boardLabel(entry.board)],
          ['对象', entry.target || '—'],
          ['结果', entry.result || '—'],
          ['IP', entry.ip || '—'],
        ].map(([label, value]) => h('div', null, h('dt', { text: label }), h('dd', { text: String(value) })))),
      Object.keys(entry.metadata || {}).length
        ? h('pre', { class: 'audit-log__metadata', text: JSON.stringify(entry.metadata, null, 2) })
        : h('p', { class: 't-caption', text: '这次操作没有附加参数。' }),
      button({ label: '关闭', variant: 'ghost', size: 'sm', onClick: () => { detail.hidden = true; } }),
    );
    detail.scrollIntoView({ block: 'nearest' });
  }

  function boardLabel(key) {
    return (state.boards.find(board => board.key === key) || { label: key === 'other' ? '其他' : key }).label;
  }

  const listRegion = asyncRegion({
    skeleton: skeletonRows(8),
    errorTitle: '操作日志无法加载',
    load: async () => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      const after = rangeStart(state.range);
      if (after) query.set('after', after);
      if (state.before) query.set('before', state.before);
      if (state.actor.trim()) query.set('actor', state.actor.trim());
      if (state.board) query.set('board', state.board);
      if (state.result) query.set('result', state.result);
      const payload = await consoleApi.auditLogs(query.toString());
      state.boards = payload.boards || state.boards;
      return payload;
    },
    render: (payload) => {
      const entries = payload.entries || [];
      state.boards = payload.boards || [];
      boardSelect.replaceChildren(
        h('option', { value: '', text: '全部板块' }),
        ...state.boards.map(board => h('option', { value: board.key, text: board.label })),
      );
      boardSelect.value = state.board;
      summary.textContent = entries.length
        ? `本页 ${entries.length} 条 · 扫描 ${payload.scanned || entries.length} 条${payload.hasMore ? ' · 还有更早的记录' : ''}`
        : '';
      pager.replaceChildren(
        button({ label: '较新', variant: 'ghost', size: 'sm', disabled: state.page <= 1, onClick: () => { state.before = ''; state.page = 1; listRegion.reload(); } }),
        h('span', { class: 't-caption', text: `第 ${state.page} 页` }),
        button({ label: '更早', variant: 'ghost', size: 'sm', disabled: !payload.hasMore, onClick: () => { state.before = entries.at(-1)?.at || ''; state.page += 1; listRegion.reload(); } }),
      );
      if (!entries.length) {
        return emptyState({
          title: '没有匹配的操作记录',
          description: '换一个时间范围、板块或操作人再试。',
          iconName: 'activity',
        });
      }
      return dataTable({
        columns: [
          { key: 'at', label: '时间', render: row => h('span', { class: 't-caption', text: row.at ? fmt.fullDateTime(row.at) : '—' }) },
          { key: 'actor', label: '操作人', render: row => h('div', { class: 'audit-log__actor' },
            h('strong', { text: row.actorName || row.actor }),
            row.actorName ? h('span', { class: 'audit-log__actor-id', text: row.actorEmail || row.actorAccount || row.actor }) : null) },
          { key: 'role', label: '角色', render: row => h('span', { class: 't-caption', text: row.role }) },
          { key: 'board', label: '板块', render: row => badge(boardLabel(row.board), { tone: 'neutral' }) },
          { key: 'action', label: '动作', mono: true, render: row => h('code', { class: 't-data', text: row.action }) },
          { key: 'target', label: '对象', render: row => h('span', { class: 't-caption t-clamp-1', text: row.target || '—' }) },
          { key: 'result', label: '结果', sortable: false, render: row => badge(row.result || '—', { tone: row.result === 'success' ? 'success' : 'error' }) },
        ],
        rows: entries.map((entry, index) => ({ ...entry, id: entry.id || `${entry.at}-${index}` })),
        getKey: row => row.id,
        searchable: false,
        onRowClick: row => renderDetail(row),
      });
    },
  });

  const filterBar = h('div', { class: 'audit-log__toolbar' },
    h('div', { class: 'audit-log__toolbar-time' },
      h('span', { class: 'audit-log__toolbar-label', text: '时间' }),
      rangeSegmented),
    h('label', { class: 'audit-log__search' }, icon('search', 'ico ico--sm'), actorInput),
    boardSelect,
    resultSelect,
    h('div', { class: 'audit-log__toolbar-actions' },
      button({ label: '查询', variant: 'primary', size: 'sm', onClick: applyFilters }),
      button({ label: '重置', variant: 'ghost', size: 'sm', onClick: () => {
        actorInput.value = ''; boardSelect.value = ''; resultSelect.value = '';
        state.actor = ''; state.board = ''; state.result = ''; state.before = ''; state.page = 1;
        listRegion.reload();
      } })),
  );

  const regionRef = region({
    label: '审计',
    title: '全部操作记录',
    actions: [button({ label: '刷新', variant: 'ghost', size: 'sm', iconName: 'refresh', onClick: () => listRegion.reload() })],
    body: h('div', { class: 'stack-4' }, filterBar, summary, listRegion, pager, detail),
  });

  const node = h('div', { class: 'view wspad operations-module audit-log' },
    pageHead({
      title: '操作日志',
      description: '记录平台内的账号、活动、时长、物资与财务操作，可按角色、板块与结果检索。',
      actions: hasPermission('settings')
        ? [button({ label: '数据与连接', variant: 'secondary', iconName: 'activity', href: '/console/admin?view=status' })]
        : [],
    }),
    h('div', { class: 'stack-6' }, regionRef),
  );

  return { title: '操作日志', crumb: '操作日志', node };
}
