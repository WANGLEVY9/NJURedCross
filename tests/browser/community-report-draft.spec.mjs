import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../../public/app/console/pages/community-birthday.js', import.meta.url),
  'utf8',
);
const start = source.indexOf('  function openReportDrawer(');
const end = source.indexOf('\n  function renderTab()', start);
if (start < 0 || end <= start) throw new Error('未找到举报详情函数');

const fixtureExport = `
export function openSyntheticReport(status) {
  ${source.slice(start, end)}
  openReportDrawer({
    id: 'synthetic-report',
    submissionId: 'synthetic-submission',
    status,
    resolutionNote: status === '待处理' ? '' : '原始合成处理意见',
    reporterStudentId: 'SYNTHETIC-REPORTER',
    authorRef: 'synthetic-author',
    authorReportCount: 0,
    content: '合成祝福正文',
    reason: '合成举报理由',
    submittedAt: '2026-10-13T00:00:00Z',
  }, {
    onDone: () => { window.refreshCalls++; },
  });
}
`;

async function mount(page, succeeds = false, status = '待处理') {
  const requests = [];
  await page.route('**/api/**', (route) => route.abort());

  await page.route('**/api/community/warmth-reports/synthetic-report/*',
    async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      await route.fulfill({
        status: succeeds ? 200 : 500,
        json: succeeds
          ? {
              ok: true,
              report: {
                status: '已驳回',
                resolutionNote: body.note,
              },
            }
          : { code: 'synthetic_failure', message: '合成处理失败' },
      });
    });

  await page.route('**/api/community/warmth-reports', (route) =>
    route.fulfill({ json: { ok: true, reports: [] } }));

  await page.route('**/app/console/pages/community-birthday.js',
    (route) => route.fulfill({
      contentType: 'text/javascript',
      body: source + fixtureExport,
    }));

  await page.route('**/community-report-fixture', (route) =>
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

  await page.goto('/community-report-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async (status) => {
    window.refreshCalls = 0;
    const { openSyntheticReport } =
      await import('/app/console/pages/community-birthday.js');
    openSyntheticReport(status);
  }, status);
  return requests;
}

async function expectWarning(page) {
  const warning = page.getByRole('dialog', {
    name: '放弃未保存的修改？',
    exact: true,
  });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: '取消', exact: true }).click();
  await expect(warning).toHaveCount(0);
}

test('failed report handling preserves notes and close protection', async ({ page }) => {
  const requests = await mount(page);
  const note = page.getByLabel('处理意见', { exact: true });
  await note.fill('合成处理意见');
  const submit = page.getByRole('button', { name: '驳回举报', exact: true });
  await submit.click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(submit).toBeEnabled();
  await expect(note).toHaveValue('合成处理意见');

  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expectWarning(page);
  await expect(note).toHaveValue('合成处理意见');
});

test('successful report handling releases protection', async ({ page }) => {
  const requests = await mount(page, true);
  await page.getByLabel('处理意见', { exact: true }).fill('合成处理意见');
  await page.getByRole('button', { name: '驳回举报', exact: true }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(requests[0].note).toBe('合成处理意见');
  expect(await page.evaluate(() => window.refreshCalls)).toBe(1);
});

test('cancelling an edit asks before discarding changed notes', async ({ page }) => {
  await mount(page, false, '已驳回');
  await page.getByRole('button', { name: '编辑处理', exact: true }).click();
  const note = page.getByLabel('处理意见', { exact: true });
  await note.fill('修改后的合成意见');
  await page.getByRole('button', { name: '取消', exact: true }).click();

  await expectWarning(page);
  await expect(note).toHaveValue('修改后的合成意见');
});

test('failed edits retain the updated notes', async ({ page }) => {
  const requests = await mount(page, false, '已驳回');
  await page.getByRole('button', { name: '编辑处理', exact: true }).click();
  const note = page.getByLabel('处理意见', { exact: true });
  await note.fill('修改后的合成意见');
  const save = page.getByRole('button', { name: '保存修改', exact: true });
  await save.click();

  await expect.poll(() => requests.length).toBe(1);
  await expect(save).toBeEnabled();
  await expect(note).toHaveValue('修改后的合成意见');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expectWarning(page);
});

test('cancelling a member switch preserves the report form', async ({ page }) => {
  await mount(page);
  const note = page.getByLabel('处理意见', { exact: true });
  await note.fill('未提交的合成意见');
  await page.getByRole('button', {
    name: '被举报人资料',
    exact: true,
  }).click();

  await expectWarning(page);
  await expect(note).toHaveValue('未提交的合成意见');
  await expect(page.getByRole('dialog')).toHaveCount(1);
});