import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { reimbursementTableServer } from '../helpers/reimbursements-table-server.js';
import { checkReturnFeedback } from './reimbursement-return-feedback.checks.mjs';

test('return requires an opinion and shows an anchored red message by the button', async ({ page }) => {
  const f = await reimbursementTableServer(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const service = f.fixture.makeService({ workflowVersion: 3 });
    const pdf = await PDFDocument.create(); pdf.addPage([300, 200]);
    const { bundle } = await service.preprocess({ id: 'synthetic-owner' }, [{ name: 'synthetic.pdf', bytes: Buffer.from(await pdf.save()), kind: 'invoice', expenseItemId: 'a' }]);
    await service.summaries.saveActivity({ id: 'synthetic-final', financePermissions: ['final'] }, { id: 'synthetic-event', name: '合成活动', campus: '苏州', date: '2026-10-20', location: '合成地点', participantCount: 1, description: '隔离验证' });
    await service.submit({ id: 'synthetic-owner' }, { name: '合成申请人', amount: '15.00', purpose: '合成退回验证', bankAccount: '0000000000000000',
      activityId: 'synthetic-event', expenseItems: [{ id: 'a', label: '合成物资', amount: '15.00' }], bundleId: bundle.id, idempotencyKey: bundle.id });
    f.state.username = 'initial-suzhou';
    await page.goto(f.origin + '/console/reimbursements'); await expect(page.locator('.material-finance-row')).toBeVisible();
    const result = await page.evaluate(checkReturnFeedback);
    expect(result.passed.length).toBeGreaterThan(10); expect(errors).toEqual([]);
  } finally { await f.close(); }
});
