import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Component coverage for the supported delivery-time assembly fallback. The
// delivered bundle has its own integration suite in boot-bundle.spec.mjs.
test.beforeEach(async ({ page }) => {
  const shell = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
  await page.route('**/*', route => route.request().isNavigationRequest()
    && route.request().resourceType() === 'document'
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: shell })
    : route.fallback());
});

async function stallScript(page, path = '/app/main.js') {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**${path}`, async route => {
    await gate;
    if (path === '/app/boot.js') await route.continue();
    else await route.fulfill({ contentType: 'application/javascript', body: '' });
  });
  return release;
}

async function expectBoot(page) {
  await expect(page.getByRole('heading', { name: '南京大学红十字会', exact: true })).toBeVisible();
  const crest = page.getByRole('img', { name: '南京大学红十字会会徽' });
  await expect(crest).toBeVisible();
  await expect(crest).toHaveAttribute('src', '/assets/nju-red-cross-emblem.jpg');
  await expect.poll(() => crest.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
}

async function expectBootApi(page) {
  await expect.poll(() => page.evaluate(() => typeof window.njurcBoot?.complete)).toBe('function');
}

test('crest and title are immediate without application scripts or other styles', async ({ page }, testInfo) => {
  const releaseMain = await stallScript(page);
  const releaseBoot = await stallScript(page, '/app/boot.js');
  await page.route('**/styles/*.css', route => route.request().url().endsWith('/boot.css') ? route.continue() : route.abort());
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expectBoot(page);
    await expect(page.getByText('活动报名', { exact: true })).toBeVisible();
    await expect(page.getByText('志愿签到', { exact: true })).toBeVisible();
    await expect(page.getByText('运营管理', { exact: true })).toBeVisible();
    await expect(page.locator('#boot-retry')).toBeHidden();
    await expect(page.locator('#boot-screen')).toHaveCSS('opacity', '1');
    expect(await page.evaluate(() => document.querySelector('link[rel="stylesheet"]').getAttribute('href'))).toBe('/styles/boot.css');
    expect(await page.evaluate(() => Boolean(window.njurcBoot))).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('boot-critical-only.png') });
  } finally {
    releaseBoot();
    releaseMain();
  }
});

test('all pending application styles leave bootstrap painted while shell readiness waits', async ({ page }, testInfo) => {
  const releaseMain = await stallScript(page);
  let releaseStyles;
  const gate = new Promise(resolve => { releaseStyles = resolve; });
  await page.route('**/styles/*.css', async route => {
    if (!route.request().url().endsWith('/boot.css')) await gate;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expectBoot(page);
    await expectBootApi(page);
    expect(await page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].filter(link => !link.href.endsWith('/boot.css')).every(link => link.media === 'print' && link.hasAttribute('data-deferred-style')))).toBe(true);
    await page.evaluate(() => {
      window.bootStylesResult = 'pending';
      window.njurcBoot.stylesReady('portal').then(() => { window.bootStylesResult = 'ready'; });
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.evaluate(() => window.bootStylesResult)).toBe('pending');
    await page.screenshot({ path: testInfo.outputPath('boot-all-css-and-main-stalled.png') });
    releaseStyles();
    await expect.poll(() => page.evaluate(() => window.bootStylesResult)).toBe('ready');
    await expectBoot(page);
  } finally {
    releaseStyles();
    releaseMain();
  }
});

test('slow startup explains waiting and offers keyboard retry without automatic reload', async ({ page }) => {
  await page.clock.install();
  const releaseMain = await stallScript(page);
  let documentRequests = 0;
  page.on('request', request => { if (request.isNavigationRequest()) documentRequests += 1; });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expectBootApi(page);
    await page.clock.fastForward(8_001);
    await expect(page.locator('#boot-note')).toContainText('加载时间比平常稍长');
    await expect(page.locator('#boot-retry')).toBeHidden();
    await page.clock.fastForward(12_001);
    const retry = page.getByRole('button', { name: '重新加载页面' });
    await expect(retry).toBeVisible();
    await expect(page.locator('#boot-status')).toHaveText('页面仍在加载');
    await page.clock.fastForward(60_000);
    expect(documentRequests).toBe(1);
    await retry.focus();
    await expect(retry).toBeFocused();
    const navigation = page.waitForEvent('request', request => request.isNavigationRequest());
    await page.keyboard.press('Enter');
    await navigation;
    expect(documentRequests).toBe(2);
  } finally {
    releaseMain();
  }
});

test('main module failure exposes an independent retry', async ({ page }) => {
  await page.route('**/app/main.js', route => route.abort());
  await page.goto('/', { waitUntil: 'commit' });
  await expectBoot(page);
  await expect(page.locator('#boot-status')).toHaveText('页面程序未能加载，请重试');
  await expect(page.getByRole('button', { name: '重新加载页面' })).toBeVisible();
});

test('reduced motion keeps startup visible without animated indicators', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const releaseMain = await stallScript(page);
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expectBoot(page);
    await expect(page.locator('.njurc-startup__indicator')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('#boot-status')).toHaveAttribute('aria-live', 'polite');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('boot-reduced-motion.png') });
  } finally {
    releaseMain();
  }
});

test('the activity plaza waits for its own layout stylesheet before readiness',async({page})=>{
 let releasePlaza;const gate=new Promise(resolve=>{releasePlaza=resolve;});
 await page.route('**/styles/events-plaza.css',async route=>{await gate;await route.continue();});
 try{
  await page.goto('/events',{waitUntil:'commit'});
  await expectBootApi(page);
  await expect(page.locator('link[href="/styles/events-plaza.css"]')).toHaveAttribute('media','print');
  await expect(page.locator('#boot-screen')).toBeVisible();
  await expect(page.getByRole('heading',{name:'参与流程',exact:true})).toHaveCount(0);
  releasePlaza();
  await expect(page.getByRole('heading',{name:'参与流程',exact:true})).toBeVisible();
  await expect(page.locator('#boot-screen')).toHaveCount(0);
 }finally{releasePlaza();}
});

test('phase and complete only dispose startup and cancel its timers', async ({ page }) => {
  await page.clock.install();
  const releaseMain = await stallScript(page);
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expectBootApi(page);
    await page.evaluate(() => {
      window.njurcBoot.phase('正在准备活动广场');
      const content = document.createElement('p');
      content.id = 'ready-content';
      content.textContent = '页面内容';
      document.getElementById('root').append(content);
    });
    await expect(page.locator('#boot-status')).toHaveText('正在准备活动广场');
    await page.evaluate(() => window.njurcBoot.complete());
    await expect(page.locator('#boot-screen')).toHaveCount(0);
    await expect(page.locator('#ready-content')).toHaveText('页面内容');
    await expect(page.locator('body')).toHaveClass(/page-ready/);
    await expect(page.locator('#root')).not.toHaveAttribute('data-booting', 'true');
    await page.clock.fastForward(30_000);
    await page.evaluate(() => {
      window.njurcBoot.phase('不应出现');
      window.njurcBoot.fail('不应出现');
      window.njurcBoot.complete();
    });
    await expect(page.locator('#boot-screen')).toHaveCount(0);
    await expect(page.locator('#ready-content')).toHaveText('页面内容');
  } finally {
    releaseMain();
  }
});

test('removing data-booting automatically completes startup', async ({ page }) => {
  const releaseMain = await stallScript(page);
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expectBootApi(page);
    await page.evaluate(() => document.getElementById('root').removeAttribute('data-booting'));
    await expect(page.locator('#boot-screen')).toHaveCount(0);
    await expect(page.locator('body')).toHaveClass(/page-ready/);
  } finally {
    releaseMain();
  }
});

test('deferred page style does not block startup and is promoted on load', async ({ page }) => {
  const releaseMain = await stallScript(page);
  let releaseStyle;
  const styleGate = new Promise(resolve => { releaseStyle = resolve; });
  await page.route('**/styles/warmth.css', async route => {
    await styleGate;
    await route.fulfill({ contentType: 'text/css', body: '.boot-test-style { color: navy; }' });
  });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expectBoot(page);
    await expectBootApi(page);
    const style = page.locator('link[href="/styles/warmth.css"]');
    await expect(style).toHaveAttribute('media', 'print');
    releaseStyle();
    await expect(style).toHaveAttribute('media', 'all');
    await expect(style).toHaveAttribute('data-deferred-style', 'loaded');
  } finally {
    releaseStyle();
    releaseMain();
  }
});

test('already loaded deferred sheets are promoted when bootstrap starts', async ({ page }) => {
  const releaseMain = await stallScript(page);
  const releaseBoot = await stallScript(page, '/app/boot.js');
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expectBoot(page);
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('link[data-deferred-style]')].every(link => Boolean(link.sheet)))).toBe(true);
    releaseBoot();
    await expectBootApi(page);
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('link[data-deferred-style]')].every(link => link.media === 'all'))).toBe(true);
  } finally {
    releaseBoot();
    releaseMain();
  }
});

test('stylesheet errors do not trap startup or leave their print marker active', async ({ page }) => {
  const releaseMain = await stallScript(page);
  let releaseStyle;
  const gate = new Promise(resolve => { releaseStyle = resolve; });
  await page.route('**/styles/booking.css', async route => {
    await gate;
    await route.abort();
  });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expectBootApi(page);
    releaseStyle();
    const style = page.locator('link[href="/styles/booking.css"]');
    await expect(style).toHaveAttribute('media', 'all');
    await expect(style).toHaveAttribute('data-deferred-style', 'error');
    await page.evaluate(() => window.njurcBoot.stylesReady('portal'));
    await expect(page.locator('#boot-status')).toHaveText('正在准备服务页面');
    await expect(page.locator('#boot-retry')).toBeHidden();
  } finally {
    releaseStyle();
    releaseMain();
  }
});

test('console styles do not wait for portal layout and portal waits until its sheet loads', async ({ page }) => {
  const releaseMain = await stallScript(page);
  let releaseStyle;
  const gate = new Promise(resolve => { releaseStyle = resolve; });
  await page.route('**/styles/portal.css', async route => {
    await gate;
    await route.fulfill({ contentType: 'text/css', body: '' });
  });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expectBoot(page);
    await expectBootApi(page);
    await page.evaluate(() => {
      window.bootStylesResult = 'pending';
      window.njurcBoot.stylesReady('portal').then(() => { window.bootStylesResult = 'ready'; });
    });
    await page.evaluate(() => window.njurcBoot.stylesReady('console'));
    expect(await page.evaluate(() => window.bootStylesResult)).toBe('pending');
    releaseStyle();
    await expect.poll(() => page.evaluate(() => window.bootStylesResult)).toBe('ready');
  } finally {
    releaseStyle();
    releaseMain();
  }
});

for (const failure of ['error', 'timeout']) {
  test(`core style ${failure} rejects layout readiness without hanging`, async ({ page }) => {
    await page.clock.install();
    const releaseMain = await stallScript(page);
    let releaseStyle;
    const gate = new Promise(resolve => { releaseStyle = resolve; });
    await page.route('**/styles/base.css', async route => {
      await gate;
      await route.abort();
    });
    try {
      await page.goto('/', { waitUntil: 'commit' });
      await expectBoot(page);
      await expectBootApi(page);
      await page.evaluate(() => {
        window.bootStylesResult = 'pending';
        window.njurcBoot.stylesReady('portal').then(
          () => { window.bootStylesResult = 'ready'; },
          error => { window.bootStylesResult = error.message; },
        );
      });
      if (failure === 'error') releaseStyle();
      else await page.clock.fastForward(15_001);
      await expect.poll(() => page.evaluate(() => window.bootStylesResult)).toContain(failure === 'error' ? '未能加载' : '加载超时');
      await expectBoot(page);
    } finally {
      releaseStyle();
      releaseMain();
    }
  });
}
