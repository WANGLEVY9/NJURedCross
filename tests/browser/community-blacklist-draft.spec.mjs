import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../../public/app/console/pages/community-birthday.js', import.meta.url),
  'utf8',
);

async function mount(page, kind, succeeds = false) {
  const requests = [];

  await page.route('**/api/**', (route) => route.abort());

  await page.route('**/api/community/warmth-members/synthetic-member',
    (route) => route.fulfill({
      json: {
        ok: true,
        member: {
          accountId: 'synthetic-account',
          realName: '合成成员',
          studentId: 'SYNTHETIC',
          warmth: {
            enrollmentStatus: '已确认',
            blacklisted: false,
            reported: 0,
            written: 0,
            received: 0,
          },
        },
      },
    }));

  const endpoint = kind === 'member'
    ? '**/api/community/warmth-blacklist'
    : '**/api/community/interests/synthetic-interest/blacklist';

  await page.route(endpoint, async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: succeeds ? 200 : 500,
      json: succeeds
        ? { ok: true, message: '合成操作成功' }
        : { code: 'synthetic_failure', message: '合成操作失败' },
    });
  });

  await page.route('**/app/console/pages/community-birthday.js',
    (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `${source}\nexport { openMemberDrawer, openBlacklistDrawer };\n`,
    }));

  await page.route('**/community-blacklist-fixture',
    (route) => route.fulfill({
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

  await page.goto('/community-blacklist-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async (kind) => {
    const module = await import('/app/console/pages/community-birthday.js');
    window.refreshCalls = 0;
    const options = {
      onDone: () => { window.refreshCalls++; },
    };
    if (kind === 'member') {
      module.openMemberDrawer('synthetic-member', options);
    } else {
      module.openBlacklistDrawer({
        id: 'synthetic-interest',
        nickname: '合成成员',
        studentId: 'SYNTHETIC',
      }, options);
    }
  }, kind);

  if (kind === 'member') {
    await expect(page.getByText('合成成员', { exact: true })).toBeVisible();
  }

  return requests;
}

function reasonField(page, kind) {
  return page.getByRole('textbox', {
    name: kind === 'member'
      ? /^拉黑原因（需要拉黑时填写）/
      : /^拉黑原因/,
  });
}

for (const kind of ['member', 'interest']) {
  test(`${kind}: failure preserves the reason and unsaved protection`, async ({ page }) => {
    const requests = await mount(page, kind);
    const reason = reasonField(page, kind);
    await reason.fill('合成测试原因');
    const submit = page.getByRole('button', {
      name: '拉黑并踢出',
      exact: true,
    });
    await submit.click();

    await expect.poll(() => requests.length).toBe(1);
    await expect(submit).toBeEnabled();
    await expect(reason).toHaveValue('合成测试原因');
    expect(await page.evaluate(() => window.refreshCalls)).toBe(0);

    const drawer = page.getByRole('dialog');
    await drawer.getByRole('button', {
      name: '关闭',
      exact: true,
    }).first().click();

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
    await expect(reason).toHaveValue('合成测试原因');
  });

  test(`${kind}: success releases protection and closes`, async ({ page }) => {
    const requests = await mount(page, kind, true);
    await reasonField(page, kind).fill('合成测试原因');
    await page.getByRole('button', {
      name: '拉黑并踢出',
      exact: true,
    }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].reason).toBe('合成测试原因');
    expect(await page.evaluate(() => window.refreshCalls)).toBe(1);
  });
}

test('loading member details does not create an unsaved warning', async ({ page }) => {
  await mount(page, 'member');
  await page.getByRole('dialog').getByRole('button', {
    name: '关闭',
    exact: true,
  }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});