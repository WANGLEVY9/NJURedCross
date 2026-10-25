import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { createPreviewServer } from '../../scripts/preview-materials.mjs';

test('production-like sessions keep existing materials and cannot enter preview-only workflows', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  const previewReads = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/preview/')) previewReads.push(request.url());
  });
  for (const path of ['/materials/reimburse', '/materials/return', '/console/materials/intake']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: '此项服务尚未开放', exact: true })).toBeVisible();
  }
  for (const path of ['/console/reimbursements', '/console/reimbursements/summary', '/console/reimbursements/ledger']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/console\/overview\?forbidden=finance$/);
  }
  expect(previewReads).toEqual([]);
});

test('finance reviewers cannot open formal finance pages before storage is enabled', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  const session = await (await page.request.get('/api/auth/session')).json();
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    ...session, user: { ...session.user, financePermissions: ['view'], reimbursementsEnabled: false, localPreview: false },
  } }));
  const financeReads = [];
  page.on('request', request => {
    if (/^\/api\/(?:preview\/)?reimbursements(?:\/|$)/.test(new URL(request.url()).pathname)) financeReads.push(request.url());
  });
  for (const path of ['/materials/reimburse', '/reimbursements', '/console/reimbursements', '/console/reimbursements/summary', '/console/reimbursements/ledger']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: '此项服务尚未开放', exact: true })).toBeVisible();
  }
  expect(financeReads).toEqual([]);
});

test('isolated materials preview selects the new workspace without touching production services', async ({ page }, info) => {
  const server = await createPreviewServer({ seedSyncFailure: false });
  server.listen(0);
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin + '/materials');
    await expect(page.getByRole('heading', { name: '每一件物资，都服务一场公益' })).toBeVisible();
    await page.getByRole('link').filter({ has: page.getByRole('heading', { name: '物资借用', exact: true }) }).click();
    await expect(page.getByRole('button', { name: '提交借用申请', exact: true })).toBeVisible();
    await page.goto(origin + '/console/materials');
    await expect(page.getByRole('heading', { name: '物资管理', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('isolated-materials-workspace.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
