import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { createPreviewServer } from '../../scripts/preview-materials.mjs';
import { reimbursementTableServer } from '../helpers/reimbursements-table-server.js';

test('production sessions open the full materials centre', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  // Inventory routes use the existing materials fixture; finance has its own
  // production API and assignment-based session contract below.
  for (const [path, title] of [
    ['/materials/return', /物资归还/],
    ['/console/materials/intake', /出入库登记/],
  ]) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(page.getByRole('heading', { name: '此项服务尚未开放', exact: true })).toHaveCount(0);
  }
});

test('production finance routes resolve sessions and assigned reviewers without inventory permissions', async ({ page }) => {
  const f = await reimbursementTableServer(), previews = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/preview/')) previews.push(request.url()); });
  try {
    await page.goto(f.origin + '/materials/reimburse');
    await expect(page.locator('[name="reimbursementName"]')).toHaveValue('合成申请人');
    for (const [role, title] of [['initial-suzhou', '财务报销'], ['final', '终审财务工作台']]) {
      f.state.username = role;
      await page.goto(f.origin + '/console/reimbursements');
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    expect(previews).toEqual([]);
  } finally { await f.close(); }
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
