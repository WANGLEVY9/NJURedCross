import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { reimbursementTableServer } from '../helpers/reimbursements-table-server.js';
import { renderTestSummary } from '../helpers/reimbursement-summary-renderer.js';

async function selectActivity(page) {
  await page.locator('[name="reimbursementCampus"]').selectOption('苏州', { force: true });
  await page.locator('[name="reimbursementActivityCategory"]').selectOption('未分类', { force: true });
  await page.locator('[name="reimbursementActivity"]').selectOption('synthetic-event', { force: true });
}
async function railExpense(page, index) {
  await page.locator(`[name="expenseCategory${index}"]`).selectOption('火车票/高铁票', { force: true });
  await page.locator(`[name="expenseRail${index}FromStation"]`).fill('南京南');
  await page.locator(`[name="expenseRail${index}ToStation"]`).fill('上海虹桥');
}

test('configured production applicant submits to Table/Box adapters and recovers after service recreation', async ({ page }) => {
  const f = await reimbursementTableServer(), errors = [], preview = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/preview/')) preview.push(request.url()); });
  try {
    await page.goto(f.origin + '/materials'); await page.locator('.square-card[href="/materials/reimburse"]').click();
    await expect(page.locator('[name="reimbursementName"]')).toHaveValue('合成申请人');
    await expect(page.locator('[name="reimbursementName"]')).toHaveAttribute('readonly', '');
    await selectActivity(page);
    await expect(page.locator('[name="expenseDate"]')).not.toHaveValue('');
    await page.locator('[name="expenseDate"]').fill('2026-10-18');
    await expect(page.locator('[name="reimbursementBankAccount"]')).toHaveCount(0);
    await railExpense(page, 0); await page.locator('[name="expenseLabel0"]').fill('合成条目');
    await page.locator('[name="expenseAmount0"]').fill('15.00'); await page.locator('[name="reimbursementPurpose"]').fill('合成报销闭环');
    const pdf = await PDFDocument.create(); pdf.addPage([300, 200]);
    await page.locator('input[type="file"]').first().setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
    await page.locator('[name="reimbursementSingleOrder"]').check({ force: true });
    await page.getByRole('button', { name: '提交审核申请', exact: true }).click();
    await expect(page.getByText('申请已进入审核队列', { exact: true })).toBeVisible();
    f.reopen(); await page.reload(); await expect(page.getByText('合成报销闭环', { exact: true })).toBeVisible();
    expect(f.fixture.rows.get(f.fixture.tables.requests)).toHaveLength(1);
    expect(f.fixture.box.calls.some(call => call.endpoint === '/seafhttp/upload-api/synthetic' && call.method === 'POST')).toBeTruthy();
    expect((await f.fixture.makeService({ workflowVersion: 3 }).list({ id: 'synthetic-owner' })).requests[0].expenseDate).toBe('2026-10-18');
    expect(preview).toEqual([]); expect(errors).toEqual([]);
  } finally { await f.close(); }
});

