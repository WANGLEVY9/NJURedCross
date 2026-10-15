import { test, expect } from '@playwright/test';

async function mount(page, version, query = '') {
  await page.route('**/api/**', (route) => route.abort());

  await page.route('**/api/community/interests', (route) =>
    route.fulfill({
      json: {
        ok: true,
        stats: { total: 2, pending: 0, accepted: 2, withdrawn: 0 },
        interests: [
          {
            id: 'synthetic-a',
            nickname: '合成甲',
            realName: '合成甲',
            studentId: 'SYNTHETIC-A',
            program: 'birthday',
            frequency: 'weekly',
            status: '已确认',
            displayStatus: '正常',
            campus: '仙林',
            submittedAt: '2026-10-10T00:00:00Z',
          },
          {
            id: 'synthetic-b',
            nickname: '合成乙',
            realName: '合成乙',
            studentId: 'SYNTHETIC-B',
            program: 'birthday',
            frequency: 'weekly',
            status: '已确认',
            displayStatus: '正常',
            campus: '鼓楼',
            submittedAt: '2026-10-11T00:00:00Z',
          },
        ],
      },
    }));

  await page.route('**/api/community/warmth-blacklist', (route) =>
    route.fulfill({ json: { ok: true, entries: [] } }));

  await page.route('**/api/community/submissions', (route) =>
    route.fulfill({
      json: {
        ok: true,
        stats: { total: 2, pending: 1, approved: 1, returned: 0, rejected: 0 },
        submissions: [
          {
            id: 'synthetic-submission-a',
            program: 'birthday',
            content: '合成待审核正文',
            actor: '合成甲',
            nickname: '合成甲',
            tone: '温暖',
            status: '待审核',
            submittedAt: '2026-10-10T00:00:00Z',
          },
          {
            id: 'synthetic-submission-b',
            program: 'birthday',
            content: '合成已通过正文',
            actor: '合成乙',
            nickname: '合成乙',
            tone: '温暖',
            status: '已通过',
            submittedAt: '2026-10-11T00:00:00Z',
          },
        ],
      },
    }));

  await page.route('**/community-state-fixture*', (route) =>
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
          <div id="root"></div>
          <div id="overlay-root"></div>
          <div id="toast-root"></div>
          <script type="module">
            import createPage from '/app/console/pages/community-${version}.js';
            const result = await createPage({
              query: new URLSearchParams(location.search),
            }, { refreshTodos() {} });
            document.getElementById('root').append(result.node);
          </script>
        </body></html>`,
    }));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/community-state-fixture${query}`);
  await expect(page.getByRole('searchbox')).toBeVisible();
}

for (const version of ['legacy', 'birthday']) {
  test(`${version}: search and sorting survive a page reload`, async ({ page }) => {
    await mount(page, version);
    const key = version === 'legacy' ? 'nickname' : 'realName';
    const header = page.locator(`th[data-key="${key}"]`);
    await header.click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');

    await page.getByRole('searchbox').fill('合成甲');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page).toHaveURL(/Query=/);

    await page.reload();
    await expect(page.getByRole('searchbox')).toHaveValue('合成甲');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('合成甲');
    await expect(page.locator(`th[data-key="${key}"]`))
      .toHaveAttribute('aria-sort', 'ascending');
  });

  test(`${version}: submission tab and its search survive a reload`, async ({ page }) => {
    await mount(page, version);
    await page.getByRole(version === 'legacy' ? 'tab' : 'radio', {
      name: '投稿池审核',
      exact: true,
    }).click();

    await expect(page).toHaveURL(/tab=submissions/);
    await page.getByRole('searchbox').fill('合成待审核正文');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page).toHaveURL(/Query=/);

    await page.reload();
    await expect(page.getByRole('searchbox'))
      .toHaveValue('合成待审核正文');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('合成待审核正文');
  });
}

test('birthday: approved submissions group survives a reload', async ({ page }) => {
  await mount(page, 'birthday', '?tab=submissions');
  await page.getByRole('radio', { name: /^已通过（/ }).click();
  await expect(page).toHaveURL(/submissionsView=approved/);
  await expect(page.locator('tbody tr')).toContainText('合成已通过正文');

  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('合成已通过正文');
  await expect(page.getByRole('radio', { name: /^已通过（/ }))
    .toHaveAttribute('aria-checked', 'true');
});