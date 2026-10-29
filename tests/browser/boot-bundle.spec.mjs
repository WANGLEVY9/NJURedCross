import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// The console bundle may be added later on demand; these checks follow the
// bundle that was delivered with the shell.
const bundleSelector = 'link[data-bundled-styles][href^="/styles/app.css"]';

async function disableBrowserCache(page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.clearBrowserCache');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
}

test('delayed delivered bundle preserves branded startup and resolves surface aliases together', async ({ page }) => {
  await disableBrowserCache(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  // Both surface bundles are delivered through the same path family.
  await page.route('**/styles/app*.css?*', async route => {
    await gate;
    await route.continue();
  });
  try {
    const response = await page.goto('/events', { waitUntil: 'commit' });
    const delivered = await response.text();
    expect(delivered).toContain('data-bundled-styles=');
    await expect(page.locator('#boot-screen')).toBeVisible();
    const crest = page.locator('.njurc-startup__crest');
    await expect.poll(() => crest.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(page.locator('link[href="/styles/boot.css"]')).toHaveCount(1);
    await expect(page.locator('link[href="/styles/boot.css"]')).not.toHaveAttribute('media', 'print');
    await expect(page.locator(bundleSelector)).toHaveAttribute('media', 'print');
    await expect.poll(() => page.evaluate(() => typeof window.njurcBoot?.stylesReady)).toBe('function');

    const source = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
    // The console bundle is delivered separately, so the portal shell lists the
    // shared sheets plus the portal ones only.
    const originals = [...source.matchAll(/<link\b[^>]*>/g)]
      .filter(([tag]) => tag.includes('data-deferred-style') && !tag.includes('data-surface="console"'))
      .map(([tag]) => tag.match(/href="([^"]+)"/)[1]);
    // 关键包与增强包合起来覆盖门户的全部延迟样式表。
    const deliveredStyles = await page.locator('link[data-bundled-styles]').evaluateAll(links => links.flatMap(link => (link.dataset.bundledStyles || '').split(' ')).filter(Boolean));
    // 顺序不同（关键包在前），按集合比较。
    expect(deliveredStyles.slice().sort()).toEqual(originals.slice().sort());
    await page.evaluate(() => {
      window.bundleReadiness = {};
      for (const surface of ['portal', 'console']) {
        window.bundleReadiness[surface] = 'pending';
        window.njurcBoot.stylesReady(surface).then(
          () => { window.bundleReadiness[surface] = 'ready'; },
          error => { window.bundleReadiness[surface] = error.message; },
        );
      }
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.evaluate(() => window.bundleReadiness)).toEqual({ portal: 'pending', console: 'pending' });
    await expect(page.locator('#root')).toHaveAttribute('data-booting', 'true');
    release();
    await expect.poll(() => page.evaluate(() => window.bundleReadiness)).toEqual({ portal: 'ready', console: 'ready' });
    await expect(page.locator(bundleSelector)).toHaveAttribute('media', 'all');
    await expect(page.locator(bundleSelector)).toHaveAttribute('data-deferred-style', 'loaded');
    await expect(page.getByRole('heading', { name: '参与流程', exact: true })).toBeVisible();
    await expect(page.locator('#boot-screen')).toHaveCount(0);
  } finally {
    release();
  }
});

test('failed delivered bundle rejects layout readiness and leaves a retryable startup', async ({ page }) => {
  await disableBrowserCache(page);
  let intercepted = 0;
  await page.route('**/styles/app*.css*', route => { intercepted++; return route.abort(); });
  await page.goto('/events', { waitUntil: 'domcontentloaded' });
  // 关键包与增强包各一次请求，都会被这次拦截计入。
  await expect.poll(() => intercepted).toBe(2);
  await expect(page.locator(bundleSelector)).toHaveAttribute('data-deferred-style', 'error');
  await expect(page.locator('#boot-screen')).toHaveAttribute('data-state', 'failed');
  await expect(page.locator('#boot-retry')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/page-ready/);
  for (const surface of ['portal', 'console']) {
    const error = await page.evaluate(surface => window.njurcBoot.stylesReady(surface).then(() => '', error => error.message), surface);
    expect(error).toContain('未能加载');
  }
  await expect(page.getByRole('heading', { name: '参与流程', exact: true })).toHaveCount(0);
});

test('cold public load preserves portal typography with compact cached fonts', async ({ page }) => {
  await disableBrowserCache(page);
  const fontRequests = [];
  page.on('request', request => {
    if (/\.woff2(?:$|\?)/.test(request.url())) fontRequests.push(request.url());
  });
  await page.goto('/events');
  await expect(page.getByRole('heading', { name: '参与流程', exact: true })).toBeVisible();
  await expect(page.locator('#boot-screen')).toHaveCount(0);
  await expect(page.locator('link[href="/styles/font-faces.css"]')).toHaveCount(0);
  expect(fontRequests.length).toBeGreaterThan(0);
  expect(fontRequests.every(url => new URL(url).pathname.startsWith('/assets/fonts/events/'))).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  const fontBytes = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\.woff2(?:$|\?)/.test(entry.name)).reduce((sum, entry) => sum + entry.decodedBodySize, 0));
  expect(fontBytes).toBeLessThan(400_000);
  await expect(page.locator('.events-hero h1')).toHaveCSS('font-family', /Events Serif/);
});

test('homepage never pays for the plaza brand fonts', async ({ page }) => {
  await disableBrowserCache(page);
  const fonts = [];
  page.on('request', request => { if (/\.woff2(?:$|\?)/.test(request.url())) fonts.push(new URL(request.url()).pathname); });
  await page.goto('/');
  await expect(page.locator('#boot-screen')).toHaveCount(0);
  // 品牌子集约 350KB：只有活动广场需要，首页/其它页面不应下载。
  expect(fonts.filter(path => path.startsWith('/assets/fonts/events/ui-'))).toEqual([]);
});
