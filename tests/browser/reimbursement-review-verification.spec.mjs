import { test, expect } from '@playwright/test';
import { reimbursementTableServer } from '../helpers/reimbursements-table-server.js';
import { checkReviewVerification } from './reimbursement-review-verification.checks.mjs';

test('initial review shows compact cross checks with evidence collapsed by default', async ({ page }) => {
  const f = await reimbursementTableServer(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(f.origin + '/materials/reimburse');
    await expect(page.locator('.material-application')).toBeVisible();
    await page.evaluate(() => { document.getElementById('root').replaceChildren(); document.documentElement.dataset.motion = 'reduced'; });
    const result = await page.evaluate(checkReviewVerification);
    expect(result.passed.length).toBeGreaterThan(15); expect(errors).toEqual([]);
  } finally { await f.close(); }
});
