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

  await page.route('**/api/community/submissions/synthetic-submission/review',
    async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: succeeds ? 200 : 500,
        json: succeeds
          ? { ok: true, message: '合成审核成功' }
          : { code: 'synthetic_failure', message: '合成审核失败' },
      });
    });

  await page.route('**/api/community/submissions', (route) =>
    route.fulfill({ json: { ok: true, submissions: [] } }));

  await page.route(`**/app/console/pages/community-${version}.js`,
    (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `${sources[version]}\nexport { openSubmissionReviewDrawer };\n`,
    }));

  await page.route('**/community-review-fixture', (route) =>
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

  await page.goto('/community-review-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async (version) => {
    const { openSubmissionReviewDrawer } =
      await import(`/app/console/pages/community-${version}.js`);
    window.refreshCalls = 0;
    openSubmissionReviewDrawer({
      id: 'synthetic-submission',
      program: 'birthday',
      status: '待审核',
      actor: '合成投稿人',
      nickname: '合成昵称',
      tone: '合成语气',
      content: '合成投稿正文',
      submittedAt: '2026-10-13T00:00:00Z',
    }, {
      onDone: () => { window.refreshCalls++; },
    });
  }, version);

  return requests;
}

function submitButton(page, version) {
  return page.getByRole('button', {
    name: version === 'legacy' ? '提交审核结果' : '通过审核',
    exact: true,
  });
}

for (const version of ['legacy', 'birthday']) {
  test(`${version}: failed review preserves notes and protection`, async ({ page }) => {
    const requests = await mount(page, version, false);
    const note = page.getByLabel('审核意见', { exact: true });
    await note.fill('合成审核意见');
    const submit = submitButton(page, version);
    await submit.click();

    await expect.poll(() => requests.length).toBe(1);
    await expect(submit).toBeEnabled();
    await expect(note).toHaveValue('合成审核意见');
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
    await expect(note).toHaveValue('合成审核意见');
  });

  test(`${version}: successful review releases protection`, async ({ page }) => {
    const requests = await mount(page, version, true);
    await page.getByLabel('审核意见', { exact: true })
      .fill('合成审核意见');
    await submitButton(page, version).click();

    if (version === 'birthday') {
      await page.getByRole('button', { name: '完成', exact: true }).click();
    }

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].note).toBe('合成审核意见');
    expect(await page.evaluate(() => window.refreshCalls)).toBe(1);
  });
}

test('birthday: cancelling a member switch preserves the review', async ({ page }) => {
  await mount(page, 'birthday', false);
  const note = page.getByLabel('审核意见', { exact: true });
  await note.fill('尚未提交的合成意见');

  await page.getByRole('button', {
    name: '合成投稿人',
    exact: true,
  }).click();

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
  await expect(note).toHaveValue('尚未提交的合成意见');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect(await page.evaluate(() => window.refreshCalls)).toBe(0);
});