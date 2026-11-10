(() => {
  'use strict';

  const styles = new Map();
  const registerStyle = (link) => {
    let settle;
    const ready=new Promise(resolve => { settle = resolve; });
    styles.set(new URL(link.href, window.location.href).pathname, ready);
    for(const path of (link.dataset.bundledStyles||'').split(' ').filter(Boolean))styles.set(new URL(path,window.location.href).pathname,ready);
    const promote = (event) => {
      if (link.dataset.deferredStyle) return;
      const loaded = event?.type !== 'error';
      link.media = 'all';
      link.dataset.deferredStyle = loaded ? 'loaded' : 'error';
      link.removeEventListener('load', promote);
      link.removeEventListener('error', promote);
      settle(loaded);
    };
    link.addEventListener('load', promote);
    link.addEventListener('error', promote);
    // A failed same-origin stylesheet can still expose an empty sheet object.
    // Reading cssRules throws a SecurityError for that inaccessible sheet, so
    // check both immediately and shortly after parse. A pending request has no
    // sheet yet and continues to wait for its normal load/error event.
    const settleFromSheet = () => {
      if (!link.sheet || link.dataset.deferredStyle) return;
      try {
        link.sheet.cssRules;
        promote({ type: 'load' });
      } catch {
        promote({ type: 'error' });
      }
    };
    settleFromSheet();
    window.setTimeout(settleFromSheet, 250);
  };
  document.querySelectorAll('link[data-deferred-style]').forEach(registerStyle);

  // Each surface ships its own stylesheet bundle; the other one is only fetched
  // when the app actually switches surfaces inside the same document.
  const manifest = (() => {
    try { return JSON.parse(document.getElementById('style-manifest')?.textContent || 'null'); }
    catch { return null; }
  })();

  // Route-scoped enhancement bundles are declared by the manifest but omitted
  // from the HTML. Insert only the groups the current route needs; the fallback
  // shell has no manifest and already ships all 22 original stylesheets.
  const routeStyles = Array.isArray(manifest?.portal?.routes) ? manifest.portal.routes : [];
  const emptyRoutes = manifest?.portal?.empty || { exact: [], prefix: [] };
  const matches = (rule, path) => (rule.exact || []).includes(path)
    || (rule.prefix || []).some(prefix => path.startsWith(prefix));
  const requestedRoutes = new Set();
  const routePromises = new Map();
  const routeGroupsFor = (path) => {
    if (path.startsWith('/console') || path.startsWith('/admin')) return [];
    const known = matches(emptyRoutes, path) || routeStyles.some(group => matches(group.match || {}, path));
    // An unrecognised route loads every group: a missing sheet is worse than
    // downloading a few extra bytes.
    return known
      ? routeStyles.filter(group => matches(group.match || {}, path)).map(group => group.key)
      : routeStyles.map(group => group.key);
  };
  const ensureRouteStyles = (path = location.pathname) => {
    if (!routeStyles.length) return Promise.resolve([]);
    const pending = [];
    for (const key of routeGroupsFor(path)) {
      if (requestedRoutes.has(key)) {
        pending.push(routePromises.get(key) || Promise.resolve());
        continue;
      }
      const entry = routeStyles.find(group => group.key === key);
      if (!entry) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${entry.href}?v=${entry.version}`;
      link.media = 'print';
      link.dataset.deferredStyle = '';
      link.dataset.bundledStyles = (entry.styles || []).join(' ');
      document.head.append(link);
      registerStyle(link);
      const ready = styles.get(entry.href) || Promise.resolve();
      requestedRoutes.add(key);
      routePromises.set(key, ready);
      pending.push(ready);
    }
    // Exposed as a promise for callers that want to wait; the render pipeline
    // deliberately does not await it, so page-switch scroll restoration keeps
    // its original timing. A failed sheet still resolves (registerStyle always
    // settles), so a broken route bundle degrades instead of hanging the page.
    return Promise.all(pending).then(() => [...requestedRoutes]);
  };
  // Register before stylesReady() runs, so /events can wait for events-plaza.
  void ensureRouteStyles();

  const requiredStyles = (surface) => ['tokens', 'base', 'components', 'mobile', 'themes', surface === 'console' ? 'admin' : 'portal', ...(location.pathname === '/events' || location.pathname.startsWith('/events/') ? ['events-plaza'] : [])];
  const ensureSurfaceBundle = (surface) => {
    const entry = manifest?.[surface];
    if (!entry) return;
    if (requiredStyles(surface).every(name => styles.has(`/styles/${name}.css`))) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${entry.href}?v=${entry.version}`;
    link.media = 'print';
    link.dataset.bundledStyles = (entry.styles || []).join(' ');
    document.head.append(link);
    registerStyle(link);
  };
  const stylesReady = (surface) => {
    ensureSurfaceBundle(surface);
    // 活动广场的整体排版依赖自己的样式表；其余页面样式仍为可选增强。
    const required = requiredStyles(surface);
    const loaded = Promise.all(required.map((name) => {
      const pending = styles.get(`/styles/${name}.css`);
      if (!pending) return Promise.reject(new Error('页面布局样式缺失，请重新加载。'));
      return pending.then((ok) => {
        if (!ok) throw new Error('页面布局样式未能加载，请检查网络后重试。');
      });
    }));
    let timer;
    const timeout = new Promise((resolve, reject) => {
      // Fail fast instead of pinning the splash for 15s on a slow link.
      timer = window.setTimeout(() => reject(new Error('页面布局样式加载超时，请检查网络后重试。')), 4_000);
    });
    return Promise.race([loaded, timeout]).then(() => undefined).finally(() => window.clearTimeout(timer));
  };

  const root = document.getElementById('root');
  const screen = document.getElementById('boot-screen');
  const status = document.getElementById('boot-status');
  const note = document.getElementById('boot-note');
  const retry = document.getElementById('boot-retry');
  if (!root || !screen || !status || !note || !retry) return;

  let finished = false;
  let failed = false;
  const timers = [];
  const clearTimers = () => timers.forEach((timer) => window.clearTimeout(timer));
  const reload = () => window.location.reload();
  const phase = (text) => {
    if (!finished && !failed && typeof text === 'string' && text.trim()) {
      status.textContent = text;
    }
  };
  const fail = (text) => {
    if (finished) return;
    failed = true;
    clearTimers();
    screen.dataset.state = 'failed';
    screen.setAttribute('aria-busy', 'false');
    status.textContent = typeof text === 'string' && text.trim() ? text : '页面启动未能完成';
    note.textContent = '请检查网络连接，然后重新加载页面。';
    retry.hidden = false;
  };
  const onScriptError = (event) => {
    const target = event.target;
    if (target instanceof HTMLScriptElement && new URL(target.src, window.location.href).pathname === '/app/main.js') {
      fail('页面程序未能加载，请重试');
    }
  };
  const observer = new MutationObserver(() => {
    if (!root.hasAttribute('data-booting')) complete();
  });
  const complete = () => {
    if (finished) return;
    finished = true;
    clearTimers();
    observer.disconnect();
    window.removeEventListener('error', onScriptError, true);
    retry.removeEventListener('click', reload);
    // The router replaces #root's children before complete(), so the splash is
    // normally already detached. In fallback shells it is still attached: fade
    // it out instead of cutting, and make it inert so content is usable at once.
    if (screen.isConnected) {
      screen.dataset.leaving = 'true';
      screen.setAttribute('aria-hidden', 'true');
      screen.inert = true;
      window.setTimeout(() => screen.remove(), 300);
    } else screen.remove();
    root.removeAttribute('data-booting');
    document.querySelector('.skip-link')?.setAttribute('href', '#main');
    document.body.classList.remove('njurc-starting');
    document.body.classList.add('page-ready');
  };

  retry.addEventListener('click', reload);
  window.addEventListener('error', onScriptError, true);
  observer.observe(root, { attributes: true, attributeFilter: ['data-booting'] });
  window.njurcBoot = Object.freeze({ phase, complete, fail, stylesReady, ensureRouteStyles });

  timers.push(window.setTimeout(() => {
    if (finished || failed) return;
    note.textContent = '加载时间比平常稍长，正在等待页面与服务响应。';
  }, 8_000));
  timers.push(window.setTimeout(() => {
    if (finished || failed) return;
    status.textContent = '页面仍在加载…';
    note.textContent = '等待较久，可以继续等待，或检查网络后重新加载。';
    retry.hidden = false;
  }, 20_000));

  if (!root.hasAttribute('data-booting')) complete();
})();
