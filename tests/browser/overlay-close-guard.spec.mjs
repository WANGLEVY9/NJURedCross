import { test, expect } from '@playwright/test';

async function mountDrawer(page, guarded = true) {
  await page.route('**/close-guard-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html>
      <html><body>
        <div id="root"><button>打开表单</button></div>
        <div id="overlay-root"></div>
      </body></html>`,
  }));
  await page.goto('/close-guard-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async useGuard => {
    const { openDrawer } = await import('/app/ui/overlay.js');
    const input = document.createElement('input');
    input.setAttribute('aria-label', '备注');
    input.value = '尚未保存的内容';

    window.guardCalls = 0;
    window.allowClose = false;
    window.drawer = openDrawer({
      title: '合成测试表单',
      body: input,
    });

    if (useGuard) {
      window.drawer.setCloseGuard(() => {
        window.guardCalls++;
        return window.allowClose;
      });
    }
  }, guarded);
}

test('rejected close keeps the drawer and input intact', async ({ page }) => {
  await mountDrawer(page);
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  await expect.poll(
    () => page.evaluate(() => window.guardCalls),
  ).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: '备注' }))
    .toHaveValue('尚未保存的内容');
});

test('Escape closes the drawer after the guard allows it', async ({ page }) => {
  await mountDrawer(page);
  await page.evaluate(() => { window.allowClose = true; });
  await page.getByRole('textbox', { name: '备注' }).focus();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.guardCalls)).toBe(1);
});

test('overlapping close requests share one pending check', async ({ page }) => {
  await mountDrawer(page);
  await page.evaluate(() => {
    window.drawer.setCloseGuard(() => {
      window.guardCalls++;
      return new Promise(resolve => { window.resolveClose = resolve; });
    });
    window.drawer.close();
    window.drawer.close();
    window.drawer.close();
  });

  await expect.poll(
    () => page.evaluate(() => window.guardCalls),
  ).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(1);

  await page.evaluate(() => window.resolveClose(true));
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('failed checks preserve the drawer and can be cleared', async ({ page }) => {
  await mountDrawer(page);
  await page.evaluate(() => {
    window.drawer.setCloseGuard(() => {
      window.guardCalls++;
      throw new Error('synthetic check failure');
    });
    window.drawer.close();
  });

  await expect.poll(
    () => page.evaluate(() => window.guardCalls),
  ).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(1);

  await page.evaluate(() => {
    window.drawer.setCloseGuard(null);
    window.drawer.close();
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('drawers without a guard retain their original close behavior', async ({ page }) => {
  await mountDrawer(page, false);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});