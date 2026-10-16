import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../../public/app/console/pages/outreach.js', import.meta.url),
  'utf8',
);

async function mount(page, kind, responseStatus) {
  const requests = [];

  await page.route('**/api/**', (route) => route.abort());

  await page.route(
    `**/api/outreach/publications/synthetic-content/${kind}`,
    async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: responseStatus,
        json: responseStatus === 200
          ? { ok: true, message: '合成处理成功' }
          : { code: 'synthetic_failure', message: '合成接口失败' },
      });
    },
  );

  await page.route('**/app/console/pages/outreach.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `${source}\nexport { openScheduleDrawer, openResultDrawer };\n`,
    }));

  await page.route('**/outreach-draft-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
        <html data-surface="console" data-theme="porcelain" data-motion="reduced">
        <head>
          <link rel="stylesheet" href="/styles/tokens.css">
          <link rel="stylesheet" href="/styles/base.css">
          <link rel="stylesheet" href="/styles/components.css">
          <link rel="stylesheet" href="/styles/admin.css">
        </head>
        <body>
          <div id="root"><button>合成入口</button></div>
          <div id="overlay-root"></div>
          <div id="toast-root"></div>
        </body>
        </html>`,
    }));

  await page.goto('/outreach-draft-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async (kind) => {
    const module = await import('/app/console/pages/outreach.js');
    window.refreshCalls = 0;
    const item = {
      id: 'synthetic-content',
      title: '合成宣传内容',
      type: '文字稿件',
      source: '合成来源',
      publication: {
        channel: 'site',
        plannedAt: '2026-10-20T12:00:00Z',
        retryCount: 0,
      },
    };
    const options = {
      onDone: () => { window.refreshCalls++; },
    };

    if (kind === 'schedule') module.openScheduleDrawer(item, options);
    else module.openResultDrawer(item, options);
  }, kind);

  return requests;
}

async function fillSchedule(page) {
  await page.locator('input[name="plannedAt"]')
    .fill('2026-10-20T20:00');
  await page.getByLabel('发布备注', { exact: true })
    .fill('合成排期备注');

  const checkbox = page.getByRole('checkbox', {
    name: /^我理解平台不会自动向外部渠道发送/,
  });
  await page.locator('label.check')
    .filter({ has: checkbox })
    .locator('.check__box')
    .click();
  await expect(checkbox).toBeChecked();
}

async function expectDiscardWarning(page) {
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const confirmation = page.getByRole('dialog', {
    name: '放弃未保存的修改？',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', {
    name: '取消',
    exact: true,
  }).click();
  await expect(confirmation).toHaveCount(0);
}

test('failed scheduling preserves input and close protection', async ({ page }) => {
  const requests = await mount(page, 'schedule', 500);
  await fillSchedule(page);
  const submit = page.getByRole('button', {
    name: '创建排期任务',
    exact: true,
  });
  await submit.click();

  await expect.poll(() => requests.length).toBe(1);
  await expect(submit).toBeEnabled();
  await expect(page.getByLabel('发布备注', { exact: true }))
    .toHaveValue('合成排期备注');
  expect(await page.evaluate(() => window.refreshCalls)).toBe(0);

  await expectDiscardWarning(page);
  await expect(page.getByLabel('发布备注', { exact: true }))
    .toHaveValue('合成排期备注');
});

test('successful scheduling closes without a discard warning', async ({ page }) => {
  const requests = await mount(page, 'schedule', 200);
  await fillSchedule(page);
  await page.getByRole('button', {
    name: '创建排期任务',
    exact: true,
  }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(requests[0].note).toBe('合成排期备注');
  expect(await page.evaluate(() => window.refreshCalls)).toBe(1);
});

test('failed result registration preserves input and close protection', async ({ page }) => {
  const requests = await mount(page, 'result', 500);
  const link = page.getByLabel('发布链接', { exact: true });
  await link.fill('https://example.com/synthetic');
  const submit = page.getByRole('button', {
    name: '登记结果',
    exact: true,
  });
  await submit.click();

  await expect.poll(() => requests.length).toBe(1);
  await expect(submit).toBeEnabled();
  await expect(link).toHaveValue('https://example.com/synthetic');
  expect(await page.evaluate(() => window.refreshCalls)).toBe(0);

  await expectDiscardWarning(page);
  await expect(link).toHaveValue('https://example.com/synthetic');
});

test('successful result registration closes without a discard warning', async ({ page }) => {
  const requests = await mount(page, 'result', 200);
  await page.getByLabel('发布链接', { exact: true })
    .fill('https://example.com/synthetic');
  await page.getByRole('button', {
    name: '登记结果',
    exact: true,
  }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(requests[0].publishedLink).toBe('https://example.com/synthetic');
  expect(await page.evaluate(() => window.refreshCalls)).toBe(1);
});