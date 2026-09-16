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

const CHECKLIST = [
  { state: 'done', title: '服务端隔离 SeaTable 凭据', description: 'API Token 只存在服务端环境变量，浏览器只访问本站 /api/*。' },
  { state: 'done', title: '会话与 CSRF 保护', description: 'HttpOnly + SameSite=Strict 会话 Cookie；写操作校验会话绑定的 CSRF 令牌。' },
  { state: 'done', title: '登录失败限流', description: '每个来源地址 15 分钟内 5 次失败后临时封锁。' },
  { state: 'done', title: '公众端写入限流与同意确认', description: '报名、借用、投稿与温暖连接登记按来源地址与动作分桶限流，并要求明确同意。' },
  { state: 'done', title: '本地操作审计', description: '审批、出入库、签到、内容审核与发布结果都会记录操作者、时间、对象与结果。' },
  { state: 'active', title: '接入学校统一身份认证', description: '需要校方提供 CAS/OAuth/OIDC 服务地址、客户端登记与角色映射规则，参数不可假设。' },
  { state: 'active', title: '账号密码哈希与角色最小权限', description: '当前为本地账号且统一为平台管理员角色；需迁移为 scrypt/Argon2 并按表、字段、动作拆分权限。' },
  { state: 'pending', title: '集中式库存锁', description: '当前串行锁只覆盖单个 Node 进程；多进程部署需要集中式锁或数据库事务。' },
  { state: 'pending', title: '写入失败的可重放 outbox', description: '「流水已写入但申请状态同步失败」目前只标记异常说明，尚不能自动重试或人工重放。' },
  { state: 'pending', title: '生产邮件、备份与监控', description: 'SMTP、HTTPS、反向代理、备份恢复演练、限流告警与 Token 轮换仍待完成。' },
];

