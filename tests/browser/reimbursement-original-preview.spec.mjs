import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { reimbursementTableServer } from '../helpers/reimbursements-table-server.js';
import { checkOriginalPreview } from './reimbursement-original-preview.checks.mjs';

test('original previews load on click and release resources without disturbing review', async ({ page }) => {
  const server = await reimbursementTableServer(), errors = [];
  const pdf = await PDFDocument.create(); pdf.addPage([300, 200]);
  const pdfBytes = Buffer.from(await pdf.save());
  const image = await readFile(new URL('../fixtures/reimbursement-ocr-synthetic.png', import.meta.url));
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/__preview-files/*', route => route.fulfill({
      contentType: route.request().url().endsWith('.png') ? 'image/png' : 'application/pdf',
      body: route.request().url().endsWith('.png') ? image : pdfBytes,
    }));
    await page.goto(server.origin + '/materials/reimburse');
    await expect(page.locator('.material-application')).toBeVisible();
    // Isolate the component while retaining the real styles, overlay root and browser.
    await page.evaluate(() => { document.getElementById('root').replaceChildren(); document.documentElement.dataset.motion = 'reduced'; });
    const result = await page.evaluate(checkOriginalPreview);
    expect(result.passed.length).toBeGreaterThan(20);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
