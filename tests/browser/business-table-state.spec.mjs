import { test, expect } from '@playwright/test';

const cases = [
  {
    name: 'public submissions',
    module: 'outreach',
    endpoint: '**/api/outreach/public-submissions',
    query: '?tab=public',
    sortKey: 'submittedAt',
    search: '合成稿件甲',
    payload: {
      ok: true,
      stats: { total: 2, pending: 2, approved: 0, returned: 0 },
      submissions: [
        {
          id: 'synthetic-submission-a',
          title: '合成稿件甲',
          category: '文字稿件',
          signature: '合成署名甲',
          contact: '合成联系人甲',
          status: '待审核',
          submittedAt: '2026-10-10T00:00:00Z',
        },
        {
          id: 'synthetic-submission-b',
          title: '合成稿件乙',
          category: '文字稿件',
          signature: '合成署名乙',
          contact: '合成联系人乙',
          status: '待审核',
          submittedAt: '2026-10-11T00:00:00Z',
        },
      ],
    },
  },
  {
    name: 'hours queue',
    module: 'volunteers',
    endpoint: '**/api/volunteer/overview',
    query: '',
    sortKey: 'date',
    search: '合成活动甲',
    payload: {
      ok: true,
      source: { tables: ['合成数据表'] },
      stats: {
        approvals: 0,
        registrations: 2,
        checkins: 0,
        hoursQueue: 2,
        memberProfiles: 0,
      },
      workflow: { complete: true, verifiedCheckins: 0 },
      events: [],
      approvalQueue: [],
      recentCheckins: [],
      hoursQueue: [
        {
          id: 'synthetic-hours-a',
          activity: '合成活动甲',
          name: '合成甲',
          date: '2026-10-10',
          slot: '上午',
          position: '合成岗位',
          hours: '2',
          entryStatus: '待录入',
          status: '需核验',
        },
        {
          id: 'synthetic-hours-b',
          activity: '合成活动乙',
          name: '合成乙',
          date: '2026-10-11',
          slot: '下午',
          position: '合成岗位',
          hours: '3',
          entryStatus: '待录入',
          status: '需核验',
        },
      ],
    },
  },
];

async function mount(page, config) {
  await page.route('**/api/**', (route) => route.abort());
  await page.route(config.endpoint, (route) =>
    route.fulfill({ json: config.payload }));

  await page.route('**/business-state-fixture*', (route) =>
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
            import createPage from '/app/console/pages/${config.module}.js';
            const result = await createPage({
              query: new URLSearchParams(location.search),
            }, { refreshTodos() {} });
            document.getElementById('root').append(result.node);
          </script>
        </body></html>`,
    }));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/business-state-fixture${config.query}`);
  await expect(page.getByRole('searchbox')).toBeVisible();
}

for (const config of cases) {
  test(`${config.name}: search and sorting survive reloads and clearing`, async ({ page }) => {
    await mount(page, config);

    const header = page.locator(`th[data-key="${config.sortKey}"]`);
    await header.click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await page.getByRole('searchbox').fill(config.search);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page).toHaveURL(/Query=/);

    await page.reload();
    await expect(page.getByRole('searchbox')).toHaveValue(config.search);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText(config.search);
    await expect(page.locator(`th[data-key="${config.sortKey}"]`))
      .toHaveAttribute('aria-sort', 'ascending');

    await page.getByRole('searchbox').fill('');
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page).not.toHaveURL(/Query=/);

    await page.reload();
    await expect(page.getByRole('searchbox')).toHaveValue('');
    await expect(page.locator('tbody tr')).toHaveCount(2);
  });
}