export default async function settingsPage() {
  let tab = 'status';
  const bodySlot = h('div', { class: 'stack-6' });

  const tabControl = segmented({
    items: [
      { value: 'status', label: '连接与会话' },
      { value: 'audit', label: '操作审计' },
      { value: 'checklist', label: '上线清单' },
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

  /* ---- Status ----------------------------------------------------------- */
  const statusRegion = asyncRegion({
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(3), skeletonRows(6)),
    errorTitle: '连接状态无法加载',
    load: () => consoleApi.health(),
    render: (payload) => {
      const session = getSessionState();
      const sensitiveTables = payload.tables.filter((table) => table.columns.some((column) => /手机|身份证|银行|微信|QQ/.test(column.name)));
      return [
        metricRow(
          [
            metric({ label: '已接入数据表', value: payload.tables.length, unit: '张' }),
            metric({ label: '含敏感字段的表', value: sensitiveTables.length, unit: '张', tone: sensitiveTables.length ? 'warn' : '' }),
            metric({ label: '字段总数', value: payload.tables.reduce((sum, table) => sum + table.columns.length, 0), unit: '个' }),
          ],
          { columns: 3 },
        ),
        h(
          'div',
          { class: 'wscols' },
          h(
            'div',
            { class: 'stack-6' },
            region({
              label: '数据服务',
              title: '连接信息',
              actions: [statusIndicator('已连接', { tone: 'success' })],
              dense: true,
              body: definitionList([
                ['服务地址', copyableCode(payload.server)],
                ['默认表', payload.configuredTable || '未指定（页面可自由选择）'],
                ['第二数据源', payload.volunteerSourceConfigured ? '已配置 · 只读' : '未配置'],
                ['凭据位置', '仅服务端环境变量'],
              ]),
            }),
            region({
              label: '会话',
              title: '当前登录',
              dense: true,
              body: definitionList([
                ['账号', session.user?.username || '未登录'],
                ['角色', session.user?.role || '—'],
                ['会话到期', `${fmt.fullDateTime(session.expiresAt)}（${fmt.relative(session.expiresAt)}）`],
                ['CSRF 令牌', session.csrfToken ? '已签发（与会话绑定）' : '未签发'],
              ]),
            }),
            notice(
              '当前为本地管理员账号原型，不是学校统一身份认证。所有账号仍拥有同一 platform_admin 写入权限；生产部署前必须完成角色拆分与密码哈希迁移。',
              { tone: 'warning', iconName: 'alert', title: '身份与权限边界' },
            ),
          ),
          h(
            'div',
            { class: 'stack-6' },
            region({
              label: '敏感字段盘点',
              title: sensitiveTables.length ? `${sensitiveTables.length} 张表含敏感字段` : '未检测到敏感字段',
              description: '按字段名启发式识别，用于提醒而非替代正式的数据分级。',
              dense: true,
              body: sensitiveTables.length
                ? h(
                    'div',
                    { class: 'stack-3' },
                    ...sensitiveTables.map((table) =>
                      h(
                        'div',
                        { class: 'stack-2 sensitive-row' },
                        h('b', { class: 't-secondary t-strong', text: table.name }),
                        h(
                          'div',
                          { class: 'row-2 row-wrap' },
                          ...table.columns
                            .filter((column) => /手机|身份证|银行|微信|QQ/.test(column.name))
                            .map((column) => badge(column.name, { tone: 'warning', iconName: 'lock' })),
                        ),
                      ),
                    ),
                  )
                : emptyState({ iconName: 'shield', title: '没有识别到敏感字段', description: '仍建议按字段权限控制访问范围。' }),
            }),
            region({
              label: '结构预览',
              title: '业务表 dry-run',
              description: '只读检查目标表与字段是否匹配，不会创建表或写入数据。',
              dense: true,
              body: h(
                'div',
                { class: 'row-2 row-wrap' },
                button({ label: '活动表结构', variant: 'secondary', size: 'sm', iconName: 'calendar', onClick: () => previewSchema('events') }),
                button({ label: '宣传表结构', variant: 'secondary', size: 'sm', iconName: 'megaphone', onClick: () => previewSchema('outreach') }),
              ),
            }),
          ),
        ),
      ];
    },
  });

  async function previewSchema(kind) {
    const { openDrawer } = await import('../../ui/overlay.js');
    const slot = h('div', { class: 'stack-4' }, skeletonRows(4));
    const drawer = openDrawer({
      eyebrow: '只读结构预览',
      title: kind === 'events' ? '活动业务表结构' : '宣传业务表结构',
      description: 'dry-run 模式：不会创建表、不会写入数据。',
      width: 560,
      body: [notice('如需真实建表，请在服务器上执行带显式确认参数的脚本，而不是从页面触发。', { tone: 'warning' }), slot],
      footer: [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'primary', onClick: () => drawer.close() })],
    });
    try {
      const payload = kind === 'events' ? await consoleApi.events.schemaPreview() : await consoleApi.outreach.schemaPreview();
      clear(slot);
      for (const table of payload.tables) {
        slot.append(
          h(
            'div',
            { class: 'stack-3 schema-row' },
            h('div', { class: 'row-3 row-wrap' }, h('b', { class: 't-secondary t-strong', text: table.name }), table.exists ? badge('已存在', { tone: 'success' }) : badge('待创建', { tone: 'warning' })),
            h('p', { class: 't-caption', text: table.purpose }),
            h('div', { class: 'row-2 row-wrap' }, ...table.columns.map((column) => badge(column, { tone: table.matchedColumns.includes(column) ? 'success' : 'neutral' }))),
            table.missingColumns.length ? h('p', { class: 't-caption', text: `缺少字段：${table.missingColumns.join('、')}` }) : null,
          ),
        );
      }
    } catch (error) {
      clear(slot);
      slot.append(notice(error.message || '预览失败', { tone: 'error', title: '无法读取结构' }));
    }
  }

  /* ---- Audit ------------------------------------------------------------ */
  const auditRegion = asyncRegion({
    skeleton: skeletonRows(8),
    errorTitle: '审计记录无法加载',
    load: () => consoleApi.audit(120),
    render: (payload) => {
      if (!payload.entries.length) {
        return emptyState({
          iconName: 'activity',
          title: '还没有审计记录',
          description: '登录、审批、出入库、签到核验、内容审核与发布结果都会在这里留下不含敏感明文的记录。',
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
        notice(`来源：${payload.source}。审计日志不保存 Token、密码或签到码明文。`, { tone: 'neutral', iconName: 'shield' }),
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
          countLabel: (n) => `${n} 条审计记录`,
          initialSort: { key: 'at', direction: 'desc' },
        }),
      ];
    },
  });

  /* ---- Checklist -------------------------------------------------------- */
  function renderChecklist() {
    const done = CHECKLIST.filter((item) => item.state === 'done').length;
    return h(
      'div',
      { class: 'stack-6' },
      metricRow(
        [
          metric({ label: '已完成', value: done, unit: '项', animate: false }),
          metric({ label: '进行中', value: CHECKLIST.filter((item) => item.state === 'active').length, unit: '项', animate: false, tone: 'warn' }),
          metric({ label: '未开始', value: CHECKLIST.filter((item) => item.state === 'pending').length, unit: '项', animate: false }),
        ],
        { columns: 3 },
      ),
      notice('这份清单描述平台当前的真实状态。标记为「进行中」或「未开始」的项目意味着相关能力尚不可依赖。', { tone: 'info', iconName: 'info' }),
      region({
        label: '安全与可靠性',
        title: '上线前清单',
        dense: true,
        body: timeline(
          CHECKLIST.map((item) => ({
            title: item.title,
            description: item.description,
            state: item.state,
            iconName: item.state === 'done' ? 'check' : item.state === 'active' ? 'clock' : 'alert',
            badge: badge(item.state === 'done' ? '已完成' : item.state === 'active' ? '进行中' : '未开始', {
              tone: item.state === 'done' ? 'success' : item.state === 'active' ? 'warning' : 'neutral',
            }),
          })),
        ),
      }),
    );
  }

  /* ---- Workspace preferences -------------------------------------------- */
  function renderWorkspace() {
    const shortcuts = listShortcuts();
    return h(
      'div',
      { class: 'stack-6' },
      region({
        label: '显示',
        title: '信息密度与导航',
        description: '偏好保存在本机浏览器，不会同步到服务端。',
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
      bodySlot.append(h('div', { class: 'row-3 row-wrap' }, tabControl, h('span', { class: 'spacer' }), reloadAction(auditRegion, '刷新')), auditRegion);
    } else if (tab === 'checklist') {
      bodySlot.append(h('div', { class: 'row-3 row-wrap' }, tabControl), renderChecklist());
    } else if (tab === 'workspace') {
      bodySlot.append(h('div', { class: 'row-3 row-wrap' }, tabControl), renderWorkspace());
    } else {
      bodySlot.append(h('div', { class: 'row-3 row-wrap' }, tabControl, h('span', { class: 'spacer' }), reloadAction(statusRegion, '刷新')), statusRegion);
    }
    requestAnimationFrame(() => tabControl.reposition?.());
  }

  const node = h(
    'div',
    { class: 'view wspad wspad--wide' },
    pageHead({
      label: '系统设置',
      title: '连接状态、审计与上线清单',
      description: '这里如实展示平台当前具备与尚未具备的能力，避免把原型能力当作生产能力使用。',
      meta: [statusIndicator('本地管理员账号原型', { tone: 'warning' })],
    }),
    bodySlot,
  );

  renderTab();
  return { title: '系统设置', crumb: '系统设置', node };
}
