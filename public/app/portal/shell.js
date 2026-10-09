import { PORTAL_NAV, portalSection } from './navigation.js';
import { themeButton } from '../ui/theme-picker.js';
/* ==========================================================================
   portal/shell.js — the public service shell.
   Kept intentionally light: one primary action per screen, navigation that
   mirrors what people actually come here to do.
   ========================================================================== */

import { h, icon, qsa, clear } from '../core/dom.js';
import { swapView } from '../core/motion.js';
import { navigate } from '../core/router.js';
import { registerCommands } from '../ui/palette.js';
import { button } from '../ui/primitives.js';
import { getSessionState, onSessionChange } from '../core/api.js';

const NAV = PORTAL_NAV;

export function createShell() {
  const outlet = h('main', { class: 'portal__outlet', id: 'main', attrs: { role: 'main' } });

  const dock = h('nav', { class: 'mobile-dock', aria: { label: '广场导航' } },
    ...NAV.map((item) => h('a', { class: 'mobile-dock__item', href: item.path },
      icon(item.iconName, 'ico'), h('span', { text: item.label }))));

  const mobileUtility = h('a', { class: 'pnav__link pnav__utility' });
  const nav = h(
    'nav',
    { class: 'pnav', id: 'portal-navigation', attrs: { 'aria-label': '主导航' } },
    ...[{ path: '/', label: '主页', iconName: 'door' }, ...NAV].map((item) => h('a', { class: 'pnav__link', href: item.path },
      icon(item.iconName, 'ico ico--sm pnav__icon'), h('span', { text: item.label }))),
    mobileUtility,
  );

  function setMenu(open, restoreFocus = false) {
    if (open) nav.dataset.open = 'true';
    else delete nav.dataset.open;
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? '收起导航' : '展开导航');
    menuButton.replaceChildren(icon(open ? 'close' : 'menu', 'ico ico--sm'));
    if (restoreFocus) menuButton.focus();
  }
  const menuButton = h('button', {
    class: 'icon-btn pmenu-btn', type: 'button',
    aria: { label: '展开导航', expanded: 'false', controls: 'portal-navigation' },
    on: { click: () => setMenu(nav.dataset.open !== 'true') },
  }, icon('menu', 'ico ico--sm'));

  // Auth affordances mirror the session: signed-out visitors get a single way
  // in, signed-in visitors get their own surface and (for administrators) the
  // console. The console link is never shown to a plain member, because the
  // console would refuse them anyway.
  const authSlot = h('span', { class: 'row-2 phead__auth' });
  function renderAuth() {
    const session = getSessionState();
    clear(authSlot);
    mobileUtility.hidden = session.authenticated && !session.user?.consoleAccess;
    mobileUtility.href = session.user?.consoleAccess ? '/console/overview' : '/console/login';
    mobileUtility.replaceChildren(icon('lock', 'ico ico--sm pnav__icon'),
      h('span', { text: session.user?.consoleAccess ? '管理平台' : '管理端登录' }));
    if (!session.authenticated) {
      authSlot.append(
        button({ label: '管理端', variant: 'ghost', size: 'sm', iconName: 'lock', href: '/console/login', data: { hideSm: 'true' } }),
        button({ label: '登录', variant: 'ghost', size: 'sm', iconName: 'user', href: '/login', data: { account: 'true' } }),
      );
      return;
    }
    if (session.user?.consoleAccess) {
      authSlot.append(button({ label: '管理平台', variant: 'ghost', size: 'sm', iconName: 'lock', href: '/console/overview', data: { hideSm: 'true' } }));
    }

  }

  const header = h(
    'header',
    { class: 'phead' },
    h(
      'div',
      { class: 'phead__inner' },
      h(
        'a',
        { class: 'plogo', href: '/', attrs: { 'aria-label': '南京大学红十字会首页' } },
        h('img', { class: 'brand-emblem', src: '/assets/nju-red-cross-emblem.jpg', alt: '', width: 44, height: 44 }),
        h('span', { class: 'plogo__text' }, h('b', { text: '南京大学红十字会' }), h('span', { class: 'brand-wordmark', text: 'NJURedCross' })),
      ),
      h('span', { class: 'spacer' }),
      menuButton,
      nav,
      authSlot,
      themeButton('portal'),
    ),
  );
  renderAuth();
  onSessionChange(() => renderAuth());

  const footerGroups = [
    { title: '参与公益', links: NAV.filter((item) => ['/events', '/outreach', '/community', '/materials'].includes(item.path)) },
    { title: '个人服务', links: [{ path: '/me', label: '会员中心' }, { path: '/status', label: '按报名编号查询' }] },
    { title: '了解平台', links: [{ path: '/', label: '主页' }, { path: '/about', label: '关于平台' }, { path: '/console/overview', label: '运营管理端' }] },
  ];
  const footer = h(
    'footer',
    { class: 'pfoot' },
    h('div', { class: 'pfoot__inner' },
      h('div', { class: 'pfoot__brand' },
        h('a', { class: 'plogo', href: '/', attrs: { 'aria-label': '南京大学红十字会首页' } },
          h('img', { class: 'brand-emblem', src: '/assets/nju-red-cross-emblem.jpg', alt: '', width: 44, height: 44 }),
          h('span', { class: 'plogo__text' }, h('b', { text: '南京大学红十字会' }), h('span', { class: 'brand-wordmark', text: 'NJURedCross' }))),
        h('p', { class: 'pfoot__motto', text: '让每一次参与，都有回应。' }),
        h('p', { class: 'pfoot__description', text: '从急救培训、无偿献血宣传到校园志愿服务，与我们一起，让关怀成为日常。' })),
      ...footerGroups.map((group) => h('nav', { class: 'pfoot__col', attrs: { 'aria-label': `页脚 · ${group.title}` } },
        h('h2', { class: 't-label', text: group.title }),
        ...group.links.map((item) => h('a', { class: 'pfoot__link', href: item.path },
          h('span', { text: item.label }), h('span', { class: 'pfoot__arrow', text: '↗', attrs: { 'aria-hidden': 'true' } }))))),
    ),
    h('div', { class: 'pfoot__bar' },
      h('p', { class: 't-caption', text: '南京大学红十字会 · 校园公益服务平台' }),
      h('span', { class: 'spacer' }),
      h('p', { class: 't-caption pfoot__values', text: '人道 · 博爱 · 奉献' })),
  );

  const node = h('div', { class: 'portal', on: {
    keydown: (event) => {
      if (event.key === 'Escape' && nav.dataset.open === 'true') {
        event.preventDefault();
        setMenu(false, true);
      }
    },
    pointerdown: (event) => {
      if (nav.dataset.open === 'true' && !header.contains(event.target)) setMenu(false);
    },
    focusout: (event) => {
      if (nav.dataset.open === 'true' && event.relatedTarget && !header.contains(event.relatedTarget)) setMenu(false);
    },
  } }, header, outlet, footer, dock);

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
      id: 'portal:me',
      title: getSessionState().authenticated ? '会员中心' : '登录活动平台',
      subtitle: '我的报名、投稿与温暖连接记录',
      group: '账号',
      iconName: 'user',
      run: () => navigate(getSessionState().authenticated ? '/me' : '/login'),
    },
    {
      id: 'portal:console',
      title: getSessionState().user?.consoleAccess ? '进入运营管理端' : '登录运营管理端',
      subtitle: '物资、活动、志愿服务与内容审核的内部工作区',
      group: '账号',
      iconName: 'lock',
      run: () => navigate(getSessionState().user?.consoleAccess ? '/console/overview' : '/console/login'),
    },
  ]);

  const markActive = (pathname) => {
    for (const link of [...qsa('.pnav__link', nav), ...qsa('.mobile-dock__item', dock), ...qsa('.pfoot__link', footer)]) {
      const href = link.getAttribute('href');
      const active = link.classList.contains('pfoot__link') ? href === pathname : href === portalSection(pathname) || href === pathname;
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  };

  return {
    node,
    scroller: () => window,
    beginNavigation(context) {
      setMenu(false);
      markActive(context.path);
    },
    async showPage(result) {
      await swapView(outlet, result.node);
    },
    endNavigation() {},
  };
}
