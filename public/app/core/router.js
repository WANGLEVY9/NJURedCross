/* ==========================================================================
   router.js — History API router with typed params, guards and view swapping.
   Link handling is delegated globally so page code never wires navigation.
   ========================================================================== */

const routes = [];
let notFound = null;
let outlet = null;
let renderer = null;
let current = null;
let pendingToken = 0;

function compile(pattern) {
  const keys = [];
  const source = pattern
    .replace(/\/+$/, '')
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '/([^/]+)';
      }
      if (segment === '*') {
        keys.push('rest');
        return '/(.*)';
      }
      return segment ? `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` : '';
    })
    .join('');
  return { regex: new RegExp(`^${source || '/'}/?$`, 'i'), keys };
}

export function defineRoutes(definitions) {
  for (const definition of definitions) {
    routes.push({ ...definition, ...compile(definition.path) });
  }
}

export function setNotFound(handler) {
  notFound = handler;
}

export function mountRouter({ target, render }) {
  outlet = target;
  renderer = render;
  document.addEventListener('click', onDocumentClick);
  window.addEventListener('popstate', () => resolve(location.pathname + location.search, { replace: true, popped: true }));
  return resolve(location.pathname + location.search, { replace: true });
}

function onDocumentClick(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!anchor) return;
  const href = anchor.getAttribute('href') || '';
  if (anchor.target === '_blank' || anchor.hasAttribute('download') || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#')) return;
  if (anchor.dataset.native === 'true') return;
  event.preventDefault();
  navigate(href, { origin: anchor });
}

export function matchRoute(pathname) {
  for (const route of routes) {
    const match = route.regex.exec(pathname.replace(/\/+$/, '') || '/');
    if (!match) continue;
    const params = {};
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1] || '');
    });
    return { route, params };
  }
  return null;
}

export function getCurrent() {
  return current;
}

export async function navigate(to, { replace = false, origin = null, state = null } = {}) {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) {
    location.href = url.href;
    return;
  }
  const target = url.pathname + url.search;
  if (!replace && target === location.pathname + location.search) {
    await resolve(target, { replace: true, origin, state });
    return;
  }
  if (replace) history.replaceState(state, '', target);
  else history.pushState(state, '', target);
  await resolve(target, { origin, state });
}

export function redirect(to) {
  return navigate(to, { replace: true });
}

async function resolve(target, { replace = false, origin = null, popped = false, state = null } = {}) {
  const url = new URL(target, location.origin);
  const matched = matchRoute(url.pathname);
  const token = ++pendingToken;

  const context = {
    path: url.pathname,
    query: url.searchParams,
    params: matched?.params || {},
    route: matched?.route || null,
    origin,
    popped,
    state: state || history.state,
    replace,
  };

  if (!matched) {
    if (notFound) await renderer({ context, handler: notFound, outlet, token: () => token === pendingToken });
    return;
  }

  if (matched.route.guard) {
    const verdict = await matched.route.guard(context);
    if (typeof verdict === 'string') {
      await navigate(verdict, { replace: true });
      return;
    }
    if (verdict === false) return;
  }

  current = context;
  await renderer({ context, handler: matched.route.handler, outlet, token: () => token === pendingToken });
}

export function refreshCurrent() {
  return resolve(location.pathname + location.search, { replace: true });
}

export function buildPath(path, query = {}) {
  const url = new URL(path, location.origin);
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  return url.pathname + (url.search || '');
}

/** Updates the query string without re-rendering the whole view. */
export function patchQuery(query) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  history.replaceState(history.state, '', url.pathname + (url.search || ''));
  if (current) current.query = url.searchParams;
}