test('production admin can open the review, activity summary and ledger pages', async ({ page }) => {
  const f = await reimbursementTableServer(), errors = []; f.state.username = 'final';
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(f.origin + '/console/reimbursements');
    await expect(page.getByRole('heading', { name: '终审财务工作台', exact: true })).toBeVisible();
    await page.goto(f.origin + '/console/reimbursements/summary?activity=synthetic-event');
    await expect(page.getByRole('button', { name: '编辑活动资料', exact: true })).toBeVisible();
    await page.goto(f.origin + '/console/reimbursements/ledger'); await expect(page.getByRole('button', { name: '导出 Excel', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await f.close(); }
});

test('assigned initial reviewer opens the merged PDF; final reviewer sorts and previews one activity before approving it', async ({ page }, testInfo) => {
  const f = await reimbursementTableServer(), errors = [], materialReads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/bundles\/[^/]+\/merged|\/summaries\/[^/]+\/packet/.test(request.url())) materialReads.push(request.url()); });
  try {
    const service = f.fixture.makeService({ workflowVersion: 3, generateSummary: renderTestSummary });
    const owner = { id: 'synthetic-owner' }, initial = { id: 'synthetic-initial-suzhou', financePermissions: ['initial'], financeRegion: 'initial-suzhou' },
      final = { id: 'synthetic-final', financePermissions: ['final', 'view'] };
    await service.summaries.saveActivity(final, { id: 'synthetic-event', name: '合成活动', date: '2026-10-20', campus: '苏州',
      location: '合成地点', participantCount: 10, description: '仅用于隔离验证的活动资料' });
    const requests = [];
    for (const [index, width] of [300, 350].entries()) {
      const pdf = await PDFDocument.create(); pdf.addPage([width, 200]);
      const { bundle } = await service.preprocess(owner, [{ name: `proof-${index}.pdf`, bytes: Buffer.from(await pdf.save()), kind: 'invoice', expenseItemId: 'item' }]);
      requests.push((await service.submit(owner, { name: '合成申请人', purpose: '合成报销', amount: '15.00', bankAccount: '0000000000000000',
        activityId: 'synthetic-event', expenseItems: [{ id: 'item', label: `合成条目${index + 1}`, amount: '15.00' }], bundleId: bundle.id, idempotencyKey: bundle.id })).request);
    }
    await service.review(initial, requests[1].id, { action: 'initial-approve', revision: requests[1].revision, stateVersion: requests[1].stateVersion, materialsChecked: true });
    f.state.username = 'initial-other';
    await page.goto(f.origin + '/console/reimbursements'); await expect(page.getByText('当前没有此状态的申请', { exact: true })).toBeVisible();
    f.state.username = 'initial-suzhou';
    await page.goto(f.origin + `/console/reimbursements?request=${requests[0].id}`);
    await expect(page.getByRole('button', { name: '初审通过并送复审', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '生成按项目合并材料', exact: true })).toHaveCount(0);
    await expect(page.locator('.material-bundle .material-pdf canvas').first()).toBeVisible();
    await page.locator('label.check').filter({ has: page.locator('[name="materialsChecked"]') }).click();
    await page.getByRole('button', { name: '初审通过并送复审', exact: true }).click();
    await page.getByRole('button', { name: '确认通过', exact: true }).click();
    await expect(page.getByRole('button', { name: '初审通过并送复审', exact: true })).toHaveCount(0);
    expect(materialReads.some(url => url.includes('/merged'))).toBeTruthy();
    f.state.username = 'final';
    await page.goto(f.origin + '/console/reimbursements/summary?activity=synthetic-event');
    await expect(page.locator('[name="summaryHandlerName"]')).toHaveValue('顾语涵'); await page.locator('[name="summaryHandlerPhone"]').fill('SYNTHETIC');
    await expect(page.locator('tr[data-summary-item]')).toHaveCount(2);
    const firstText = await page.locator('tr[data-summary-item]').first().innerText();
    await page.locator('tr[data-summary-item]').last().getByRole('button', { name: /^上移/ }).click();
    expect(await page.locator('tr[data-summary-item]').first().innerText()).not.toEqual(firstText);
    await page.getByRole('button', { name: '生成报销单和合并材料', exact: true }).click();
    await expect(page.getByText('完整 PDF 已生成供核对，尚未终审通过。', { exact: true })).toBeVisible();
    await expect(page.locator('.material-pdf canvas').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('activity-review.png'), fullPage: true });
    expect((await service.get(owner, requests[0].id)).request.paymentStatus).toBe('not-ready');
    await page.locator('label.check').filter({ has: page.locator('[name="activityFinalChecked"]') }).click();
    await page.locator('label.check').filter({ has: page.locator('[name="activityFinalScope"]') }).click();
    await page.getByRole('button', { name: '终审通过，进入待打款', exact: true }).click();
    await page.getByRole('button', { name: '确认终审通过', exact: true }).click();
    await expect(page.getByRole('button', { name: '终审通过，进入待打款', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await service.get(owner, requests[0].id)).request.paymentStatus).toBe('pending');
    expect(materialReads.some(url => url.includes('/packet'))).toBeTruthy(); expect(errors).toEqual([]);
    expect(f.fixture.box.calls.some(call => call.endpoint === '/seafhttp/files/synthetic')).toBeTruthy();
    expect([...f.fixture.box.directories].some(path => path.endsWith(' (1)'))).toBeFalsy();
  } finally { await f.close(); }
});

