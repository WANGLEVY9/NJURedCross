import { test, expect } from '@playwright/test';

async function mountRoster(page) {
  await page.route('**/api/**', route => route.abort());
  await page.route('**/roster-selection-fixture', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
        body: `<!doctype html>
      <html lang="zh-CN"
        data-surface="console"
        data-theme="porcelain"
        data-motion="reduced">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="/styles/tokens.css">
        <link rel="stylesheet" href="/styles/base.css">
        <link rel="stylesheet" href="/styles/components.css">
        <link rel="stylesheet" href="/styles/admin.css">
      </head>
      <body>
        <div id="root"><main id="fixture"></main></div>
        <div id="overlay-root"></div>
        <div id="toast-root"></div>
      </body>
      </html>`,
  }));
  await page.goto('/roster-selection-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { rosterPanel } =
      await import('/app/console/pages/activity-management.js');

    const event = {
      _id: 'synthetic-event',
      活动ID: 'synthetic-event',
      活动名称: '合成活动',
      状态: '报名中',
      容量: 10,
      报名页配置: '{}',
    };
    let rows = [
      {
        _id: 'a',
        姓名: '合成甲',
        学号: 'SYNTHETIC-A',
        报名状态: '待筛选',
      },
      {
        _id: 'b',
        姓名: '合成乙',
        学号: 'SYNTHETIC-B',
        报名状态: '待筛选',
      },
    ];

    window.renderSyntheticRoster = changes => {
      const host = document.getElementById('fixture');
      const previous = host.querySelector('.activity-roster');
      const viewState = previous?.getViewState();

      rows = rows.map(row => ({
        ...row,
        ...(changes?.[row._id] || {}),
      }));

      host.replaceChildren(rosterPanel(event, rows, {
        directory: [],
        directoryError: false,
        viewState,
        refresh: async () => true,
      }));
    };

    window.renderSyntheticRoster();
  });
}

test('refresh preserves eligible selections', async ({ page }) => {
  await mountRoster(page);
  await page.locator('label.check')
    .filter({
      has: page.getByRole('checkbox', {
        name: '选择 合成甲',
        exact: true,
      }),
    })
    .locator('.check__box')
    .click();
  await page.locator('label.check')
    .filter({
      has: page.getByRole('checkbox', {
        name: '选择 合成乙',
        exact: true,
      }),
    })
    .locator('.check__box')
    .click();

  await page.evaluate(() => window.renderSyntheticRoster());

  await expect(page.getByRole('checkbox', {
    name: '选择 合成甲',
    exact: true,
  })).toBeChecked();
  await expect(page.getByRole('checkbox', {
    name: '选择 合成乙',
    exact: true,
  })).toBeChecked();
});

test('refresh drops selections that are no longer eligible', async ({ page }) => {
  await mountRoster(page);
  await page.locator('label.check')
    .filter({
      has: page.getByRole('checkbox', {
        name: '选择 合成甲',
        exact: true,
      }),
    })
    .locator('.check__box')
    .click();
   await page.locator('label.check')
    .filter({
      has: page.getByRole('checkbox', {
        name: '选择 合成乙',
        exact: true,
      }),
    })
    .locator('.check__box')
    .click();

  await page.evaluate(() => window.renderSyntheticRoster({
    a: { 报名状态: '已确认' },
  }));

  const selected = await page.locator('.activity-roster').evaluate(
    node => node.getViewState().selectedIds,
  );
  expect(selected).toEqual(['b']);
  await expect(page.getByRole('checkbox', {
    name: '选择 合成乙',
    exact: true,
  })).toBeChecked();
});

async function submitSyntheticBatch(page) {
  await page.locator('label.check')
    .filter({
      has: page.getByRole('checkbox', {
        name: '选择 合成甲',
        exact: true,
      }),
    })
    .locator('.check__box')
    .click();
   await page.locator('label.check')
    .filter({
      has: page.getByRole('checkbox', {
        name: '选择 合成乙',
        exact: true,
      }),
    })
    .locator('.check__box')
    .click();

  await page.getByRole('button', {
    name: '批量拟录取',
    exact: true,
  }).click();

  await page.getByRole('button', {
    name: '保存暂定结果',
    exact: true,
  }).click();
}

test('partial acknowledgement displays individual draft outcomes', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));

  await mountRoster(page);
  const requests = [];

  await page.route('**/api/volunteer/workflow/events/synthetic-event/batch-decide',
    async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        json: { ok: true, result: { completed: ['a'] } },
      });
    },
  );

  await submitSyntheticBatch(page);

  const result = page.getByRole('dialog', {
    name: '暂定名单处理结果',
    exact: true,
  });
  await expect(result).toBeVisible();
  await expect(result.getByRole('heading', {
    name: '合成甲',
    exact: true,
  })).toBeVisible();
  await expect(result.getByRole('heading', {
    name: '合成乙',
    exact: true,
  })).toBeVisible();
  await expect(result.getByText('暂定已保存', { exact: true })).toHaveCount(1);
  await expect(result.getByText('待核对', { exact: true })).toHaveCount(2);

  expect(requests).toHaveLength(1);
  expect(requests[0].ids).toEqual(['a', 'b']);
  expect(requests[0].decision).toBe('confirm');

  expect(await page.locator('.activity-roster').evaluate(
    node => node.getViewState().selectedIds,
  )).toEqual(['b']);

  await result.getByRole('button', {
    name: '完成',
    exact: true,
  }).click();

  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  expect(browserErrors).toEqual([]);
  await expect(result).toHaveCount(0);
});

test('failed response displays reconciliation guidance and retains selection', async ({ page }) => {
  await mountRoster(page);
  await page.route(
    '**/api/volunteer/workflow/events/synthetic-event/batch-decide',
    route => route.fulfill({
      status: 503,
      json: { message: '合成服务不可用', code: 'synthetic_failure' },
    }),
  );

  await submitSyntheticBatch(page);

  const result = page.getByRole('dialog', {
    name: '暂定名单处理结果',
    exact: true,
  });
  await expect(result).toBeVisible();
  await expect(result.getByText('暂定已保存', { exact: true })).toHaveCount(0);
  await expect(result.getByText('待核对', { exact: true })).toHaveCount(3);
  await expect(result.getByText(
    '部分结果不明确，请先核对最新名单，再决定是否重试。',
    { exact: true },
  )).toBeVisible();

  expect(await page.locator('.activity-roster').evaluate(
    node => node.getViewState().selectedIds,
  )).toEqual(['a', 'b']);
});