/* ==========================================================================
   main.js — bootstrap.
   Two surfaces share one codebase:
     · Public service portal  (/, /events, /submit, /warmth, /status …)
     · Operations console     (/console/**, session protected)
   ========================================================================== */

import { defineRoutes, mountRouter, setNotFound, navigate, redirect } from './core/router.js';
import { refreshSession, getSessionState, hasConsoleAccess, hasPermission, onSessionChange, request, publicApi } from './core/api.js';
import { bindKey } from './core/keys.js';
import { openPalette, clearCommands } from './ui/palette.js';
import { applyTheme } from './core/themes.js';
import { prefs } from './core/store.js';
import { h } from './core/dom.js';
import { errorState } from './ui/primitives.js';
import { notify } from './core/toast.js';
import { developingPlaza } from './portal/development-access.js';
import { reimbursementsEnabled } from './shared/reimbursement-access.js';

const root = document.getElementById('root');

/* --------------------------------------------------------------------------
   Surface management — tokens, density and shell lifecycle
   -------------------------------------------------------------------------- */
const shells = { portal: null, console: null };
const shellModules = { portal: null, console: null };
let activeSurface = null;

function loadShellModule(surface) {
  shellModules[surface] ||= surface === 'console' ? import('./console/shell.js') : import('./portal/shell.js');
  return shellModules[surface];
}

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
    const [module] = await Promise.all([loadShellModule(surface), window.njurcBoot?.stylesReady(surface)]);
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

// Advanced return/intake stays local. Finance additionally requires its server capability.
const materialsPortal = () => import('./portal/pages/materials-preview.js');
const materialsConsole = () => getSessionState().user?.localPreview === true
  ? import('./console/pages/materials-preview.js') : import('./console/pages/materials.js');
const localMaterialsOnly = (loader) => () => getSessionState().user?.localPreview === true
  ? loader() : import('./shared/materials-unavailable.js');
const financeOnly = loader => () => reimbursementsEnabled() ? loader() : import('./shared/materials-unavailable.js');

