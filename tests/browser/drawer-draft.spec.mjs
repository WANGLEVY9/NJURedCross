import { test, expect } from '@playwright/test';

async function mountDraft(page) {
  await page.route('**/drawer-draft-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><body>
      <div id="root"><button>打开表单</button></div>
      <div id="overlay-root"></div>
    </body></html>`,
  }));
  await page.goto('/drawer-draft-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { openDrawer } = await import('/app/ui/overlay.js');
    const { protectDrawerDraft } = await import('/app/ui/drawer-draft.js');

    const input = document.createElement('input');
    input.setAttribute('aria-label', '备注');
    input.value = '原始备注';

    window.busy = false;
    window.operation = '入库';
    window.drawer = openDrawer({
      title: '合成库存表单',
      body: input,
    });
    window.protection = protectDrawerDraft(window.drawer, {
      readExtraState: () => window.operation,
      isBusy: () => window.busy,
    });
  });
}

test('unchanged drafts close without confirmation', async ({ page }) => {
  await mountDraft(page);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('cancelling discard preserves input and allows a later discard', async ({ page }) => {
  await mountDraft(page);
  await page.getByRole('textbox', { name: '备注' }).fill('尚未保存的备注');
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  const confirmation = page.getByRole('dialog', {
    name: '放弃未保存的修改？',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();

  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '备注' }))
    .toHaveValue('尚未保存的备注');

  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('restoring the original value removes the unsaved warning', async ({ page }) => {
  await mountDraft(page);
  const input = page.getByRole('textbox', { name: '备注' });
  await input.fill('修改过');
  await input.fill('原始备注');

  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('operation changes are included in draft detection', async ({ page }) => {
  await mountDraft(page);
  await page.evaluate(() => { window.operation = '出库'; });
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  await expect(page.getByRole('dialog', {
    name: '放弃未保存的修改？',
    exact: true,
  })).toBeVisible();
});

test('busy drafts stay open and releasing protection permits closing', async ({ page }) => {
  await mountDraft(page);
  await page.getByRole('textbox', { name: '备注' }).fill('填写内容');
  await page.evaluate(() => { window.busy = true; });
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: '备注' }))
    .toHaveValue('填写内容');

  await page.evaluate(() => {
    window.busy = false;
    window.protection.release();
  });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});