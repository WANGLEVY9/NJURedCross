/* ==========================================================================
   portal/shell.js — the public service shell.
   Kept intentionally light: one primary action per screen, navigation that
   mirrors what people actually come here to do.
   ========================================================================== */

import { h, qsa } from '../core/dom.js';
import { swapView } from '../core/motion.js';
import { navigate } from '../core/router.js';
import { registerCommands } from '../ui/palette.js';
import { button, iconButton } from '../ui/primitives.js';
import { getSessionState } from '../core/api.js';

const NAV = [
  { path: '/events', label: '活动报名', iconName: 'calendar', description: '浏览公开活动、选择场次并获取签到凭证' },
  { path: '/materials', label: '物资借用', iconName: 'box', description: '提交物资借用申请，等待管理员审批' },
  { path: '/submit', label: '内容投稿', iconName: 'megaphone', description: '投递宣传稿件、图片与活动记录' },
  { path: '/warmth', label: '温暖连接', iconName: 'heart', description: '了解生日祝福与早安晚安同行计划' },
  { path: '/status', label: '我的状态', iconName: 'target', description: '用报名编号查询报名、候补与签到状态' },
];

export function createShell() {
  const outlet = h('main', { class: 'portal__outlet', id: 'main', attrs: { role: 'main' } });

  const nav = h(
    'nav',
    { class: 'pnav', attrs: { 'aria-label': '主导航' } },
    ...NAV.map((item) => h('a', { class: 'pnav__link', href: item.path, text: item.label })),
  );

  const menuButton = iconButton({
    iconName: 'menu',
    label: '展开导航',
    variant: 'pmenu-btn',
    onClick: () => {
      const open = nav.dataset.open === 'true';
      if (open) delete nav.dataset.open;
      else nav.dataset.open = 'true';
    },
  });

  const header = h(
    'header',
    { class: 'phead' },
    h(
      'div',
      { class: 'phead__inner' },
      h(
        'a',
        { class: 'plogo', href: '/', attrs: { 'aria-label': '南京大学红十字会首页' } },
        h('span', { class: 'brand-mark' }),
        h('span', { class: 'plogo__text' }, h('b', { text: '南京大学红十字会' }), h('span', { text: 'NJU Red Cross' })),
      ),
      h('span', { class: 'spacer' }),
      nav,
      button({ label: '管理端登录', variant: 'ghost', size: 'sm', iconName: 'lock', href: '/console/overview', data: { hideSm: 'true' } }),
      button({ label: '查看活动', variant: 'primary', size: 'sm', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/events' }),
      menuButton,
    ),
  );

  const footer = h(
    'footer',
    { class: 'pfoot' },
    h(
      'div',
      { class: 'pfoot__inner' },
      h(
        'div',
        { class: 'pfoot__col' },
        h('div', { class: 'row-3' }, h('span', { class: 'brand-mark' }), h('b', { class: 't-title', text: '南京大学红十字会' })),
        h('p', { class: 't-secondary', text: '人道 · 博爱 · 奉献。我们在校园里组织急救培训、无偿献血宣传、生命教育与志愿服务，并为同学提供物资借用与活动参与的统一入口。' }),
      ),
      h(
        'div',
        { class: 'pfoot__col' },
        h('p', { class: 't-label', text: '参与' }),
        ...NAV.slice(0, 3).map((item) => h('a', { href: item.path, text: item.label })),
      ),
      h(
        'div',
        { class: 'pfoot__col' },
        h('p', { class: 't-label', text: '了解' }),
        h('a', { href: '/warmth', text: '温暖连接计划' }),
        h('a', { href: '/about', text: '平台与隐私说明' }),
        h('a', { href: '/status', text: '查询我的记录' }),
      ),
      h(
        'div',
        { class: 'pfoot__col' },
        h('p', { class: 't-label', text: '管理' }),
        h('a', { href: '/console/overview', text: '运营管理端' }),
      ),
    ),
    h(
      'div',
      { class: 'pfoot__bar' },
      h('p', { class: 't-caption', text: '本平台仅收集完成报名、借用与投稿所必需的信息；联系方式不会在公开页面展示。' }),
      h('span', { class: 'spacer' }),
      h('p', { class: 't-caption t-faint', text: '数据由校内 SeaTable 承载，接口调用均在服务端完成。' }),
    ),
  );

  const node = h('div', { class: 'portal' }, header, outlet, footer);

  // Header elevation only appears once content is scrolled beneath it.
  const onScroll = () => {
    if (window.scrollY > 12) header.dataset.stuck = 'true';
    else delete header.dataset.stuck;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  registerCommands(() => [
    ...NAV.map((item) => ({
      id: `portal:${item.path}`,
      title: item.label,
      subtitle: item.description,
      group: '前往',
      iconName: item.iconName,
      keywords: [item.path.slice(1)],
      run: () => navigate(item.path),
    })),
    { id: 'portal:/', title: '返回首页', group: '前往', iconName: 'door', run: () => navigate('/') },
    {
      id: 'portal:console',
      title: getSessionState().authenticated ? '进入运营管理端' : '登录运营管理端',
      subtitle: '物资、活动、志愿服务与内容审核的内部工作区',
      group: '管理',
      iconName: 'lock',
      run: () => navigate('/console/overview'),
    },
  ]);

  const markActive = (pathname) => {
    for (const link of qsa('.pnav__link', nav)) {
      const href = link.getAttribute('href');
      const active = href === pathname || (href !== '/' && pathname.startsWith(href));
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  };

  return {
    node,
    scroller: () => window,
    beginNavigation(context) {
      delete nav.dataset.open;
      markActive(context.path);
    },
    async showPage(result) {
      await swapView(outlet, result.node);
    },
    endNavigation() {},
  };
}
