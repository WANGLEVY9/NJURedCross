import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { reimbursementTableServer } from './helpers/reimbursements-table-server.js';
import { processLocalAnalysis } from '../lib/reimbursements/analysis-processor.js';

test('interactive Table/Box preview can run actual OCR instead of the unit-test placeholder and cache its result', async t => {
  const server = await reimbursementTableServer({ analyzePage: processLocalAnalysis });
  t.after(() => server.close());
  const png = await readFile(new URL('./fixtures/reimbursement-ocr-synthetic.png', import.meta.url));
  const pdf = await PDFDocument.create(), image = await pdf.embedPng(png);
  pdf.addPage([595, 420]).drawImage(image, { x: 0, y: 0, width: 595, height: 420 });
  const form = new FormData();
  form.append('invoices', new Blob([await pdf.save()], { type: 'application/pdf' }), 'synthetic-invoice.pdf');
  form.append('manifest', JSON.stringify([{ expenseItemId: 'item' }]));
  const upload = await fetch(`${server.origin}/api/reimbursements/bundles`, {
    method: 'POST', headers: { 'x-csrf-token': server.csrf }, body: form,
  });
  assert.equal(upload.status, 201);
  const { bundle } = await upload.json();
  const analyze = () => fetch(`${server.origin}/api/reimbursements/bundles/${bundle.id}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': server.csrf }, body: JSON.stringify({ page: 1 }),
  });
  const response = await analyze();
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.equal(first.analysis.method, 'local-ocr-and-image');
  assert.equal(first.analysis.buyer.state, 'matched');
  assert.equal(first.analysis.buyer.name, '南京大学');
  assert.equal(first.analysis.seal.state, 'candidate');
  assert.ok(first.analysis.invoice.fields);
  assert.match(first.analysis.textSnippet, /测试材料/);
  assert.notEqual(first.analysis.buyer.message, '合成未识别');
  const repeated = await (await analyze()).json();
  assert.equal(repeated.cached, true);
  assert.deepEqual(repeated.analysis, first.analysis);
});
