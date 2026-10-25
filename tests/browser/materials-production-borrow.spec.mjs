import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { publicMaterialsTestServer } from '../helpers/public-materials-server.js';

async function host() {
  const f = publicMaterialsTestServer(); f.server.listen(0, '127.0.0.1'); await once(f.server, 'listening');
  return { ...f, origin: `http://127.0.0.1:${f.server.address().port}`,
    async close() { f.server.closeAllConnections(); await new Promise(resolve => f.server.close(resolve)); f.fixture.store.close(); } };
}

test('ordinary production member enters inventory-linked borrowing while finance remains closed', async ({ page }, info) => {
  const f = await host(), errors = [], previewReads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/preview/')) previewReads.push(request.url()); });
  try {
    await page.goto(f.origin + '/materials');
    await expect(page.getByRole('heading', { name: '每一件物资，都服务一场公益' })).toBeVisible();
    await expect(page.locator('.square-card[href="/materials/reimburse"]')).toHaveCount(0);
    await page.locator('.square-card[href="/materials/borrow"]').click();
    await expect(page.getByRole('button', { name: '提交借用申请', exact: true })).toBeVisible();
    await expect(page.locator('[name="items"]')).toHaveCount(0);
    await expect(page.locator('[name="name"]')).toHaveValue('合成申请人');
    await expect(page.locator('[name="name"]')).toHaveAttribute('readonly', '');
    await page.getByRole('combobox', { name: '物资种类', exact: true }).click();
    await page.getByRole('option', { name: /合成急救箱/ }).click();
    await expect(page.getByText(/当前剩余 8 箱/)).toBeVisible();
    await page.locator('[name="quantity"]').fill('2');
    await page.locator('[name="purpose"]').fill('合成志愿活动');
    await page.locator('[name="plannedBorrowDate"]').fill('2099-10-21');
    await page.locator('[name="plannedReturnDate"]').fill('2099-10-22');
    await page.getByText('我已阅读并承担借用与归还责任', { exact: true }).click();
    await page.screenshot({ path: info.outputPath('production-borrow-form.png'), fullPage: true });
    await page.getByRole('button', { name: '提交借用申请', exact: true }).click();
    await expect(page.getByText('借用申请已进入审批队列', { exact: true })).toBeVisible();
    expect(f.fixture.applications).toHaveLength(1);
    expect(f.fixture.applications[0]['可借用物资'][0].row_id).toBe('synthetic-kit');
    for (const path of ['/materials/reimburse', '/materials/return', '/reimbursements']) {
      await page.goto(f.origin + path);
      await expect(page.getByRole('heading', { name: '此项服务尚未开放', exact: true })).toBeVisible();
    }
    expect(previewReads).toEqual([]); expect(errors).toEqual([]);
  } finally { await f.close(); }
});

test('non-internal department cannot submit even with a valid account', async ({ page }) => {
  const f = await host(); f.fixture.profiles[0]['部门'] = '博爱';
  try {
    await page.goto(f.origin + '/materials/borrow');
    await expect(page.getByText('暂不能申请借用', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '提交借用申请', exact: true })).toHaveCount(0);
    expect(f.fixture.writes).toEqual([]);
  } finally { await f.close(); }
});

test('known-row link failure keeps the same form and safely resumes on retry', async ({ page }) => {
  const f = await host(), link = f.fixture.client.updateLink;
  f.fixture.client.updateLink = async () => { throw Error('synthetic connection failure'); };
  try {
    await page.goto(f.origin + '/materials/borrow');
    await page.getByRole('combobox', { name: '物资种类', exact: true }).click();
    await page.getByRole('option', { name: /合成急救箱/ }).click();
    await page.locator('[name="purpose"]').fill('合成志愿活动');
    await page.locator('[name="plannedBorrowDate"]').fill('2099-10-21');
    await page.locator('[name="plannedReturnDate"]').fill('2099-10-22');
    await page.getByText('我已阅读并承担借用与归还责任', { exact: true }).click();
    await page.getByRole('button', { name: '提交借用申请', exact: true }).click();
    await expect(page.getByRole('main').locator('[role="alert"]').getByText(/物资关联尚待确认/)).toBeVisible();
    await expect(page.locator('select[name="materialId"]')).toHaveValue('synthetic-kit');
    await expect(page.locator('[name="purpose"]')).toHaveValue('合成志愿活动');
    f.fixture.client.updateLink = link;
    await page.getByRole('button', { name: '提交借用申请', exact: true }).click();
    await expect(page.getByText('借用申请已进入审批队列', { exact: true })).toBeVisible();
    expect(f.fixture.applications).toHaveLength(1);
  } finally { await f.close(); }
});
