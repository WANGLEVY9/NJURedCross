/* ==========================================================================
   console/pages/materials-capacity.js — read-only base capacity report (E9).
   Row counts come from SeaTable read metadata totals; text volume is a
   lower-bound estimate of the characters read. No writes happen here.
   ========================================================================== */

import { h } from '../../core/dom.js';
import { consoleApi } from '../../core/api.js';
import { dataTable } from '../../ui/table.js';
import { asyncRegion, reloadAction } from '../lib.js';
import { pageHead, metric, metricRow, badge, notice, emptyState } from '../../ui/primitives.js';
import { materialServices } from '../../shared/material-services.js';
import * as fmt from '../../core/format.js';

export default async function materialsCapacityPage() {
  const region = asyncRegion({
    errorTitle: '容量报表无法加载',
    load: () => consoleApi.materials.capacity(),
    render: (payload) => {
      const tables = payload.tables || [];
      const top5 = payload.top5 || [];
      const summary = metricRow([
        metric({ label: '数据表', value: payload.totalTables, unit: '张', animate: false }),
        metric({ label: '总行数', value: payload.totalRows, unit: '行', animate: false }),
        metric({ label: '文本体积', value: fmt.int(payload.totalChars), unit: '字符', animate: false }),
      ], { columns: 3 });
      const topPanel = h('section', { class: 'panel panel--raised stack-4' },
        h('h2', { class: 't-h4', text: 'Top 5 大表' }),
        top5.length
          ? h('div', { class: 'stack-2' }, ...top5.map((table, index) => h('div', { class: 'row-3 row-wrap' },
            h('span', { class: 't-caption t-faint', text: String(index + 1) }),
            h('span', { class: 't-secondary t-strong', text: table.table }),
            h('span', { class: 'spacer' }),
            h('b', { class: 't-num', text: fmt.int(table.rows) }),
            h('span', { class: 't-caption', text: '行' }))))
          : emptyState({ iconName: 'table', title: '暂无数据表', description: '当前 Base 没有可统计的数据表。' }));
      const table = dataTable({
        columns: [
          { key: 'table', label: '数据表', strong: true },
          { key: 'rows', label: '行数', align: 'right', render: (row) => h('span', { text: row.rows == null ? '—' : fmt.int(row.rows) }) },
          { key: 'chars', label: '文本体积', align: 'right', render: (row) => h('span', { text: row.chars == null ? '—' : fmt.int(row.chars) }) },
          { key: 'state', label: '状态', sortable: false, render: (row) => row.readable === false ? badge('无法读取', { tone: 'error' }) : row.truncated ? badge('读取达上限', { tone: 'warning' }) : badge('完整', { tone: 'success' }) },
          { key: 'maxRows', label: '读取上限', align: 'right', render: (row) => h('span', { text: row.maxRows == null ? '—' : fmt.int(row.maxRows) }) },
        ],
        rows: tables,
        getKey: (row) => row.table,
        searchPlaceholder: '搜索数据表',
        searchKeys: ['table'],
        countLabel: (n) => `${n} / ${tables.length} 张表`,
        initialSort: { key: 'rows', direction: 'desc' },
      });
      return [summary, topPanel, h('section', { class: 'panel panel--raised stack-4' },
        h('h2', { class: 't-h4', text: '全部数据表' }),
        table,
        notice('行数取自 SeaTable 读取元数据的完整总数；文本体积为本次读取内容的字符量下界，不能视为精确存储体积。', { tone: 'neutral', title: '口径说明' }))];
    },
  });

  return {
    title: '容量报表',
    crumb: '容量报表',
    node: h('div', { class: 'view wspad wspad--wide material-management-page' },
      materialServices('loan', { console: true }),
      pageHead({
        label: '物资中心',
        title: '容量报表',
        description: '只读展示各 SeaTable 数据表的行数与文本体积，用于底表容量治理。',
        actions: [reloadAction(region, '刷新报表')],
      }),
      region),
  };
}
