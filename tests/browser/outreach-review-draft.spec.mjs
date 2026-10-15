import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../../public/app/console/pages/outreach.js', import.meta.url),
  'utf8',
);

async function mount(page, succeeds = false) {
  await page.route('**/api/**', (route) => route.abort());

  await page.route('**/api/outreach/reviews/synthetic-review/chain',
    (route) => route.fulfill({
      json: {
        ok: true,
        chain: {
          passed: 0,
          total: 1,
          done: false,
          canReturn: true,
          category: '合成栏目',
          current: { level: 1, name: '合成审核人' },
          steps: [{ level: 1, name: '合成审核人', done: false }],
        },
      },
    }));

  await page.route('**/api/outreach/checklist',
    (route) => route.fulfill({
      json: {
        ok: true,
        checklist: [{
          id: 'synthetic-check',
          category: '合成检查组',
          item: '合成检查项',
          standard: '合成检查标准',
        }],
      },
    }));

  await page.route('**/api/outreach/assignees*',
    (route) => route.fulfill({
      json: {
        ok: true,
        liaison: { name: '合成对接人' },
        reviewer: { name: '合成审核人' },
      },
    }));

  await page.route('**/app/console/pages/outreach.js',
    (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `${source}\nexport { openReviewDrawer };\n`,
    }));

  await page.route('**/outreach-review-fixture',
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

  await page.goto('/outreach-review-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async (succeeds) => {
    const { openReviewDrawer } =
      await import('/app/console/pages/outreach.js');
    window.reviewCalls = [];

    openReviewDrawer({
      eyebrow: '合成审核',
      title: '合成稿件',
      meta: null,
      content: '合成正文',
      reviewFlow: {
        contentId: 'synthetic-review',
        category: '合成栏目',
      },
      onSubmit: async (payload) => {
        window.reviewCalls.push(payload);
        if (!succeeds) throw new Error('合成提交失败');
        return { ok: true, message: '合成审核成功' };
      },
    });
  }, succeeds);

  await expect(page.getByText('本次审核责任人（按栏目自动匹配）', {
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole('checkbox', {
    name: /^合成检查项/,
  })).toHaveCount(1);
}

async function checkItem(page) {
  const checkbox = page.getByRole('checkbox', {
    name: /^合成检查项/,
  });
  await page.locator('label.check')
    .filter({ has: checkbox })
    .locator('.check__box')
    .click();
  await expect(checkbox).toBeChecked();
}

test('loading review fields does not create a false unsaved warning', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('checklist changes alone trigger unsaved protection', async ({ page }) => {
  await mount(page);
  await checkItem(page);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog', {
    name: '放弃未保存的修改？',
    exact: true,
  })).toBeVisible();
});

test('failed review preserves notes, checklist and opinion rows', async ({ page }) => {
  await mount(page);
  await checkItem(page);
  await page.getByLabel('审核意见', { exact: true }).fill('合成审核意见');
  await page.getByRole('button', {
    name: '添加一条意见',
    exact: true,
  }).click();
  await page.getByLabel('位置', { exact: true }).fill('第 1 段');
  await page.getByLabel('问题描述', { exact: true }).fill('合成问题');
  await page.getByLabel('修改要求', { exact: true }).fill('合成修改要求');

  const submit = page.getByRole('button', {
    name: '提交审核结果',
    exact: true,
  });
  await submit.click();
  await expect.poll(() =>
    page.evaluate(() => window.reviewCalls.length)).toBe(1);
  await expect(submit).toBeEnabled();

  await expect(page.getByLabel('审核意见', { exact: true }))
    .toHaveValue('合成审核意见');
  await expect(page.getByLabel('问题描述', { exact: true }))
    .toHaveValue('合成问题');
  await expect(page.getByRole('checkbox', {
    name: /^合成检查项/,
  })).toBeChecked();

  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog', {
    name: '放弃未保存的修改？',
    exact: true,
  })).toBeVisible();
});

test('successful review closes without a discard warning', async ({ page }) => {
  await mount(page, true);
  await checkItem(page);
  await page.getByLabel('审核意见', { exact: true }).fill('合成审核意见');
  await page.getByRole('button', {
    name: '提交审核结果',
    exact: true,
  }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  const calls = await page.evaluate(() => window.reviewCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].note).toBe('合成审核意见');
  expect(calls[0].checklists[0].id).toBe('synthetic-check');
});