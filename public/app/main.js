/* ==========================================================================
   main.js — bootstrap.
   Two surfaces share one codebase:
     · Public service portal  (/, /events, /submit, /warmth, /status …)
     · Operations console     (/console/**, session protected)
   ========================================================================== */

import { defineRoutes, mountRouter, setNotFound, navigate, redirect } from './core/router.js';
import { refreshSession, getSessionState, hasConsoleAccess, hasPermission, onSessionChange, request, publicApi } from './core/api.js';
import { parallax } from './core/motion.js';
import { bindKey } from './core/keys.js';
import { openPalette, clearCommands } from './ui/palette.js';
import { applyTheme } from './core/themes.js';
import { prefs } from './core/store.js';
import { h } from './core/dom.js';
import { errorState } from './ui/primitives.js';
import { notify } from './core/toast.js';

const root = document.getElementById('root');

/* --------------------------------------------------------------------------
   Surface management — tokens, density and shell lifecycle
   -------------------------------------------------------------------------- */
const shells = { portal: null, console: null };
let activeSurface = null;

function applySurface(surface) {
  document.documentElement.dataset.surface = surface;
  document.documentElement.dataset.density = surface === 'console' ? prefs.get('density', 'comfortable') : 'comfortable';
  applyTheme(surface);
}

async function ensureShell(surface) {
  if (activeSurface === surface && shells[surface]) return shells[surface];

  clearCommands();
  applySurface(surface);

  if (!shells[surface]) {
    const module = surface === 'console' ? await import('./console/shell.js') : await import('./portal/shell.js');
    shells[surface] = module.createShell();
  }
  activeSurface = surface;
  root.removeAttribute('data-booting');
  root.replaceChildren(shells[surface].node);
  return shells[surface];
}

/* --------------------------------------------------------------------------
   Route table
   -------------------------------------------------------------------------- */
const portalPage = (loader) => ({ surface: 'portal', load: loader });
const consolePage = (loader) => ({ surface: 'console', load: loader });

/** Resolves the session, refreshing once when the cached view is stale. */
async function ensureSession() {
  if (getSessionState().authenticated) return getSessionState();
  const payload = await refreshSession().catch(() => null);
  return payload?.authenticated ? getSessionState() : null;
}

/**
 * Console routes belong to platform administrators. A member who wanders in is
 * sent to their own surface rather than to a login form they already passed.
 */
async function requireConsoleSession() {
  const session = await ensureSession();
  if (!session) return `/console/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  return hasConsoleAccess() ? true : '/me';
}

function requireConsoleScope(scope) {
  return async () => {
    const verdict = await requireConsoleSession();
    if (verdict !== true) return verdict;
    return hasPermission(scope) ? true : `/console/overview?forbidden=${encodeURIComponent(scope)}`;
  };
}

/** Portal routes that need an account, currently the personal centre. */
async function requirePortalSession() {
  const session = await ensureSession();
  if (!session) return `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  return true;
}

/** Both sign-in screens bounce an already signed-in visitor to their surface. */
async function redirectIfSignedIn() {
  const session = await ensureSession();
  if (!session) return true;
  return hasConsoleAccess() ? '/console/overview' : '/me';
}

