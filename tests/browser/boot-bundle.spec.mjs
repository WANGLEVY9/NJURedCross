import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bundleSelector = 'link[data-bundled-styles]';

test('delayed delivered bundle preserves branded startup and resolves surface aliases together', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/styles/app.css?*', async route => {
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
    const originals = [...source.matchAll(/<link\b[^>]*>/g)]
      .filter(([tag]) => tag.includes('data-deferred-style') && !tag.includes('/font-faces.css'))
      .map(([tag]) => tag.match(/href="([^"]+)"/)[1]);
    expect((await page.locator(bundleSelector).getAttribute('data-bundled-styles')).split(' ')).toEqual(originals);
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
  await page.route('**/styles/app.css*', route => route.abort());
  await page.goto('/events', { waitUntil: 'domcontentloaded' });
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

for (const outcome of ['pending', 'error']) {
  test(`separate optional font stylesheet ${outcome} does not block the delivered application`, async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/styles/font-faces.css*', async route => {
      if (outcome === 'pending') await gate;
      await route.abort();
    });
    try {
      await page.goto('/events', { waitUntil: 'domcontentloaded' });
      const font = page.locator('link[href="/styles/font-faces.css"]');
      await expect(font).toHaveCount(1);
      await expect(page.locator(bundleSelector)).not.toHaveAttribute('data-bundled-styles', /font-faces/);
      await expect(page.getByRole('heading', { name: '参与流程', exact: true })).toBeVisible();
      await expect(page.locator('#boot-screen')).toHaveCount(0);
      await expect(font).toHaveAttribute('media', outcome === 'pending' ? 'print' : 'all');
      if (outcome === 'error') await expect(font).toHaveAttribute('data-deferred-style', 'error');
      await page.evaluate(() => Promise.all(['portal', 'console'].map(surface => window.njurcBoot.stylesReady(surface))));
    } finally {
      release();
    }
  });
}
