/* ==========================================================================
   console/pages/settings.js — system status, audit trail and the honest
   pre-production checklist. Nothing here is claimed as done unless it is.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { consoleApi, getSessionState } from '../../core/api.js';
import { asyncRegion, region, reloadAction } from '../lib.js';
import { dataTable } from '../../ui/table.js';
import {
  pageHead, metric, metricRow, badge, button, notice, emptyState, segmented,
  skeletonRows, skeletonMetrics, statusIndicator, definitionList, copyableCode, toggle, timeline,
} from '../../ui/primitives.js';
import { prefs } from '../../core/store.js';
import { notify } from '../../core/toast.js';
import { MOD_LABEL, listShortcuts, keyCaps } from '../../core/keys.js';
import * as fmt from '../../core/format.js';

export default async function settingsPage(context = {}) {
  let tab = context.initialTab || 'status';
  const bodySlot = h('div', { class: 'stack-6' });

  const tabControl = segmented({
    items: [
      { value: 'status', label: '系统状态' },
      { value: 'audit', label: '操作记录' },
      { value: 'workspace', label: '工作区偏好' },
    ],
    value: tab,
    ariaLabel: '系统设置视图',
    onChange: (value) => {
      tab = value;
      tabControl.setValue(value);
      renderTab();
    },
  });

  const statusRegion = asyncRegion({
    lazy: true,
    errorTitle:'系统状态暂时无法加载',load:()=>consoleApi.health(),
    render:payload=>region({title:'系统状态',actions:[statusIndicator('已连接',{tone:'success'})],body:definitionList([
      ['当前账号',getSessionState().user?.username||'未登录'],
      ['数据表',`${payload.tables.length} 张`],
    ])}),
  });

  /* ---- Audit ------------------------------------------------------------ */
  const auditRegion = asyncRegion({
    lazy: true,
    skeleton: skeletonRows(8),
    errorTitle: '操作记录无法加载',
    load: () => consoleApi.audit(120),
    render: (payload) => {
      if (!payload.entries.length) {
        return emptyState({
          iconName: 'activity',
          title: '还没有操作记录',
          description: '完成操作后，可在这里查看。',
        });
      }
      const failures = payload.entries.filter((entry) => entry.result !== 'success').length;
      return [
        metricRow(
          [
            metric({ label: '最近记录', value: payload.entries.length, unit: '条', animate: false }),
            metric({ label: '非成功结果', value: failures, unit: '条', tone: failures ? 'warn' : '', animate: false }),
            metric({ label: '涉及操作者', value: new Set(payload.entries.map((entry) => entry.actor)).size, unit: '人', animate: false }),
          ],
          { columns: 3 },
        ),
        dataTable({
          columns: [
            { key: 'at', label: '时间', render: (row) => h('span', { class: 't-caption', text: fmt.fullDateTime(row.at) }) },
            { key: 'actor', label: '操作者', strong: true },
            { key: 'action', label: '动作', mono: true, render: (row) => h('code', { class: 't-data', text: row.action }) },
            { key: 'target', label: '对象', render: (row) => h('span', { class: 't-caption t-clamp-1', text: row.target }) },
            { key: 'result', label: '结果', sortable: false, render: (row) => badge(row.result, { tone: row.result === 'success' ? 'success' : 'error' }) },
            { key: 'metadata', label: '摘要', sortable: false, render: (row) => h('span', { class: 't-caption t-clamp-1', text: Object.entries(row.metadata || {}).map(([key, value]) => `${key}=${value}`).join(' · ') || '—' }) },
          ],
          rows: payload.entries.map((entry, index) => ({ ...entry, id: `${entry.at}-${index}` })),
          getKey: (row) => row.id,
          searchPlaceholder: '搜索操作者、动作或对象',
          searchKeys: ['actor', 'action', 'target'],
          countLabel: (n) => `${n} 条操作记录`,
          initialSort: { key: 'at', direction: 'desc' },
        }),
      ];
    },
  });

  /* ---- Workspace preferences -------------------------------------------- */
  function renderWorkspace() {
    const shortcuts = listShortcuts();
    return h(
      'div',
      { class: 'stack-6' },
      region({
        label: '显示',
        title: '信息密度与导航',
        description: '调整页面密度和导航显示。',
        dense: true,
        body: h(
          'div',
          { class: 'stack-4' },
          h(
            'div',
            { class: 'row-3 unlock-bar' },
            icon('sidebar', 'ico ico--lg'),
            h('div', { class: 'stack-1 spacer' }, h('b', { class: 't-secondary t-strong', text: '紧凑模式' }), h('p', { class: 't-caption', text: '缩小行高与控件尺寸，适合大批量数据核对。' })),
            toggle({
              checked: prefs.get('density', 'comfortable') === 'compact',
              onChange: (next) => {
                const value = next ? 'compact' : 'comfortable';
                prefs.set('density', value);
                document.documentElement.dataset.density = value;
                notify.info('已更新信息密度', next ? '紧凑模式已启用。' : '已回到标准模式。');
              },
            }),
          ),
          h(
            'div',
            { class: 'row-3 unlock-bar' },
            icon('menu', 'ico ico--lg'),
            h('div', { class: 'stack-1 spacer' }, h('b', { class: 't-secondary t-strong', text: '默认折叠导航' }), h('p', { class: 't-caption', text: `下次进入时保持折叠状态；也可以随时用 ${MOD_LABEL}B 切换。` })),
            toggle({
              checked: prefs.get('navCollapsed', false),
              onChange: (next) => {
                prefs.set('navCollapsed', next);
                notify.info('已更新导航偏好', next ? '下次进入将默认折叠导航。' : '下次进入将默认展开导航。');
              },
            }),
          ),
        ),
      }),
      region({
        label: '键盘',
        title: '可用快捷键',
        description: '高频操作都可以不依赖鼠标完成。',
        dense: true,
        body: shortcuts.length
          ? h(
              'div',
              { class: 'fieldgrid' },
              ...shortcuts.map((entry) =>
                h(
                  'div',
                  { class: 'fieldgrid__item' },
                  h('span', { class: 't-secondary t-clamp-1', text: entry.label }),
                  h('div', { class: 'row-2' }, ...keyCaps(entry.combo).map((cap) => h('span', { class: 'kbd', text: cap }))),
                ),
              ),
            )
          : emptyState({ iconName: 'help', title: '暂无已注册的快捷键', description: '进入具体模块后会注册对应的快捷键。' }),
      }),
    );
  }

  function renderTab() {
    clear(bodySlot);
    if (tab === 'audit') {
      auditRegion.ensureLoaded();
      bodySlot.append(h('div', { class: 'row-3 row-wrap' }, context.embedded ? null : tabControl, h('span', { class: 'spacer' }), reloadAction(auditRegion, '刷新')), auditRegion);

    } else if (tab === 'workspace') {
      bodySlot.append(h('div', { class: 'row-3 row-wrap' }, context.embedded ? null : tabControl), renderWorkspace());
    } else {
      bodySlot.append(h('div', { class: 'row-3 row-wrap' }, context.embedded ? null : tabControl, h('span', { class: 'spacer' }), reloadAction(statusRegion, '刷新')), statusRegion);
      statusRegion.ensureLoaded();
    }
    requestAnimationFrame(() => tabControl.reposition?.());
  }

  const node = h(
    'div',
    { class: 'view wspad wspad--wide' },
    pageHead({
      label: '系统设置',
      title: '系统设置',
      description: '查看系统状态和操作记录，调整工作区显示。',
    }),
    bodySlot,
  );

  renderTab();
  return { title: '系统设置', crumb: '管理员中心', node: context.embedded ? bodySlot : node };
}