defineRoutes([
  { path: '/', handler: portalPage(() => import('./portal/pages/home.js')) },
  { path: '/workflow-events', handler: portalPage(() => import('./portal/pages/workflow-events.js')) },
  { path: '/events', handler: portalPage(() => import('./portal/pages/events.js')) },
  { path: '/events/:eventId', handler: portalPage(() => import('./portal/pages/event-detail.js')) },
  { path: '/materials', handler: portalPage(() => import('./portal/pages/materials.js')) },
  { path: '/outreach', handler: portalPage(() => import('./portal/pages/outreach.js')) },
  { path: '/morning', handler: portalPage(() => import('./portal/pages/morning.js')) },
  { path: '/morning/plaza', handler: portalPage(() => import('./portal/pages/morning-plaza.js')) },
  { path: '/morning/plaza/:cardId', handler: portalPage(() => import('./portal/pages/morning-card-detail.js')) },
  { path: '/morning/comments', handler: portalPage(() => import('./portal/pages/morning-received-comments.js')) },
  { path: '/console/community/morning', handler: consolePage(() => import('./console/pages/morning.js')), guard: requireConsoleScope('community') },
  { path: '/console/community/birthday', handler: consolePage(() => import('./console/pages/community.js')), guard: requireConsoleScope('community') },
  { path: '/community', handler: portalPage(() => import('./portal/pages/warmth.js')) },
  { path: '/submit', handler: portalPage(() => import('./portal/pages/submit.js')) },
  { path: '/warmth', handler: portalPage(() => import('./portal/pages/warmth.js')) },
  { path: '/status', handler: portalPage(() => import('./portal/pages/status.js')) },
  { path: '/about', handler: portalPage(() => import('./portal/pages/about.js')) },
  { path: '/login', handler: portalPage(() => import('./portal/pages/login.js')), guard: redirectIfSignedIn },
  { path: '/register', handler: portalPage(() => import('./portal/pages/register.js')), guard: redirectIfSignedIn },
  { path: '/verify-email', handler: portalPage(() => import('./portal/pages/verify-email.js')) },
  { path: '/reset-password', handler: portalPage(() => import('./portal/pages/reset-password.js')) },
  { path: '/me', handler: portalPage(() => import('./portal/pages/me.js')), guard: requirePortalSession },
  { path: '/change-password', handler: portalPage(() => import('./portal/pages/change-password.js')), guard: requirePortalSession },

  { path: '/console/login', handler: consolePage(() => import('./console/pages/login.js')), guard: redirectIfSignedIn },
  { path: '/console', guard: () => '/console/overview', handler: consolePage(() => import('./console/pages/overview.js')) },
  { path: '/admin', guard: () => '/console/overview', handler: consolePage(() => import('./console/pages/overview.js')) },
  { path: '/console/admin', handler: consolePage(() => import('./console/pages/admin.js')), guard: requireConsoleSession },
  { path: '/console/quotes', handler: consolePage(() => import('./console/pages/quotes.js')), guard: requireConsoleScope('community') },
  { path: '/console/overview', handler: consolePage(() => import('./console/pages/overview.js')), guard: requireConsoleSession },
  { path: '/console/materials', handler: consolePage(() => import('./console/pages/materials.js')), guard: requireConsoleScope('materials') },
  { path: '/console/workflow', handler: consolePage(() => import('./console/pages/activity-center.js')), guard: requireConsoleScope('events') },
  { path: '/console/events', handler: consolePage(() => import('./console/pages/activity-center.js')), guard: requireConsoleScope('events') },
  { path: '/console/volunteers', handler: consolePage(() => import('./console/pages/volunteers.js')), guard: requireConsoleScope('events') },
  { path: '/console/outreach', handler: consolePage(() => import('./console/pages/outreach.js')), guard: requireConsoleScope('outreach') },
  { path: '/console/community', handler: consolePage(() => import('./console/pages/community.js')), guard: requireConsoleScope('community') },
  { path: '/console/data', handler: consolePage(() => import('./console/pages/data.js')), guard: requireConsoleScope('data') },
  { path: '/console/settings', handler: consolePage(() => import('./console/pages/admin.js')), guard: () => '/console/admin?view=status' },
]);

setNotFound({
  surface: 'portal',
  load: async () => ({
    default: async () => ({
      title: '页面不存在',
      node: h(
        'div',
        { class: 'formpage' },
        errorState({
          title: '找不到这个页面',
          error: { message: '请求的地址不存在或已经调整。', status: 404, path: location.pathname },
          hint: '可以回到首页，或使用导航中的活动、投稿与查询入口。',
          onRetry: () => navigate('/'),
        }),
      ),
    }),
  }),
});

/* --------------------------------------------------------------------------
   Render pipeline
   -------------------------------------------------------------------------- */
let currentDispose = null;

