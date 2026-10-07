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
import { getSessionState, onSessionChange, portal, publicApi } from '../core/api.js';
import { openModal } from '../ui/overlay.js';
import { renderBlessingLetter } from './blessing-letter.js';

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
    ...NAV.map((item) => h('a', { class: 'pnav__link', href: item.path },
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
        h('span', { class: 'brand-mark' }),
        h('span', { class: 'plogo__text' }, h('b', { text: '南京大学红十字会' }), h('span', { text: 'NJU Red Cross' })),
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
        ...NAV.slice(0, 4).map((item) => h('a', { href: item.path, text: item.label })),
      ),
      h(
        'div',
        { class: 'pfoot__col' },
        h('p', { class: 't-label', text: '了解' }),

        h('a', { href: '/about', text: '关于平台' }),
        h('a', { href: '/status', text: '查询我的记录' }),
      ),
      h(
        'div',
        { class: 'pfoot__col' },
        h('p', { class: 't-label', text: '管理' }),
        h('a', { href: '/console/login', text: '运营管理端' }),
        h('a', { href: '/me', text: '会员中心' }),
      ),
    ),
    h(
      'div',
      { class: 'pfoot__bar' },
      h('p', { class: 't-caption', text: '南京大学红十字会' }),
      h('span', { class: 'spacer' }),
      h('p', { class: 't-caption t-faint', text: '人道 · 博爱 · 奉献' }),
    ),
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
    for (const link of [...qsa('.pnav__link', nav), ...qsa('.mobile-dock__item', dock)]) {
      const href = link.getAttribute('href');
      const active = href === portalSection(pathname) || href === pathname;
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  };

  let birthdayPopupChecked = false;
  function openBirthdayBlessingPopup(items, realName = '') {
    let modal;
    // 用真实姓名称呼本人（没有真实姓名时回退为通用标题）
    modal = openModal({
      title: `${realName ? `${realName}，` : ''}生日快乐！`,
      width: 680,
      body: [
        h('p', { class: 't-secondary', text: `今天是你的生日，平台为你送达了 ${items.length} 条祝福。` }),
        ...items.map((item) => renderBlessingLetter({ content: item.content, nickname: item.nickname, submittedAt: item.deliveredAt, seal: '生日祝福' })),
      ],
      footer: [h('span', { class: 'spacer' }), button({ label: '收下祝福', variant: 'primary', onClick: () => modal.close() })],
    });
  }
  /** 生日当天打开网站时：若本人今天有已送达的祝福，弹窗展示一次（同一天同浏览器只弹一次）。 */
  async function maybeShowBirthdayPopup() {
    if (birthdayPopupChecked) return;
    birthdayPopupChecked = true;
    try {
      if (!getSessionState().authenticated) return;
      const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const monthDay = `${parts.find((p) => p.type === 'month').value}-${parts.find((p) => p.type === 'day').value}`;
      const me = await portal.me();
      const birthday = (me.enrollments || []).find((item) => item.program === 'birthday' && item.status === '已确认' && item.birthdayMonthDay === monthDay);
      if (!birthday) return;
      const storeKey = `warmth-birthday-popup:${monthDay}`;
      try { if (sessionStorage.getItem(storeKey)) return; } catch { /* 隐私模式等，忽略 */ }
      const payload = await publicApi.deliveredWarmthBlessings();
      const items = payload.blessings || [];
      if (!items.length) return;
      try { sessionStorage.setItem(storeKey, '1'); } catch { /* 忽略 */ }
      // 姓名由服务端从个人资料自动解析（recipientName），前端不采集、不猜测
      openBirthdayBlessingPopup(items, String(payload.recipientName || '').trim());
    } catch { /* 生日弹窗失败不得影响页面 */ }
  }

  return {
    node,
    scroller: () => window,
    beginNavigation(context) {
      setMenu(false);
      markActive(context.path);
    },
    async showPage(result) {
      await swapView(outlet, result.node);
      void maybeShowBirthdayPopup();
    },
    endNavigation() {},
  };
}
