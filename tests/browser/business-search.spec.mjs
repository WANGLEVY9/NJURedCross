import { test, expect } from '@playwright/test';

async function mount(page) {
  await page.route('**/api/**', (route) => route.abort());

  await page.route('**/business-search-fixture', (route) =>
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
            import {
              registerCommands,
              registerSearchProvider,
              openPalette,
            } from '/app/ui/palette.js';

            window.searchQueries = [];
            window.executed = [];
            const pending = new Map();

            registerCommands(() => [{
              id: 'synthetic-page',
              title: '打开活动管理',
              group: '前往',
              run: () => window.executed.push('page'),
            }]);

            registerSearchProvider((query) => new Promise((resolve, reject) => {
              window.searchQueries.push(query);
              pending.set(query, { resolve, reject });
            }));

            window.resolveSearch = (query, title, message = '') => {
              pending.get(query).resolve({
                items: title ? [{
                  id: 'synthetic:' + title,
                  title,
                  subtitle: '合成业务记录',
                  group: '业务记录',
                  run: () => window.executed.push(title),
                }] : [],
                message,
              });
            };
            window.rejectSearch = (query) =>
              pending.get(query).reject(new Error('合成搜索失败'));
            window.openSearch = openPalette;
            await openPalette();
            window.fixtureReady = true;
          </script>
        </body></html>`,
    }));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/business-search-fixture');
  await expect.poll(() =>
    page.evaluate(() => window.fixtureReady === true)).toBe(true);
}

function searchInput(page) {
  return page.getByRole('combobox', {
    name: '命令面板搜索',
    exact: true,
  });
}

async function waitForQuery(page, query) {
  await expect.poll(() =>
    page.evaluate((query) => window.searchQueries.includes(query), query),
  ).toBe(true);
}

test('short queries keep page commands without loading business records', async ({ page }) => {
  await mount(page);
  await expect(page.getByRole('option', {
    name: '打开活动管理',
  })).toBeVisible();

  await searchInput(page).fill('合');
  await expect(page.getByRole('status'))
    .toContainText('输入至少两个字');
  expect(await page.evaluate(() => window.searchQueries)).toEqual([]);
});

test('older responses cannot replace the current query results', async ({ page }) => {
  await mount(page);
  await searchInput(page).fill('旧搜索');
  await waitForQuery(page, '旧搜索');
  await searchInput(page).fill('新搜索');
  await waitForQuery(page, '新搜索');

  await page.evaluate(() =>
    window.resolveSearch('新搜索', '新的合成记录'));
  await expect(page.getByRole('option', {
    name: /新的合成记录/,
  })).toBeVisible();

  await page.evaluate(() =>
    window.resolveSearch('旧搜索', '旧的合成记录'));
  await expect(page.getByRole('option', {
    name: /旧的合成记录/,
  })).toHaveCount(0);
  await expect(page.getByRole('option', {
    name: /新的合成记录/,
  })).toBeVisible();
});

test('failed business searches retain matching page commands', async ({ page }) => {
  await mount(page);
  await searchInput(page).fill('活动');
  await waitForQuery(page, '活动');
  await page.evaluate(() => window.rejectSearch('活动'));

  await expect(page.getByRole('status'))
    .toContainText('业务搜索暂时不可用');
  await expect(page.getByRole('option', {
    name: /打开活动管理/,
  })).toBeVisible();
});

test('Enter runs the selected business result and closes the palette', async ({ page }) => {
  await mount(page);
  await searchInput(page).fill('合成记录');
  await waitForQuery(page, '合成记录');
  await page.evaluate(() =>
    window.resolveSearch('合成记录', '合成记录甲'));
  await expect(page.getByRole('option', {
    name: /合成记录甲/,
  })).toBeVisible();

  await searchInput(page).press('Enter');
  await expect(page.getByRole('dialog', {
    name: '命令面板',
    exact: true,
  })).toHaveCount(0);
  expect(await page.evaluate(() => window.executed))
    .toEqual(['合成记录甲']);
});

test('responses arriving after closing do not restore old results', async ({ page }) => {
  await mount(page);
  await searchInput(page).fill('待完成搜索');
  await waitForQuery(page, '待完成搜索');

  await page.getByRole('button', {
    name: '关闭命令面板',
    exact: true,
  }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.evaluate(() =>
    window.resolveSearch('待完成搜索', '不应显示的合成记录'));
  await page.evaluate(() => window.openSearch());

  await expect(page.getByRole('option', {
    name: /不应显示的合成记录/,
  })).toHaveCount(0);
  await expect(searchInput(page)).toHaveValue('');
});