let sessionResolution = null;
async function ensureSession() {
  if (!getSessionState().authenticated) {
    sessionResolution ||= refreshSession().catch(() => null);
    await sessionResolution;
  }
  const session = getSessionState();
  return session.authenticated ? session : null;
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
async function requireFinanceConsole() {
  const session = await ensureSession();
  if (!session) return `/console/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  const user = getSessionState().user;
  if (user?.localPreview === true) return requireConsoleScope('materials')();
  return user?.financePermissions?.length ? true : '/console/overview?forbidden=finance';
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
  { path: '/materials', handler: portalPage(materialsPortal) },
  { path: '/materials/borrow', handler: portalPage(() => import('./portal/pages/materials-borrow.js')) },
  { path: '/materials/return', handler: portalPage(localMaterialsOnly(() => import('./portal/pages/materials-return.js'))) },
  { path: '/materials/reimburse', handler: portalPage(financeOnly(() => import('./portal/pages/materials-reimburse.js'))), guard: requirePortalSession },
  { path: '/materials/rooms', handler: portalPage(localMaterialsOnly(() => import('./portal/pages/materials-rooms.js'))) },
  { path: '/materials/inbound', guard: () => '/materials/return', handler: portalPage(localMaterialsOnly(() => import('./portal/pages/materials-return.js'))) },
  { path: '/outreach', handler: portalPage(() => import('./portal/pages/outreach.js')) },
  { path: '/morning', handler: portalPage(() => import('./portal/pages/morning.js')) },
  { path: '/morning/plaza', handler: portalPage(() => import('./portal/pages/morning-plaza.js')) },
  { path: '/morning/plaza/:cardId', handler: portalPage(() => import('./portal/pages/morning-card-detail.js')) },
  { path: '/morning/comments', handler: portalPage(() => import('./portal/pages/morning-received-comments.js')) },
  { path: '/console/community/morning', handler: consolePage(() => import('./console/pages/morning.js')), guard: requireConsoleScope('community') },
  { path: '/console/community/birthday', handler: consolePage(() => import('./console/pages/community.js')), guard: requireConsoleScope('community') },
  { path: '/community', handler: portalPage(() => import('./portal/pages/warmth.js')) },
  { path: '/reimbursements', handler: portalPage(financeOnly(() => import('./portal/pages/reimbursements.js'))), guard: requirePortalSession },
  { path: '/submit', handler: portalPage(() => import('./portal/pages/submit.js')) },
  { path: '/photos', handler: portalPage(() => import('./portal/pages/photos.js')) },
  { path: '/tasks', handler: portalPage(() => import('./portal/pages/task-claim.js')) },
  { path: '/showcase', handler: portalPage(() => import('./portal/pages/showcase.js')) },
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
  { path: '/console/agent', handler: consolePage(() => import('./console/pages/agent.js')), guard: requireConsoleSession },
  { path: '/console/messages', handler: consolePage(() => import('./console/pages/messages.js')), guard: requireConsoleScope('community') },
  { path: '/console/overview', handler: consolePage(() => import('./console/pages/overview.js')), guard: requireConsoleSession },
  { path: '/console/materials', handler: consolePage(materialsConsole), guard: requireConsoleScope('materials') },
  { path: '/console/materials/returns', handler: consolePage(localMaterialsOnly(() => import('./console/pages/materials-return-review.js'))), guard: requireConsoleScope('materials') },
  { path: '/console/materials/rooms', handler: consolePage(localMaterialsOnly(() => import('./console/pages/materials-rooms.js'))), guard: requireConsoleScope('materials') },
  { path: '/console/reimbursements', handler: consolePage(financeOnly(() => import('./console/pages/reimbursements.js'))), guard: requireFinanceConsole },
  { path: '/console/reimbursements/summary', handler: consolePage(financeOnly(() => import('./console/pages/reimbursement-summary.js'))), guard: requireFinanceConsole },
  { path: '/console/reimbursements/ledger', handler: consolePage(financeOnly(() => import('./console/pages/reimbursement-ledger.js'))), guard: requireFinanceConsole },
  { path: '/console/materials/intake', handler: consolePage(localMaterialsOnly(() => import('./console/pages/materials-intake.js'))), guard: requireConsoleScope('materials') },
  { path: '/console/materials/inbound', handler: consolePage(localMaterialsOnly(() => import('./console/pages/materials-inbound-review.js'))), guard: requireConsoleScope('materials') },
  { path: '/console/workflow', handler: consolePage(() => import('./console/pages/activity-management-entry.js')), guard: requireConsoleSession },
  { path: '/console/events', handler: consolePage(() => import('./console/pages/activity-management-entry.js')), guard: requireConsoleSession },
  { path: '/console/volunteers', handler: consolePage(() => import('./console/pages/volunteers.js')), guard: requireConsoleScope('events') },
  { path: '/console/outreach', handler: consolePage(() => import('./console/pages/outreach.js')), guard: requireConsoleScope('outreach') },
  { path: '/console/showcase', handler: consolePage(() => import('./console/pages/showcase.js')), guard: requireConsoleScope('outreach') },
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

const publicFirstPaint = path => ['/', '/events', '/about', '/status', '/showcase'].includes(path) || path.startsWith('/events/');

async function renderer({ context, handler, token }) {
  const developing = handler.surface === 'portal' && developingPlaza(context.path);
  if (developing || !publicFirstPaint(context.path)) {
    window.njurcBoot?.phase('正在确认登录状态…');
    await ensureSession();
  }
  if (!token()) return;
  window.njurcBoot?.phase('正在准备页面…');
  let shell, page;
  try {
    const loadPage = developing && !hasConsoleAccess() && getSessionState().user?.localPreview !== true
      ? () => import('./portal/pages/development-gate.js') : handler.load;
    const pageModule = loadPage().then(module => ({ module }), error => ({ error }));
    shell = await ensureShell(handler.surface);
    if (!token()) return;
    shell.beginNavigation(context);
    const loaded = await pageModule;
    if (loaded.error) throw loaded.error;
    page = loaded.module.default;
  } catch (error) {
    if (!token()) return;
    console.error(`Failed to load the module for "${context.path}"`, error);
    shell ||= shells[handler.surface];
    if (shell) {
      await shell.showPage({title:'加载失败',node:errorState({title:'页面资源加载失败',error,onRetry:()=>location.reload()})}, context);
      shell.endNavigation(context);
      window.njurcBoot?.complete();
    } else window.njurcBoot?.fail('页面资源未能加载，请检查网络后重试。');
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
  window.njurcBoot?.complete();
  performance.mark('nju:page-ready');

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
  if (developingPlaza(location.pathname)) {
    redirect(location.pathname + location.search);
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
  installResizeHandling();
  installGlobalKeys();
  // Start public data alongside the session and dynamic page-module graph.
  // Only anonymous projections are prefetched; protected records remain gated.
  const path=location.pathname;
  if(path==='/'||path==='/events')void publicApi.events().catch(()=>{});
  if(path==='/')void publicApi.overview().catch(()=>{});
  if(path==='/workflow-events')void request('/api/public/workflow/events').catch(()=>{});
  if(path==='/me')void request('/api/public/warmth/capabilities').catch(()=>{});
  void ensureSession();
  void loadShellModule(document.documentElement.dataset.surface).catch(() => {});
  await mountRouter({ target: root, render: renderer });
})().catch(error => {
  console.error('Application bootstrap failed', error);
  window.njurcBoot?.fail('页面初始化未完成，请检查网络后重试。');
});
