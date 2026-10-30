import { test, expect } from '@playwright/test';
import { reimbursementTableServer } from '../helpers/reimbursements-table-server.js';

test('an inventory administrator can open the finance entry without a silent redirect or access to financial records', async ({ page }) => {
  const f = await reimbursementTableServer(), reads = [];
  f.state.username = 'material-admin';
  page.on('request', request => { reads.push(new URL(request.url()).pathname); });
  try {
    await page.goto(f.origin + '/console/materials/rooms');
    await page.getByRole('link', { name: '财务报销', exact: true }).click();
    await expect(page).toHaveURL(f.origin + '/console/reimbursements');
    await expect(page.getByText('未分配财务权限', { exact: true })).toBeVisible();
    for (const path of ['/console/reimbursements/summary', '/console/reimbursements/ledger']) {
      await page.goto(f.origin + path);
      await expect(page).toHaveURL(f.origin + path);
      await expect(page.getByText('未分配财务权限', { exact: true })).toBeVisible();
    }
    expect(reads.filter(path => ['/api/reimbursements', '/api/reimbursements/finance', '/api/reimbursements/ledger', '/api/reimbursements/summaries'].includes(path))).toEqual([]);
    expect((await page.request.get(f.origin + '/api/reimbursements')).status()).toBe(403);
    expect(f.fixture.calls).toEqual([]);
  } finally { await f.close(); }
});

test('a closed finance service explains its state on the requested console page', async ({ page }) => {
  const f = await reimbursementTableServer(); f.state.username = 'material-admin'; f.config.enabled = false;
  try {
    await page.goto(f.origin + '/console/materials/rooms');
    await page.getByRole('link', { name: '财务报销', exact: true }).click();
    await expect(page).toHaveURL(f.origin + '/console/reimbursements');
    await expect(page.getByText('财务报销尚未正式开放，请联系财务负责人。', { exact: true })).toBeVisible();
    await expect(page.getByText('未分配财务权限', { exact: true })).toBeVisible();
    expect(f.fixture.calls).toEqual([]);
  } finally { await f.close(); }
});

test('an assigned reviewer refreshes an older session projection before entering the review workspace', async ({ page }) => {
  const f = await reimbursementTableServer(); f.state.username = 'initial-suzhou'; let sessionReads = 0;
  await page.route(f.origin + '/api/auth/session', async route => {
    const response = await route.fetch(), body = await response.json();
    if (++sessionReads === 1) delete body.user.financePermissions;
    await route.fulfill({ response, json: body });
  });
  try {
    await page.goto(f.origin + '/console/reimbursements');
    await expect(page).toHaveURL(f.origin + '/console/reimbursements');
    await expect(page.getByRole('heading', { name: '报销材料审核', exact: true })).toBeVisible();
    await expect(page.getByText('未分配财务权限', { exact: true })).toHaveCount(0);
    expect(sessionReads).toBeGreaterThanOrEqual(2);
  } finally { await f.close(); }
});

test('a super-administrator can switch between initial review and the final finance workspace', async ({ page }) => {
  const f = await reimbursementTableServer(); f.state.username = 'admin';
  try {
    await page.goto(f.origin + '/console/reimbursements');
    await expect(page.getByRole('heading', { name: '终审财务工作台', exact: true })).toBeVisible();
    await page.getByRole('link', { name: '初审材料审核', exact: true }).click();
    await expect(page).toHaveURL(f.origin + '/console/reimbursements?view=initial');
    await expect(page.getByRole('heading', { name: '报销材料审核', exact: true })).toBeVisible();
    await page.getByRole('link', { name: '终审财务工作台', exact: true }).click();
    await expect(page.getByRole('heading', { name: '终审财务工作台', exact: true })).toBeVisible();
    expect(f.fixture.calls).toEqual([]);
  } finally { await f.close(); }
});
