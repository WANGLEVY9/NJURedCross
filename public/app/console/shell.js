/* ==========================================================================
   console/shell.js — the internal operations workspace.
   Layout: navigation rail · centre workspace · right context inspector.
   The shell owns chrome, shortcuts, notifications and the inspector so pages
   only describe their own content.
   ========================================================================== */

import { h, icon, clear } from '../core/dom.js';
import { swapView } from '../core/motion.js';
import { navigate, refreshCurrent } from '../core/router.js';
import { registerCommands, openPalette } from '../ui/palette.js';
import { button, iconButton, tooltip, avatar, statusIndicator, badge, queueRow, emptyState, skeletonRows, errorState } from '../ui/primitives.js';
import { openDrawer, menuFromTrigger, confirmAction } from '../ui/overlay.js';
import { consoleApi, getSessionState, logout, onSessionChange } from '../core/api.js';
import { prefs } from '../core/store.js';
import { bindKeys, MOD_LABEL } from '../core/keys.js';
import { notify, reportError } from '../core/toast.js';
import * as fmt from '../core/format.js';

const NAV_GROUPS = [
  {
    group: null,
    items: [{ path: '/console/overview', label: '工作台', iconName: 'gauge', keys: 'g o', description: '待办队列、跨模块指标与运营趋势' }],
  },
  {
    group: '组织运营',
    items: [
      { path: '/console/materials', label: '物资中心', iconName: 'box', description: '库存健康、借用审批、出库归还与流水追溯' },
      { path: '/console/events', label: '活动中心', iconName: 'calendar', description: '活动生命周期、场次、报名名单与现场签到' },
      { path: '/console/volunteers', label: '志愿服务', iconName: 'heart', description: '报名到时长的链路缺口定位（只读第二数据源）' },
    ],
  },
  {
    group: '内容与连接',
    items: [
      { path: '/console/outreach', label: '宣传中心', iconName: 'megaphone', description: '投稿审核、排期看板与发布结果登记' },
      { path: '/console/community', label: '温暖连接', iconName: 'handshake', description: '参加同意、投稿审核与发送前的人工确认' },
    ],
  },
  {
    group: '数据与系统',
    items: [
      { path: '/console/data', label: '数据中心', iconName: 'table', description: 'SeaTable 表结构浏览与受保护的行级操作' },
      { path: '/console/settings', label: '系统设置', iconName: 'settings', description: '连接状态、审计记录与上线前的安全清单' },
    ],
  },
];

const VIEW_ROUTES = {
  materials: '/console/materials',
  activities: '/console/events',
  events: '/console/events',
  services: '/console/volunteers',
  volunteers: '/console/volunteers',
  outreach: '/console/outreach',
  community: '/console/community',
};

