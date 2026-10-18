(() => {
  'use strict';

  const styles = new Map();
  document.querySelectorAll('link[data-deferred-style]').forEach((link) => {
    let settle;
    const ready=new Promise(resolve => { settle = resolve; });
    styles.set(new URL(link.href, window.location.href).pathname, ready);
    for(const path of (link.dataset.bundledStyles||'').split(' ').filter(Boolean))styles.set(new URL(path,window.location.href).pathname,ready);
    const promote = (event) => {
      const loaded = event?.type !== 'error';
      link.media = 'all';
      link.dataset.deferredStyle = loaded ? 'loaded' : 'error';
      link.removeEventListener('load', promote);
      link.removeEventListener('error', promote);
      settle(loaded);
    };
    link.addEventListener('load', promote);
    link.addEventListener('error', promote);
    if (link.sheet) promote();
  });
  const stylesReady = (surface) => {
    // 活动广场的整体排版依赖自己的样式表；其余页面样式仍为可选增强。
    const required = ['tokens', 'base', 'components', 'mobile', 'themes', surface === 'console' ? 'admin' : 'portal', ...(location.pathname === '/events' || location.pathname.startsWith('/events/') ? ['events-plaza'] : [])];
    const loaded = Promise.all(required.map((name) => {
      const pending = styles.get(`/styles/${name}.css`);
      if (!pending) return Promise.reject(new Error('页面布局样式缺失，请重新加载。'));
      return pending.then((ok) => {
        if (!ok) throw new Error('页面布局样式未能加载，请检查网络后重试。');
      });
    }));
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = window.setTimeout(() => reject(new Error('页面布局样式加载超时，请检查网络后重试。')), 15_000);
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
    screen.remove();
    root.removeAttribute('data-booting');
    document.querySelector('.skip-link')?.setAttribute('href', '#main');
    document.body.classList.remove('njurc-starting');
    document.body.classList.add('page-ready');
  };

  retry.addEventListener('click', reload);
  window.addEventListener('error', onScriptError, true);
  observer.observe(root, { attributes: true, attributeFilter: ['data-booting'] });
  window.njurcBoot = Object.freeze({ phase, complete, fail, stylesReady });

  timers.push(window.setTimeout(() => {
    if (finished || failed) return;
    note.textContent = '加载时间比平常稍长，正在等待页面与服务响应。';
  }, 8_000));
  timers.push(window.setTimeout(() => {
    if (finished || failed) return;
    status.textContent = '页面仍在加载';
    note.textContent = '等待较久，可以继续等待，或检查网络后重新加载。';
    retry.hidden = false;
  }, 20_000));

  if (!root.hasAttribute('data-booting')) complete();
})();