test('unassigned invoices show a bottom reminder before any upload, then clear after all associations are corrected', async ({ page }) => {
  const f = await reimbursementTableServer(), posts = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/reimbursements')) posts.push(request.url()); });
  try {
    await page.goto(f.origin + '/materials/reimburse');
    await selectActivity(page);
    await expect(page.locator('[name="reimbursementBankAccount"]')).toHaveCount(0);
    await page.locator('[name="reimbursementPurpose"]').fill('合成发票关联核验');
    await page.getByRole('button', { name: '添加支出项目', exact: true }).click();
    for (let index = 0; index < 2; index++) {
      await railExpense(page, index);
      await page.locator(`[name="expenseLabel${index}"]`).fill(`合成项目${index + 1}`);
      await page.locator(`[name="expenseAmount${index}"]`).fill('1.00');
    }
    const pdf = await PDFDocument.create(); pdf.addPage([300, 200]); const bytes = Buffer.from(await pdf.save());
    await page.locator('#reimbursement-invoice').setInputFiles(['a.pdf', 'b.pdf'].map(name => ({ name, mimeType: 'application/pdf', buffer: bytes })));
    await page.locator('[name="reimbursementSingleOrder"]').check({ force: true });
    const submit = page.getByRole('button', { name: '提交审核申请', exact: true }), feedback = page.locator('.material-submit-feedback');
    await submit.click(); await expect(feedback.locator('.notice--error')).toBeVisible();
    expect(posts).toEqual([]); expect(f.fixture.objects.size).toBe(0);
    expect(await feedback.evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector('.material-application > footer')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBeTruthy();
    await page.locator('select[name="materialExpense0"]').selectOption('1', { force: true }); await expect(feedback).toBeVisible();
    await page.locator('select[name="materialExpense1"]').selectOption('2', { force: true }); await expect(feedback).toBeHidden();
    await submit.click(); await expect(page.getByText('申请已进入审核队列', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    expect(f.fixture.objects.size).toBeGreaterThan(0); expect(errors).toEqual([]);
  } finally { await f.close(); }
});

test('assigned reviewers automatically land on their stage and region; final reviewer exports both Excel formats', async ({ page }) => {
  const f = await reimbursementTableServer(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const service = f.fixture.makeService({ workflowVersion: 3, generateSummary: renderTestSummary }), owner = { id: 'synthetic-owner' };
    const final = { id: 'synthetic-final', financePermissions: ['final', 'view'] };
    const initial = { id: 'synthetic-initial-suzhou', financePermissions: ['initial'], financeRegion: 'initial-suzhou' };
    for (const [id, campus] of [['synthetic-event', '苏州'], ['synthetic-other-event', '仙林']]) {
      await service.summaries.saveActivity(final, { id, name: `${campus}合成活动`, campus, date: '2026-10-20', location: '合成地点', participantCount: 10, description: '隔离角色验证' });
    }
    const seeded = [];
    for (const [index, purpose, activityId] of [[0, '苏州待初审', 'synthetic-event'], [1, '南京待初审', 'synthetic-other-event'], [2, '苏州待终审', 'synthetic-event']]) {
      const pdf = await PDFDocument.create(); pdf.addPage([300 + index, 200]);
      const { bundle } = await service.preprocess(owner, [{ name: `synthetic-${index}.pdf`, bytes: Buffer.from(await pdf.save()), kind: 'invoice', expenseItemId: 'item' }]);
      seeded.push((await service.submit(owner, { bundleId: bundle.id, name: '合成申请人', bankAccount: '0000000000000000', purpose,
        amount: '15.00', activityId, expenseItems: [{ id: 'item', label: purpose, amount: '15.00' }], idempotencyKey: bundle.id })).request);
    }
    const request = seeded[2]; await service.review(initial, request.id, { action: 'initial-approve', revision: request.revision, stateVersion: request.stateVersion, materialsChecked: true });
    for (const [user, wanted, hidden, filter] of [
      ['initial-suzhou', '苏州待初审', ['南京待初审', '苏州待终审'], 'pending'],
      ['initial-other', '南京待初审', ['苏州待初审', '苏州待终审'], 'pending'],
    ]) {
      f.state.username = user; await page.goto(f.origin + '/console/reimbursements');
      await expect(page.locator('[name="reviewStatus"]')).toHaveValue(filter);
      await expect(page.getByText(wanted, { exact: true })).toBeVisible();
      for (const text of hidden) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
      if (user !== 'final') await expect(page.getByRole('link', { name: '活动报销汇总', exact: true })).toBeHidden();
    }
    f.state.username = 'final'; await page.goto(f.origin + '/console/reimbursements');
    await expect(page.getByRole('heading', { name: '终审财务工作台', exact: true })).toBeVisible();
    await page.locator('[name="financeState"]').selectOption('final_pending', { force: true });
    await expect(page.getByText('苏州待终审', { exact: true })).toBeVisible();
    await expect(page.getByText('苏州待初审', { exact: true })).toHaveCount(0);
    await expect(page.getByText('南京待初审', { exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Excel 总表与明细导出', exact: true }).click();
    for (const [mode, filename] of [['requests', '报销总表.xlsx'], ['items', '报销项目及发票明细.xlsx']]) {
      await page.locator('[name="ledgerExportMode"]').selectOption(mode, { force: true });
      const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
      const download = await downloading; expect(download.suggestedFilename()).toBe(filename); expect(await download.failure()).toBeNull();
      const stream = await download.createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk);
      expect(Buffer.concat(chunks).subarray(0, 2).toString()).toBe('PK');
    }
    expect(errors).toEqual([]);
  } finally { await f.close(); }
});