export function createShell() {
  /* ---- Navigation ---------------------------------------------------- */
  const navItems = new Map();
  const navScroll = h('div', { class: 'nav__scroll' });

  for (const section of NAV_GROUPS) {
    if (section.group) navScroll.append(h('p', { class: 'nav__group t-label', text: section.group }));
    for (const item of section.items) {
      const count = h('span', { class: 'nav__item-count' });
      const link = h(
        'a',
        { class: 'nav__item', href: item.path },
        icon(item.iconName, 'ico ico--sm'),
        h('span', { class: 'nav__item-label', text: item.label }),
        count,
      );
      tooltip(link, { text: item.description });
      navItems.set(item.path, { link, count });
      navScroll.append(link);
    }
  }

  const healthStatus = h('div', { class: 'nav__health' }, statusIndicator('连接中', { tone: 'warning', live: true }));

  const collapseButton = h(
    'button',
    {
      class: 'nav__collapse',
      type: 'button',
      aria: { label: '折叠导航' },
      on: {
        click: () => {
          const collapsed = layout.dataset.nav === 'collapsed';
          layout.dataset.nav = collapsed ? 'expanded' : 'collapsed';
          prefs.set('navCollapsed', !collapsed);
        },
      },
    },
    icon('chevronLeft', 'ico ico--sm'),
  );

  const nav = h(
    'aside',
    { class: 'nav' },
    h(
      'div',
      { class: 'nav__brand' },
      h('a', { class: 'row-3', href: '/console/overview' }, h('span', { class: 'brand-mark' }), h('span', { class: 'nav__brand-text' }, h('b', { text: '红十字会运营端' }), h('span', { text: 'Operations Console' }))),
    ),
    h(
      'button',
      { class: 'nav__workspace', type: 'button', on: { click: (event) => openWorkspaceMenu(event.currentTarget) } },
      h('span', { class: 'status__dot' }),
      h('span', { class: 'nav__workspace-text' }, h('small', { text: '当前工作区' }), h('b', { text: '南京大学红十字会 · 26–27 学年' })),
      icon('chevronDown', 'ico ico--sm'),
    ),
    navScroll,
    h(
      'div',
      { class: 'nav__foot' },
      healthStatus,
      h(
        'a',
        { class: 'nav__item', href: '/' },
        icon('door', 'ico ico--sm'),
        h('span', { class: 'nav__item-label', text: '打开公众端' }),
        icon('external', 'ico ico--sm'),
      ),
    ),
    collapseButton,
  );

  /* ---- Topbar --------------------------------------------------------- */
  const crumbs = h('nav', { class: 'crumbs', attrs: { 'aria-label': '面包屑' } });

  const omni = h(
    'button',
    { class: 'omni', type: 'button', on: { click: () => openPalette() } },
    icon('search', 'ico ico--sm'),
    h('span', { text: '搜索页面、对象与操作' }),
    h('span', { class: 'omni__hint' }, h('span', { class: 'kbd', text: MOD_LABEL }), h('span', { class: 'kbd', text: 'K' })),
  );

  const notificationsButton = iconButton({ iconName: 'bell', label: '通知中心', keys: 'mod+i', onClick: () => openNotifications() });
  const refreshButton = iconButton({ iconName: 'refresh', label: '重新加载当前页面数据', onClick: () => refreshCurrent() });
  const densityButton = iconButton({
    iconName: 'sidebar',
    label: '切换信息密度',
    keys: 'mod+shift+d',
    onClick: () => {
      const next = prefs.get('density', 'comfortable') === 'compact' ? 'comfortable' : 'compact';
      prefs.set('density', next);
      document.documentElement.dataset.density = next;
      notify.info('已切换信息密度', next === 'compact' ? '紧凑模式：适合大批量数据核对。' : '标准模式：适合日常操作。');
    },
  });

  const whoButton = h(
    'button',
    { class: 'who', type: 'button', on: { click: (event) => openAccountMenu(event.currentTarget) } },
    avatar(getSessionState().user?.username || '管'),
    h('span', { class: 'who__text' }, h('b', { text: getSessionState().user?.username || '未登录' }), h('small', { text: '平台管理员' })),
    icon('chevronDown', 'ico ico--sm'),
  );

  const mobileNavButton = iconButton({
    iconName: 'menu',
    label: '展开导航',
    variant: 'icon-btn--mobile',
    onClick: () => {
      layout.dataset.drawer = layout.dataset.drawer === 'open' ? 'closed' : 'open';
    },
  });

  const topbar = h(
    'header',
    { class: 'topbar' },
    mobileNavButton,
    crumbs,
    h('span', { class: 'spacer' }),
    omni,
    refreshButton,
    densityButton,
    notificationsButton,
    h('span', { class: 'divider-v' }),
    whoButton,
  );

  /* ---- Workspace + inspector ------------------------------------------ */
  const outlet = h('div', { class: 'wsmain', id: 'main', attrs: { role: 'main' } });
  const inspectorSlot = h('div', { hidden: true });
  const wsbody = h('div', { class: 'wsbody', data: { inspector: 'closed' } }, outlet, inspectorSlot);
  const workspace = h('div', { class: 'workspace' }, topbar, wsbody);

  const layout = h('div', { class: 'console', data: { nav: prefs.get('navCollapsed', false) ? 'collapsed' : 'expanded', drawer: 'closed' } }, nav, workspace);
  const gateSlot = h('div', { class: 'console-gate', hidden: true });
  const node = h('div', { class: 'console-root' }, layout, gateSlot);

  /* ---- Inspector API -------------------------------------------------- */
  let inspectorState = null;

  function closeInspector() {
    inspectorState = null;
    wsbody.dataset.inspector = 'closed';
    inspectorSlot.hidden = true;
    clear(inspectorSlot);
  }

  function openInspector({ eyebrow = '', title, subtitle = '', body = [], footer = [], onClose = null }) {
    inspectorState = { onClose };
    clear(inspectorSlot);
    inspectorSlot.hidden = false;
    wsbody.dataset.inspector = 'open';
    const bodyNode = h('div', { class: 'inspector__body' }, ...(Array.isArray(body) ? body : [body]).filter(Boolean));
    const footNode = footer.length ? h('div', { class: 'inspector__foot' }, ...footer) : null;
    inspectorSlot.append(
      h(
        'aside',
        { class: 'inspector', attrs: { 'aria-label': title } },
        h(
          'header',
          { class: 'inspector__head row-3 row-top' },
          h(
            'div',
            { class: 'stack-1 spacer' },
            eyebrow ? h('p', { class: 't-label', text: eyebrow }) : null,
            h('h2', { class: 't-h3', text: title }),
            subtitle ? h('p', { class: 't-caption', text: subtitle }) : null,
          ),
          iconButton({
            iconName: 'close',
            label: '关闭详情',
            keys: 'escape',
            onClick: () => {
              onClose?.();
              closeInspector();
            },
          }),
        ),
        bodyNode,
        footNode,
      ),
    );
    return {
      close: closeInspector,
      setBody: (...children) => {
        clear(bodyNode);
        for (const child of children.flat()) if (child) bodyNode.append(child);
      },
      setFooter: (...children) => {
        if (!footNode) return;
        clear(footNode);
        for (const child of children.flat()) if (child) footNode.append(child);
      },
    };
  }

  /* ---- Notifications --------------------------------------------------- */
  let todoCache = null;

  async function loadTodos({ force = false } = {}) {
    if (todoCache && !force) return todoCache;
    todoCache = await consoleApi.notifications();
    applyTodoCounts(todoCache);
    return todoCache;
  }

  function applyTodoCounts(payload) {
    const byRoute = new Map();
    for (const item of payload?.items || []) {
      const route = VIEW_ROUTES[item.view];
      if (!route) continue;
      byRoute.set(route, (byRoute.get(route) || 0) + 1);
    }
    for (const [path, entry] of navItems) {
      const count = byRoute.get(path) || 0;
      entry.count.textContent = count ? String(count) : '';
      if (count) entry.link.dataset.alert = payload?.items?.some((item) => VIEW_ROUTES[item.view] === path && item.priority === 'high') ? 'true' : 'false';
      else delete entry.link.dataset.alert;
    }
    const high = payload?.stats?.high || 0;
    const dot = notificationsButton.querySelector('.icon-btn__dot');
    if (high && !dot) notificationsButton.append(h('span', { class: 'icon-btn__dot' }));
    if (!high && dot) dot.remove();
  }

  function openNotifications() {
    const listSlot = h('div', { class: 'stack-3' }, skeletonRows(5));
    const drawer = openDrawer({
      eyebrow: '通知中心',
      title: '待办与风险',
      description: '按优先级汇总全部模块的待处理事项',
      width: 520,
      body: [listSlot],
      footer: [
        button({ label: '重新统计', variant: 'ghost', iconName: 'refresh', iconMotion: 'spin', onClick: () => load(true) }),
        h('span', { class: 'spacer' }),
        button({ label: '前往工作台', variant: 'primary', iconAfter: 'arrowRight', iconMotion: 'nudge', onClick: () => { drawer.close(); navigate('/console/overview'); } }),
      ],
    });

    const load = async (force) => {
      clear(listSlot);
      listSlot.append(skeletonRows(5));
      try {
        const payload = await loadTodos({ force });
        clear(listSlot);
        if (!payload.items.length) {
          listSlot.append(
            emptyState({
              iconName: 'check',
              title: '当前没有待办事项',
              description: '物资、活动、志愿时长与内容审核都没有需要立即处理的任务。新的待办出现时会在这里提示。',
            }),
          );
          return;
        }
        listSlot.append(
          h(
            'div',
            { class: 'row-2 row-wrap' },
            badge(`高优先级 ${payload.stats.high}`, { tone: 'error' }),
            badge(`需处理 ${payload.stats.medium}`, { tone: 'warning' }),
            badge(`可稍后 ${payload.stats.low}`, { tone: 'info' }),
          ),
          h(
            'div',
            { class: 'queue' },
            ...payload.items.map((item) =>
              queueRow({
                type: item.type,
                title: item.title,
                detail: item.detail,
                priority: item.priority,
                meta: [badge(fmt.priorityLabel(item.priority), { tone: item.priority === 'high' ? 'error' : item.priority === 'medium' ? 'warning' : 'info' })],
                action: button({ label: '处理', variant: 'secondary', size: 'sm', iconAfter: 'arrowRight', iconMotion: 'nudge' }),
                onClick: () => {
                  const route = VIEW_ROUTES[item.view];
                  drawer.close();
                  if (route) navigate(route);
                },
              }),
            ),
          ),
        );
      } catch (error) {
        clear(listSlot);
        listSlot.append(errorState({ title: '待办统计无法加载', error, onRetry: () => load(true) }));
      }
    };
    load(false);
  }

  /* ---- Menus ----------------------------------------------------------- */
  function openWorkspaceMenu(trigger) {
    menuFromTrigger(trigger, [
      { label: '工作区', heading: true },
      { label: '南京大学红十字会 · 26–27 学年', iconName: 'check', onSelect: () => {} },
      { separator: true },
      { label: '查看数据源与连接状态', iconName: 'activity', onSelect: () => navigate('/console/settings') },
      { label: '打开公众端页面', iconName: 'door', onSelect: () => navigate('/') },
    ]);
  }

  function openAccountMenu(trigger) {
    const session = getSessionState();
    menuFromTrigger(trigger, [
      { label: session.user?.username || '未登录', heading: true },
      { label: `会话到期 ${fmt.relative(session.expiresAt)}`, iconName: 'clock', disabled: true, onSelect: () => {} },
      { separator: true },
      { label: '系统设置与审计', iconName: 'settings', onSelect: () => navigate('/console/settings') },
      { label: '快捷键一览', iconName: 'help', keys: `${MOD_LABEL}K`, onSelect: () => openPalette({ initialQuery: '' }) },
      { separator: true },
      {
        label: '退出登录',
        iconName: 'logout',
        variant: 'danger',
        onSelect: async () => {
          const confirmed = await confirmAction({
            title: '退出当前登录？',
            description: '退出后需要重新输入账号密码才能访问物资、活动与审核数据。未提交的表单内容会丢失。',
            confirmLabel: '退出登录',
            tone: 'danger',
          });
          if (!confirmed) return;
          try {
            await logout();
            notify.success('已退出登录');
            navigate('/console/login');
          } catch (error) {
            reportError(error, '退出失败');
          }
        },
      },
    ]);
  }

  /* ---- Commands + shortcuts -------------------------------------------- */
  registerCommands(() => [
    ...NAV_GROUPS.flatMap((section) =>
      section.items.map((item) => ({
        id: `console:${item.path}`,
        title: item.label,
        subtitle: item.description,
        group: '前往',
        iconName: item.iconName,
        run: () => navigate(item.path),
      })),
    ),
    { id: 'console:notifications', title: '打开通知中心', subtitle: '查看全部待办与高优先级风险', group: '操作', iconName: 'bell', run: () => openNotifications() },
    { id: 'console:refresh', title: '重新加载当前页面数据', group: '操作', iconName: 'refresh', run: () => refreshCurrent() },
    {
      id: 'console:density',
      title: '切换信息密度',
      subtitle: '在标准与紧凑模式之间切换',
      group: '工作区',
      iconName: 'sidebar',
      keys: 'mod+shift+d',
      run: () => densityButton.click(),
    },
    { id: 'console:portal', title: '打开公众端门户', group: '工作区', iconName: 'door', run: () => navigate('/') },
  ]);

  bindKeys([
    { combo: 'mod+i', run: () => openNotifications(), label: '打开通知中心', group: '工作区' },
    { combo: 'mod+b', run: () => collapseButton.click(), label: '折叠/展开导航', group: '工作区' },
    { combo: 'escape', run: () => { inspectorState?.onClose?.(); closeInspector(); }, label: '关闭右侧详情', group: '工作区', when: () => wsbody.dataset.inspector === 'open' },
  ]);

  onSessionChange((session) => {
    const label = whoButton.querySelector('.who__text b');
    if (label) label.textContent = session.user?.username || '未登录';
    if (session.authenticated) loadChromeData();
  });

  // The shell is constructed before the login page renders, so authenticated
  // chrome data is only fetched once a session actually exists.
  let chromeLoaded = false;
  function loadChromeData() {
    if (chromeLoaded || !getSessionState().authenticated) return;
    chromeLoaded = true;
    consoleApi
      .health()
      .then((payload) => {
        healthStatus.replaceChildren(
          statusIndicator(`已连接 · ${payload.tables.length} 张表`, { tone: 'success' }),
          h('span', { class: 'spacer' }),
          payload.volunteerSourceConfigured ? badge('双数据源', { tone: 'info' }) : badge('单数据源', { tone: 'neutral' }),
        );
      })
      .catch(() => {
        healthStatus.replaceChildren(statusIndicator('数据服务不可用', { tone: 'error' }));
      });
    loadTodos().catch(() => {});
  }

  loadChromeData();

  /* ---- Shell contract --------------------------------------------------- */
  function setCrumbs(context, result) {
    const current = [...navItems.keys()].find((path) => context.path.startsWith(path));
    const item = NAV_GROUPS.flatMap((section) => section.items).find((entry) => entry.path === current);
    clear(crumbs);
    crumbs.append(
      h('a', { class: 'crumbs__item', href: '/console/overview', text: '运营端' }),
      h('span', { class: 'crumbs__sep', text: '/' }),
      h('span', { class: 'crumbs__current', text: result?.crumb || item?.label || '工作台' }),
    );
  }

  function markActive(pathname) {
    for (const [path, entry] of navItems) {
      if (pathname.startsWith(path)) entry.link.setAttribute('aria-current', 'page');
      else entry.link.removeAttribute('aria-current');
    }
  }

  return {
    node,
    scroller: () => outlet,
    openInspector,
    closeInspector,
    refreshTodos: () => loadTodos({ force: true }),
    openNotifications,
    beginNavigation(context) {
      layout.dataset.drawer = 'closed';
      closeInspector();
      markActive(context.path);
    },
    async showPage(result) {
      if (result?.chrome === false) {
        layout.hidden = true;
        gateSlot.hidden = false;
        await swapView(gateSlot, result.node);
        return;
      }
      layout.hidden = false;
      gateSlot.hidden = true;
      clear(gateSlot);
      await swapView(outlet, result.node);
    },
    endNavigation(context, result) {
      if (result?.chrome === false) return;
      setCrumbs(context, result);
    },
  };
}
