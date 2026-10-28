import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { reimbursementTableServer } from '../helpers/reimbursements-table-server.js';
import { checkInitialEditing } from './reimbursement-initial-editing.checks.mjs';

test('initial reviewer edits application fields, changes campus and sends the saved correction to final review', async ({ page }) => {
  const f = await reimbursementTableServer(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const service = f.fixture.makeService({ workflowVersion: 3 });
    for (const [id, campus] of [['synthetic-event', '苏州'], ['synthetic-other', '仙林']])
      await service.summaries.saveActivity({ id: 'synthetic-final', financePermissions: ['final'] }, { id, campus, name: `${campus}原活动`, date: '2026-10-20', location: '合成地点', participantCount: 1, description: '隔离初审修改' });
    const pdf = await PDFDocument.create(); pdf.addPage([300, 200]);
    const { bundle } = await service.preprocess({ id: 'synthetic-owner' }, [{ name: 'synthetic.pdf', bytes: Buffer.from(await pdf.save()), kind: 'invoice', expenseItemId: 'a' }]);
    await service.submit({ id: 'synthetic-owner' }, { name: '合成申请人', amount: '20.00', purpose: '隔离初审修改 desktop', activityId: 'synthetic-event', expenseDate: '2026-10-20',
      expenseItems: [{ id: 'a', label: '原物资', amount: '20.00', note: '原用途' }], bundleId: bundle.id, idempotencyKey: bundle.id });
    await page.route('**/__initial-edit-role?*', route => {
      const user = new URL(route.request().url()).searchParams.get('user');
      if (!['owner', 'initial-suzhou'].includes(user)) return route.abort();
      f.state.username = user; return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto(f.origin + '/materials/reimburse'); await expect(page.locator('.material-application')).toBeVisible();
    await page.locator('link[href^="/styles/app.css"]').evaluate(link => { link.id = 'qa-surface-style'; });
    const result = await page.evaluate(checkInitialEditing);
    expect(result.passed.length).toBe(20); expect(errors).toEqual([]);
  } finally { await f.close(); }
});
