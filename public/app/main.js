/* ==========================================================================
   main.js — bootstrap.
   Two surfaces share one codebase:
     · Public service portal  (/, /events, /submit, /warmth, /status …)
     · Operations console     (/console/**, session protected)
   ========================================================================== */

import { defineRoutes, mountRouter, setNotFound, navigate, redirect } from './core/router.js';
import { refreshSession, getSessionState, onSessionChange } from './core/api.js';
import { parallax, prefersReducedMotion } from './core/motion.js';
import { bindKey } from './core/keys.js';
import { openPalette, clearCommands } from './ui/palette.js';
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface === 'console' ? '#0b0c0e' : '#14100f');
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

async function requireSession() {
  if (getSessionState().authenticated) return true;
  const payload = await refreshSession().catch(() => null);
  if (payload?.authenticated) return true;
  const next = encodeURIComponent(location.pathname + location.search);
  return `/console/login?next=${next}`;
}

async function rejectIfSignedIn() {
  if (getSessionState().authenticated) return '/console/overview';
  const payload = await refreshSession().catch(() => null);
  return payload?.authenticated ? '/console/overview' : true;
}

defineRoutes([
  { path: '/', handler: portalPage(() => import('./portal/pages/home.js')) },
  { path: '/events', handler: portalPage(() => import('./portal/pages/events.js')) },
  { path: '/events/:eventId', handler: portalPage(() => import('./portal/pages/event-detail.js')) },
  { path: '/materials', handler: portalPage(() => import('./portal/pages/materials.js')) },
  { path: '/submit', handler: portalPage(() => import('./portal/pages/submit.js')) },
  { path: '/warmth', handler: portalPage(() => import('./portal/pages/warmth.js')) },
  { path: '/status', handler: portalPage(() => import('./portal/pages/status.js')) },
  { path: '/about', handler: portalPage(() => import('./portal/pages/about.js')) },

  { path: '/console/login', handler: consolePage(() => import('./console/pages/login.js')), guard: rejectIfSignedIn },
  { path: '/console', guard: () => '/console/overview', handler: consolePage(() => import('./console/pages/overview.js')) },
  { path: '/admin', guard: () => '/console/overview', handler: consolePage(() => import('./console/pages/overview.js')) },
  { path: '/console/overview', handler: consolePage(() => import('./console/pages/overview.js')), guard: requireSession },
  { path: '/console/materials', handler: consolePage(() => import('./console/pages/materials.js')), guard: requireSession },
  { path: '/console/events', handler: consolePage(() => import('./console/pages/events.js')), guard: requireSession },
  { path: '/console/volunteers', handler: consolePage(() => import('./console/pages/volunteers.js')), guard: requireSession },
  { path: '/console/outreach', handler: consolePage(() => import('./console/pages/outreach.js')), guard: requireSession },
  { path: '/console/community', handler: consolePage(() => import('./console/pages/community.js')), guard: requireSession },
  { path: '/console/data', handler: consolePage(() => import('./console/pages/data.js')), guard: requireSession },
  { path: '/console/settings', handler: consolePage(() => import('./console/pages/settings.js')), guard: requireSession },
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
  shell.endNavigation(context, result);

  document.title = result?.title ? `${result.title} · 南京大学红十字会` : '南京大学红十字会';
  if (!context.popped) {
    const scroller = shell.scroller?.() || window;
    if (scroller === window) window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    else scroller.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
}

/* --------------------------------------------------------------------------
   Ambient layer + global shortcuts
   -------------------------------------------------------------------------- */
function installAmbient() {
  const mesh = document.querySelector('.ambient__mesh');
  if (mesh) parallax(mesh, [{ x: '--mesh-dx', y: '--mesh-dy', depth: 18, target: mesh }]);
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

onSessionChange((session) => {
  if (!session.authenticated && location.pathname.startsWith('/console') && location.pathname !== '/console/login') {
    notify.warning('登录会话已结束', '为保护数据，请重新登录后继续操作。');
    redirect(`/console/login?next=${encodeURIComponent(location.pathname)}`);
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
  await refreshSession().catch(() => null);
  await mountRouter({ target: root, render: renderer });
})();
