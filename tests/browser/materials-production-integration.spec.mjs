import { test, expect } from '@playwright/test';
import { materialProductionServer } from '../helpers/material-production-server.js';

test('formal borrower and manager pages complete a return without any preview API or missing material endpoint', async ({ page }) => {
  const f = await materialProductionServer(), preview = [], failures = [];
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/preview/')) preview.push(r.url()); });
  page.on('response', r => { if (new URL(r.url()).pathname.startsWith('/api/public/materials/') && r.status() >= 400) failures.push(r.status()); });
  try {
    await page.goto(f.origin + '/materials/return');
    await expect(page.getByRole('heading', { name: '物资归还', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '返回财务物资广场' })).toBeVisible();
    await page.locator('[name="applicationId"]').selectOption('synthetic-overdue', { force: true });
    await page.locator('[name="quantity"]').fill('2');
    await page.getByRole('button', { name: '提交归还登记', exact: true }).click();
    await expect(page.getByText('归还登记已提交', { exact: true }).first()).toBeVisible();
    expect(f.data['物资管理'].find(row => row._id === 'synthetic-overdue')['归还件数']).toBe(0);
    f.state.role = 'manager';
    await page.goto(f.origin + '/console/materials/returns');
    await page.getByRole('button', { name: '核对归还', exact: true }).click();
    await page.getByText('已核对归还实物、数量与完好情况', { exact: true }).click();
    await expect(page.locator('[name="physicalChecked"]')).toBeChecked();
    await page.getByRole('button', { name: '核对通过并入账', exact: true }).click();
    await expect.poll(() => f.data['物资管理'].find(row => row._id === 'synthetic-overdue')['归还件数']).toBe(2);
    expect(preview).toEqual([]); expect(failures).toEqual([]);
  } finally { await f.close(); }
});

test('formal stock intake is enabled and persists one ledger entry through the production endpoint', async ({ page }) => {
  const f = await materialProductionServer(); f.state.role = 'manager';
  try {
    await page.goto(f.origin + '/console/materials/intake');
    await expect(page.locator('[name="movementReason"]')).toBeEnabled();
    await page.locator('[name="movementReason"]').selectOption('采购', { force: true });
    await page.getByText('使用扫码枪 / 手动输入编号', { exact: true }).click();
    await expect(page.locator('[name="intakeCode"]')).toBeVisible();
    await page.locator('[name="intakeCode"]').fill('NJU-RC-synthetic-stickers');
    await page.getByRole('button', { name: '定位物资', exact: true }).click();
    await expect(page.locator('.material-registration').getByText('宣传贴纸（合成）', { exact: true })).toBeVisible();
    await page.locator('[name="intakeReference"]').fill('合成采购补货');
    await page.getByRole('button', { name: '确认登记', exact: true }).click();
    await expect(page.locator('.modal')).not.toContainText('仅保存在本地');
    await page.locator('.modal').getByRole('button', { name: '确认登记', exact: true }).click();
    await expect(page.getByText('采购已登记', { exact: true })).toBeVisible();
    expect(f.data['物资流水表'].filter(row => row['操作类型'] === '入库')).toHaveLength(1);
    expect(f.requests.some(r => r.path === '/api/materials/movements' && r.method === 'POST')).toBeTruthy();
    expect(f.requests.some(r => r.path.startsWith('/api/preview/'))).toBeFalsy();
  } finally { await f.close(); }
});

test('a closed finance service displays availability without a failed config request, demo data or a submission form', async ({ page }) => {
  const f = await materialProductionServer();
  try {
    await page.goto(f.origin + '/materials/reimburse');
    await expect(page.getByText('财务报销尚未正式开放，请联系财务负责人。', { exact: true })).toBeVisible();
    await expect(page.locator('[name="reimbursementName"]')).toHaveCount(0);
    expect(f.writes).toHaveLength(0);
    expect(f.requests.some(r => r.path.startsWith('/api/preview/'))).toBeFalsy();
  } finally { await f.close(); }
});
