import { test, expect } from '@playwright/test';

async function mount(page, succeeds, beforeRespond = async () => {}) {
  const requests = [];
  await page.route('**/api/**', (route) => route.abort());

  await page.route(
    '**/api/volunteer/workflow/registrations/synthetic-leave/*',
    async (route) => {
      requests.push({
        url: route.request().url(),
        body: route.request().postDataJSON(),
      });
      await beforeRespond();
      await route.fulfill({
        status: succeeds ? 200 : 500,
        json: succeeds
          ? { ok: true }
          : { code: 'synthetic_failure', message: '合成处理失败' },
      });
    },
  );

  await page.route('**/roster-leave-fixture', (route) =>
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
          <script type="module">
            import { openRosterLeaveDrawer }
              from '/app/console/pages/activity-management.js';
            window.refreshCalls = 0;
            openRosterLeaveDrawer({
              _id: 'synthetic-leave',
              '请假原因': '合成请假原因',
            }, {
              refresh: async () => { window.refreshCalls++; },
            });
          </script>
        </body></html>`,
    }));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/roster-leave-fixture');
  await expect(page.getByLabel('处理说明', { exact: true })).toBeVisible();
  return requests;
}

for (const action of ['批准请假', '驳回请假']) {
  test(`${action}: failure retains the reason and protection`, async ({ page }) => {
    const requests = await mount(page, false);
    const reason = page.getByLabel('处理说明', { exact: true });
    await reason.fill('合成处理说明');
    const submit = page.getByRole('button', { name: action, exact: true });
    await submit.click();

    await expect.poll(() => requests.length).toBe(1);
    await expect(submit).toBeEnabled();
    await expect(reason).toHaveValue('合成处理说明');
    expect(await page.evaluate(() => window.refreshCalls)).toBe(0);

    await page.getByRole('button', { name: '关闭', exact: true }).click();
    const warning = page.getByRole('dialog', {
      name: '放弃未保存的修改？',
      exact: true,
    });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: '取消', exact: true }).click();
    await expect(warning).toHaveCount(0);
    await expect(reason).toHaveValue('合成处理说明');
  });

  test(`${action}: success releases protection`, async ({ page }) => {
    const requests = await mount(page, true);
    await page.getByLabel('处理说明', { exact: true }).fill('合成处理说明');
    await page.getByRole('button', { name: action, exact: true }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].body.reason).toBe('合成处理说明');
    expect(requests[0].url).toMatch(
      action === '批准请假' ? /leave-approve$/ : /leave-reject$/,
    );
    expect(await page.evaluate(() => window.refreshCalls)).toBe(1);
  });
}

test('pending submissions block closing and the opposite action', async ({ page }) => {
  let release;
  const requests = await mount(page, true, () => new Promise((resolve) => {
    release = resolve;
  }));
  await page.getByLabel('处理说明', { exact: true }).fill('合成处理说明');
  await page.getByRole('button', { name: '批准请假', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);

  await page.getByRole('button', { name: '驳回请假', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog', {
    name: '处理请假',
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole('dialog', {
    name: '放弃未保存的修改？',
    exact: true,
  })).toHaveCount(0);
  expect(requests).toHaveLength(1);

  release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});