async function renderer({ context, handler, token }) {
  const shell = await ensureShell(handler.surface);
  if (!token()) return;

  shell.beginNavigation(context);

  let page;
  try {
    const module = await handler.load();
    page = module.default;
  } catch (error) {
    shell.endNavigation(context);
    console.error(`Failed to load the module for "${context.path}"`, error);
    notify.error('页面加载失败', '请检查网络连接后重试。');
    return;
  }
  if (!token()) return;

  // Progressive loading: the page returns its structure immediately and fills
  // data in afterwards, so the user never stares at a blank frame.
  let result;
  try {
    result = await page(context, shell);
  } catch (error) {
    // Surface genuine programming errors instead of silently degrading to a
    // generic error state; the user still gets a recoverable screen.
    console.error(`Page "${context.path}" failed to render`, error);
    result = {
      title: '加载失败',
      node: h('div', { class: handler.surface === 'console' ? 'wspad' : 'formpage' }, errorState({ title: '这个页面无法加载', error, onRetry: () => location.reload() })),
    };
  }
  if (!token()) return;

  currentDispose?.();
  currentDispose = typeof result?.dispose === 'function' ? result.dispose : null;

  await shell.showPage(result, context);
  if (!token()) return;
  shell.endNavigation(context, result);

  const main = document.getElementById('main');
  if (document.activeElement === document.body && main) {
    main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: true });
  }

  document.title = result?.title ? `${result.title} · 南京大学红十字会` : '南京大学红十字会';
  if (!context.popped) {
    const scroller = shell.scroller?.() || window;
    if (scroller === window) window.scrollTo({ top: 0, behavior: 'instant' });
    else scroller.scrollTo({ top: 0, behavior: 'instant' });
  }
}

/* --------------------------------------------------------------------------
   Ambient layer + global shortcuts
   -------------------------------------------------------------------------- */
function installAmbient() {
  const mesh = document.querySelector('.ambient__mesh');
  if (mesh && window.matchMedia('(hover: hover) and (pointer: fine)').matches) parallax(mesh, [{ x: '--mesh-dx', y: '--mesh-dy', depth: 38, target: mesh },{x:'--brand-dx',y:'--brand-dy',depth:18,target:document.querySelector('.ambient__brand')||mesh}]);
}

/**
 * Segmented controls position a sliding thumb from measured geometry, so they
 * must be re-measured whenever the viewport or the layout changes.
 */
function installResizeHandling() {
  let frame = 0;
  const reposition = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      for (const node of document.querySelectorAll('.segmented')) {
        if (typeof node.reposition === 'function') node.reposition();
      }
    });
  };
  window.addEventListener('resize', reposition, { passive: true });
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(reposition);
    observer.observe(document.body);
  }
}

function installGlobalKeys() {
  bindKey('mod+k', () => openPalette(), { label: '打开命令面板', group: '通用', allowInInput: true });
  bindKey('/', () => openPalette(), { label: '搜索', group: '通用' });
  bindKey('mod+shift+d', () => {
    if (activeSurface !== 'console') return;
    const next = prefs.get('density', 'comfortable') === 'compact' ? 'comfortable' : 'compact';
    prefs.set('density', next);
    document.documentElement.dataset.density = next;
    notify.info('已切换信息密度', next === 'compact' ? '紧凑模式：适合大批量数据核对。' : '标准模式：适合日常操作。');
  }, { label: '切换信息密度', group: '工作区' });
}

let sessionWasAuthenticated = getSessionState().authenticated;
onSessionChange((session) => {
  const expired = sessionWasAuthenticated && !session.authenticated;
  sessionWasAuthenticated = session.authenticated;
  if (!expired) return;
  if (location.pathname.startsWith('/console') && location.pathname !== '/console/login') {
    notify.warning('登录会话已结束', '请重新登录后继续操作。');
    redirect(`/console/login?next=${encodeURIComponent(location.pathname)}`);
    return;
  }
  if (location.pathname === '/me') {
    notify.warning('登录会话已结束', '请重新登录后查看个人记录。');
    redirect(`/login?next=${encodeURIComponent(location.pathname)}`);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.name === 'AbortError') return;
  console.error('Unhandled rejection', event.reason);
});

/* --------------------------------------------------------------------------
   Go
   -------------------------------------------------------------------------- */
(async () => {
  applySurface(location.pathname.startsWith('/console') || location.pathname.startsWith('/admin') ? 'console' : 'portal');
  installAmbient();
  installResizeHandling();
  installGlobalKeys();
  // Start public data alongside the session and dynamic page-module graph.
  // Only anonymous projections are prefetched; protected records remain gated.
  const path=location.pathname;
  if(path==='/'||path==='/events')void publicApi.events().catch(()=>{});
  if(path==='/')void publicApi.overview().catch(()=>{});
  if(path==='/workflow-events')void request('/api/public/workflow/events').catch(()=>{});
  if(['/community','/warmth','/me'].includes(path))void request('/api/public/warmth/capabilities').catch(()=>{});
  await refreshSession().catch(() => null);
  await mountRouter({ target: root, render: renderer });
})();
