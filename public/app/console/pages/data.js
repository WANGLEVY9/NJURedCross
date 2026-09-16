/* ==========================================================================
   console/pages/data.js — SeaTable data centre.
   Browsing is open; writing requires an explicit per-session unlock and a
   typed confirmation, because this surface bypasses business validation.
   ========================================================================== */

import { h, icon, clear, qsa } from '../../core/dom.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { dataTable } from '../../ui/table.js';
import { asyncRegion, region, reloadAction } from '../lib.js';
import {
  pageHead, metric, metricRow, badge, button, field, notice, emptyState,
  skeletonMetrics, skeletonRows, copyableCode, runWithLoading, toggle, statusIndicator,
} from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';

const SENSITIVE_PATTERN = /手机|电话|身份证|银行|微信|QQ|邮箱|学号|住址|地址|密码/;
const UNLOCK_PHRASE = 'UNLOCK-WRITE';

function isSensitive(columnName) {
  return SENSITIVE_PATTERN.test(String(columnName || ''));
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? `${value.length} 项` : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default async function dataPage() {
  let tables = [];
  let selected = null;
  let writeUnlocked = false;

  const listSlot = h('div', { class: 'split__list' });
  const detailSlot = h('div', { class: 'split__detail' });

  const searchInput = h('input', { class: 'input', type: 'search', placeholder: '搜索表名', attrs: { 'aria-label': '搜索表名' } });
  searchInput.addEventListener('input', () => renderList());

  const masterHead = h('div', { class: 'toolbar' }, h('div', { class: 'input-group table__search' }, icon('search', 'ico ico--sm'), searchInput));

  const metaRegion = asyncRegion({
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(3), skeletonRows(8)),
    errorTitle: '表结构无法加载',
    load: () => consoleApi.health(),
    render: (payload) => {
      tables = payload.tables;
      if (!selected || !tables.some((table) => table.name === selected)) selected = payload.configuredTable || tables[0]?.name || null;
      renderList();
      renderDetail();
      const totalColumns = tables.reduce((sum, table) => sum + table.columns.length, 0);
      return [
        metricRow(
          [
            metric({ label: '已接入数据表', value: tables.length, unit: '张' }),
            metric({ label: '字段总数', value: totalColumns, unit: '个' }),
            metric({ label: '视图总数', value: tables.reduce((sum, table) => sum + table.views.length, 0), unit: '个' }),
          ],
          { columns: 3 },
        ),
        notice(
          `数据服务：${payload.server}。第二数据源${payload.volunteerSourceConfigured ? '已配置（只读）' : '未配置'}。浏览器只请求本站 /api/*，SeaTable Token 始终保存在服务端。`,
          { tone: 'neutral', iconName: 'lock' },
        ),
        h('div', { class: 'panel panel--raised split-wrap' }, h('div', { class: 'split' }, h('div', { class: 'split__master' }, masterHead, listSlot), detailSlot)),
      ];
    },
  });

  function renderList() {
    const needle = searchInput.value.trim().toLowerCase();
    const visible = tables.filter((table) => !needle || table.name.toLowerCase().includes(needle));
    clear(listSlot);
    if (!visible.length) {
      listSlot.append(emptyState({ iconName: 'search', title: '没有匹配的表', description: '清空关键词后可以看到全部已接入的数据表。' }));
      return;
    }
    for (const table of visible) {
      const sensitiveCount = table.columns.filter((column) => isSensitive(column.name)).length;
      const row = h(
        'button',
        {
          class: 'listrow',
          type: 'button',
          aria: { selected: String(table.name === selected) },
          on: {
            click: () => {
              selected = table.name;
              qsa('.listrow', listSlot).forEach((node) => node.setAttribute('aria-selected', 'false'));
              row.setAttribute('aria-selected', 'true');
              renderDetail();
            },
          },
        },
        h(
          'div',
          { class: 'listrow__text' },
          h('span', { class: 't-secondary t-strong t-clamp-1', text: table.name }),
          h(
            'div',
            { class: 'row-2' },
            h('span', { class: 't-caption', text: `${table.columns.length} 字段 · ${table.views.length} 视图` }),
            sensitiveCount ? badge(`${sensitiveCount} 敏感字段`, { tone: 'warning' }) : null,
          ),
        ),
        icon('chevronRight', 'ico ico--sm t-faint'),
      );
      listSlot.append(row);
    }
  }

  function openRowDrawer(table, { row = null, onDone }) {
    const editing = Boolean(row);
    const editable = table.columns.filter((column) => !['creator', 'ctime', 'last-modifier', 'mtime', 'auto-number', 'formula', 'link', 'link-formula', 'button'].includes(column.type));
    const fields = new Map();

    const body = editable.map((column) => {
      const control = field({
        label: column.name,
        name: column.key,
        value: row && typeof row[column.name] !== 'object' ? String(row[column.name] ?? '') : '',
        placeholder: `类型：${column.type}`,
        hint: isSensitive(column.name) ? '敏感字段：请确认确有必要写入，并遵循最小化原则。' : '',
        multiline: column.type === 'long-text',
      });
      fields.set(column.name, control);
      return control;
    });

    const submitButton = button({ label: editing ? '保存修改' : '新增记录', variant: 'primary', iconName: 'check', onClick: () => submit() });

    const drawer = openDrawer({
      eyebrow: table.name,
      title: editing ? '编辑记录' : '新增记录',
      description: '按字段填写，避免手写原始 JSON。留空的字段不会被提交。',
      width: 560,
      body: [
        notice('这个入口绕过业务状态机与字段校验，只用于数据修正。日常业务请使用物资、活动等专用流程。', { tone: 'warning', title: '谨慎使用' }),
        ...body,
      ],
      footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
    });

    async function submit() {
      const payloadRow = {};
      for (const [name, control] of fields) {
        const value = String(control.control.value || '').trim();
        if (value) payloadRow[name] = value;
      }
      if (!Object.keys(payloadRow).length) {
        notify.warning('没有可提交的内容', '请至少填写一个字段。');
        return;
      }
      const confirmed = await confirmAction({
        title: editing ? '确认写入这些修改？' : '确认新增这条记录？',
        description: `目标表：${table.name}。这次写入会直接修改 SeaTable 数据，并记录在审计日志中。`,
        details: Object.entries(payloadRow).map(([key, value]) => `${key} = ${fmt.truncate(value, 40)}`),
        confirmLabel: editing ? '写入修改' : '新增记录',
        tone: 'danger',
      });
      if (!confirmed) return;
      try {
        await runWithLoading(submitButton, () =>
          editing ? consoleApi.data.updateRow(table.name, row._id, payloadRow) : consoleApi.data.appendRow(table.name, payloadRow),
        );
        notify.success(editing ? '修改已写入' : '记录已新增', table.name);
        drawer.close();
        onDone?.();
      } catch (error) {
        if (error instanceof ApiError && (error.status === 400 || error.isConflict)) {
          notify.warning('写入被拒绝', error.message);
          return;
        }
        reportError(error, '写入未完成');
      }
    }
  }

  function renderDetail() {
    const table = tables.find((item) => item.name === selected);
    clear(detailSlot);
    if (!table) {
      detailSlot.append(emptyState({ iconName: 'table', title: '选择左侧的表查看结构与数据', description: '这里会展示字段类型、敏感字段标记与前 100 行预览。' }));
      return;
    }

    const rowsSlot = h('div', { class: 'stack-4' });

    const rowsRegion = asyncRegion({
      skeleton: skeletonRows(6),
      errorTitle: `无法读取「${table.name}」的数据`,
      load: () => consoleApi.data.rows(table.name),
      render: (payload, { reload }) => {
        if (!payload.rows.length) {
          return emptyState({
            iconName: 'inbox',
            title: '这张表还没有数据',
            description: '表结构已经就绪。业务流程产生真实记录后会出现在这里。',
            actions: writeUnlocked ? [button({ label: '新增记录', variant: 'primary', iconName: 'plus', onClick: () => openRowDrawer(table, { onDone: reload }) })] : [],
          });
        }
        const columns = table.columns.slice(0, 8).map((column) => ({
          key: column.name,
          label: column.name,
          value: (row) => (typeof row[column.name] === 'object' ? JSON.stringify(row[column.name] ?? '') : row[column.name]),
          render: (row) =>
            isSensitive(column.name)
              ? h('span', { class: 't-caption t-faint', text: row[column.name] ? '已隐藏' : '—' })
              : h('span', { class: 't-caption t-clamp-1', text: displayValue(row[column.name]) }),
        }));
        return [
          dataTable({
            columns,
            rows: payload.rows,
            getKey: (row) => row._id,
            searchPlaceholder: `搜索「${table.name}」`,
            countLabel: (n) => `${n} / ${payload.rows.length} 行（最多读取 100 行）`,
            actions: writeUnlocked ? [button({ label: '新增记录', variant: 'secondary', size: 'sm', iconName: 'plus', onClick: () => openRowDrawer(table, { onDone: reload }) })] : [],
            buildRowMenu: (row) =>
              writeUnlocked
                ? [
                    { label: '编辑这一行', iconName: 'edit', onSelect: () => openRowDrawer(table, { row, onDone: reload }) },
                    { label: '复制行 ID', iconName: 'copy', onSelect: () => navigator.clipboard?.writeText(row._id) },
                    { separator: true },
                    {
                      label: '删除这一行',
                      iconName: 'trash',
                      variant: 'danger',
                      onSelect: async () => {
                        const confirmed = await confirmAction({
                          title: '删除这一行数据？',
                          description: `目标表：${table.name}，行 ID：${row._id}。删除无法通过平台撤销。`,
                          confirmLabel: '永久删除',
                          tone: 'danger',
                          requirePhrase: 'DELETE',
                        });
                        if (!confirmed) return;
                        try {
                          await consoleApi.data.deleteRow(table.name, row._id);
                          notify.success('已删除该行', table.name);
                          reload();
                        } catch (error) {
                          reportError(error, '删除未完成');
                        }
                      },
                    },
                  ]
                : [
                    { label: '复制行 ID', iconName: 'copy', onSelect: () => navigator.clipboard?.writeText(row._id) },
                    { label: '写入已锁定', iconName: 'lock', disabled: true, onSelect: () => {} },
                  ],
          }),
        ];
      },
    });

    rowsSlot.append(rowsRegion);

    const unlockToggle = toggle({
      label: '',
      checked: writeUnlocked,
      onChange: async (next) => {
        if (!next) {
          writeUnlocked = false;
          notify.info('写入已重新锁定');
          renderDetail();
          return;
        }
        const confirmed = await confirmAction({
          title: '解锁原始数据写入？',
          description: '解锁后可以直接新增、编辑与删除 SeaTable 行。这个入口不经过业务状态机校验，容易造成数据不一致。',
          details: ['日常审批、出入库与签到请使用对应业务模块', '所有写入都会记录在审计日志中', '离开或刷新页面后会自动重新锁定'],
          confirmLabel: '我理解风险，解锁写入',
          tone: 'danger',
          requirePhrase: UNLOCK_PHRASE,
        });
        writeUnlocked = confirmed;
        if (confirmed) notify.warning('原始写入已解锁', '请谨慎操作，完成后请立即重新锁定。');
        renderDetail();
      },
    });

    detailSlot.append(
      h(
        'div',
        { class: 'detailpad stack-6' },
        h(
          'header',
          { class: 'stack-3' },
          h('div', { class: 'row-3 row-wrap' }, badge(`${table.columns.length} 字段`, { tone: 'neutral' }), badge(`${table.views.length} 视图`, { tone: 'neutral' }), statusIndicator(writeUnlocked ? '写入已解锁' : '只读模式', { tone: writeUnlocked ? 'error' : 'success', live: writeUnlocked })),
          h('h2', { class: 't-h1', text: table.name }),
          h('div', { class: 'row-2 row-wrap' }, copyableCode(table._id, { label: '复制表 ID' })),
        ),
        h(
          'div',
          { class: 'row-3 unlock-bar' },
          icon('lock', 'ico ico--lg'),
          h(
            'div',
            { class: 'stack-1 spacer' },
            h('b', { class: 't-secondary t-strong', text: '原始数据写入' }),
            h('p', { class: 't-caption', text: '默认锁定。解锁需要输入确认短语，并且只在当前页面有效。' }),
          ),
          unlockToggle,
        ),
        region({
          label: '字段字典',
          title: '结构与敏感字段',
          description: '标记为敏感的字段在预览中始终隐藏，即使解锁写入也不会明文展示。',
          dense: true,
          body: h(
            'div',
            { class: 'fieldgrid' },
            ...table.columns.map((column) =>
              h(
                'div',
                { class: 'fieldgrid__item', data: { sensitive: isSensitive(column.name) ? 'true' : null } },
                h('span', { class: 't-secondary t-strong t-clamp-1', text: column.name }),
                h('div', { class: 'row-2' }, h('code', { class: 't-data t-faint', text: column.type }), isSensitive(column.name) ? badge('敏感', { tone: 'warning', iconName: 'lock' }) : null),
              ),
            ),
          ),
        }),
        region({
          label: '数据预览',
          title: '前 100 行',
          description: '只展示前 8 个字段，敏感字段以「已隐藏」代替。',
          actions: [reloadAction(rowsRegion)],
          dense: true,
          body: rowsSlot,
        }),
        table.views.length
          ? region({
              label: '视图',
              title: 'SeaTable 视图',
              dense: true,
              body: h('div', { class: 'row-2 row-wrap' }, ...table.views.map((view) => badge(view.name, { tone: 'neutral', iconName: 'eye' }))),
            })
          : null,
      ),
    );
  }

  const node = h(
    'div',
    { class: 'view wspad wspad--wide' },
    pageHead({
      label: '数据中心',
      title: 'SeaTable 表结构与数据',
      description: '用于结构核对与数据修正。浏览开放，写入默认锁定：业务操作请回到对应的物资、活动或内容模块。',
      meta: [statusIndicator('写入默认锁定', { tone: 'success' })],
      actions: [reloadAction(metaRegion, '刷新结构')],
    }),
    metaRegion,
  );

  return { title: '数据中心', crumb: '数据中心', node };
}
