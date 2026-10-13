import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const sources = {};
for (const version of ['legacy', 'birthday']) {
  sources[version] = await readFile(
    new URL(
      `../../public/app/console/pages/community-${version}.js`,
      import.meta.url,
    ),
    'utf8',
  );
}

async function mount(page, version, succeeds) {
  const requests = [];
  await page.route('**/api/**', (route) => route.abort());

  const endpoint = version === 'legacy'
    ? '**/api/community/consent'
    : '**/api/public/warmth/interest';

  await page.route(endpoint, async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: succeeds ? 200 : 500,
      json: succeeds
        ? { ok: true, message: '合成登记成功' }
        : { code: 'synthetic_failure', message: '合成登记失败' },
    });
  });

  await page.route(`**/app/console/pages/community-${version}.js`,
    (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `${sources[version]}\nexport { openJoinDrawer };\n`,
    }));

  await page.route('**/community-join-fixture', (route) =>
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
        </body></html>`,
    }));

  await page.goto('/community-join-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async (version) => {
    const { openJoinDrawer } =
      await import(`/app/console/pages/community-${version}.js`);
    window.refreshCalls = 0;
    openJoinDrawer({
      onDone: () => { window.refreshCalls++; },
    });
  }, version);

  return requests;
}

async function consent(page) {
  const checkbox = page.getByRole('checkbox', {
    name: /^我自愿参加，并确认可以随时退出/,
  });
  await page.locator('label.check')
    .filter({ has: checkbox })
    .locator('.check__box')
    .click();
  await expect(checkbox).toBeChecked();
  return checkbox;
}

for (const version of ['legacy', 'birthday']) {
  test(`${version}: failed joining preserves consent and protection`, async ({ page }) => {
    const requests = await mount(page, version, false);
    const checkbox = await consent(page);
    const submit = page.getByRole('button', {
      name: '记录参加意愿',
      exact: true,
    });
    await submit.click();

    await expect.poll(() => requests.length).toBe(1);
    await expect(submit).toBeEnabled();
    await expect(checkbox).toBeChecked();
    expect(await page.evaluate(() => window.refreshCalls)).toBe(0);

    await page.getByRole('button', { name: '关闭', exact: true }).click();
    const warning = page.getByRole('dialog', {
      name: '放弃未保存的修改？',
      exact: true,
    });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', {
      name: '取消',
      exact: true,
    }).click();

    await expect(warning).toHaveCount(0);
    await expect(checkbox).toBeChecked();
  });

  test(`${version}: successful joining releases protection`, async ({ page }) => {
    const requests = await mount(page, version, true);
    await consent(page);
    await page.getByRole('button', {
      name: '记录参加意愿',
      exact: true,
    }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].consent).toBe(true);
    expect(await page.evaluate(() => window.refreshCalls)).toBe(1);
  });
}