import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractSupportingFields } from '../lib/reimbursements/supporting-fields.js';
import { processLocalAnalysis } from '../lib/reimbursements/analysis-processor.js';
import { reimbursementCrossChecks } from '../public/app/shared/reimbursement-cross-checks.js';
import { createInvoiceChecks } from '../public/app/shared/invoice-checks.js';
import { reimbursementTableFixture } from './helpers/reimbursement-table-fixture.js';
import { setImmediate } from 'node:timers/promises';

const field = (value, state = 'extracted') => ({ state, value, evidence: `合成字段：${value}`, method: 'pdf-text' });
const textBoxes = rows => rows.map((text, index) => ({ text, x: .1, y: index * .1, width: .8, height: .04, confidence: null }));
function fixture({ invoice = '100.00', payment = '80.00', claimed = 8000, name = '活动用抽纸' } = {}) {
  const files = [
    { kind: 'invoice', name: 'invoice.pdf', expenseItemId: 'a', startPage: 1, endPage: 1 },
    { kind: 'supporting', materialType: '订单截图', name: 'order.png', expenseItemId: 'a', startPage: 2, endPage: 2 },
    { kind: 'supporting', materialType: '付款截图', name: 'payment.png', expenseItemId: 'a', startPage: 3, endPage: 3 },
  ];
  const bundle = { sources: files, originalUrls: files };
  const request = { amountCents: claimed, expenseItems: [{ id: 'a', label: '抽纸', amountCents: claimed }] };
  const analyses = [{ page: 1, invoice: { fields: { totalAmount: field(invoice), invoiceNumber: field('12345678') } } },
    { page: 2, supporting: { productName: field(name) } }, { page: 3, supporting: { paidAmount: field(payment) } }];
  return { bundle, request, analyses };
}
const verify = f => reimbursementCrossChecks(f.request, f.bundle, f.analyses)[0];

test('explicit supporting labels extract names and payments without using prices, discounts or filenames', () => {
  const fields = extractSupportingFields(textBoxes(['商品名称：活动用抽纸', '商品总价：100.00', '优惠金额：20.00', '实付款：￥80.00']));
  assert.equal(fields.productName.value, '活动用抽纸'); assert.equal(fields.paidAmount.value, '80.00');
  assert.equal(extractSupportingFields(textBoxes(['订单编号：12345678', '商品总价：80.00'])).paidAmount.state, 'unknown');
  assert.equal(extractSupportingFields(textBoxes(['实付款', '￥80.00'])).paidAmount.value, '80.00');
  assert.equal(extractSupportingFields(textBoxes(['支付成功', '-￥80.00'])).paidAmount.value, '80.00');
  assert.equal(extractSupportingFields(textBoxes(['支付成功：+80.00'])).paidAmount.state, 'unknown');
  assert.equal(extractSupportingFields(textBoxes(['支付金额：1,2.00'])).paidAmount.state, 'unknown');
});
test('category rules skip non-required order evidence and compare a confirmed multi-item order against its total', () => {
  const data = fixture();
  Object.assign(data.request, { materialRulesVersion: 1, singleOrderConfirmed: true, meetingRelated: false });
  data.request.expenseItems[0].category = '物资采买';
  data.request.expenseItems[0].amountCents = 3000;
  data.request.expenseItems.push({ id: 'b', category: '物资采买', label: '抽纸', amountCents: 5000 });
  const groups = reimbursementCrossChecks(data.request, data.bundle, data.analyses);
  assert.equal(groups.length, 2);
  for (const group of groups) { assert.equal(group.amount.state, 'matched'); assert.equal(group.amountScope, 'order'); assert.match(group.amount.message, /分摊/); }
  data.request.expenseItems[0].category = data.request.expenseItems[1].category = '火车票/高铁票';
  data.request.amountCents = 10000; data.request.expenseItems[1].amountCents = 7000;
  for (const group of reimbursementCrossChecks(data.request, data.bundle, data.analyses.slice(0, 1))) {
    assert.equal(group.amount.state, 'matched'); assert.equal(group.name.state, 'not-applicable');
  }
});

test('low confidence, contradictory totals and refunds never become an extracted payment', () => {
  assert.equal(extractSupportingFields(textBoxes(['实付款：80.00', '支付金额：70.00'])).paidAmount.state, 'conflict');
  assert.equal(extractSupportingFields(textBoxes(['实付款：80.00']).map(box => ({ ...box, confidence: 40 })), { method: 'local-ocr' }).paidAmount.state, 'unknown');
  assert.equal(extractSupportingFields(textBoxes(['实付款：80.00', '退款成功'])).paidAmount.state, 'conflict');
});

test('declared amount must equal the lower of invoice total and actual payment, using integer cents', () => {
  const result = verify(fixture());
  assert.equal(result.amount.state, 'matched'); assert.equal(result.referenceCents, 8000); assert.equal(result.name.state, 'matched');
  assert.equal(verify(fixture({ invoice: '60.01', payment: '80.00', claimed: 6001 })).amount.state, 'matched');
  assert.equal(verify(fixture({ claimed: 10000 })).amount.state, 'different');
  assert.equal(verify(fixture({ claimed: 7999 })).amount.state, 'different');
  assert.equal(verify(fixture({ name: '文件夹' })).name.state, 'different');
});

test('missing, unassociated, common and conflicting evidence cannot produce a green check', () => {
  for (const mutate of [
    f => f.analyses.pop(),
    f => { f.bundle.originalUrls[2].expenseItemId = ''; },
    f => { f.analyses[2].supporting.paidAmount = field('', 'conflict'); },
    f => { f.analyses[0].invoice.fields.totalAmount = field('', 'unknown'); },
  ]) { const f = fixture(); mutate(f); assert.equal(verify(f).amount.state, 'unknown'); }
  const f = fixture(); f.analyses[1].supporting.productName = field('', 'unknown');
  assert.equal(verify(f).name.state, 'unknown');
  f.request.amountCents++; assert.equal(verify(f).amount.state, 'different');
});

test('a multi-page invoice is counted once, while duplicate invoice files across items are flagged', () => {
  const f = fixture();
  // Keep page ranges disjoint, with the invoice continuation directly after its first page.
  f.bundle.sources[0].endPage = 2;
  f.bundle.sources[1].startPage = f.bundle.sources[1].endPage = 3;
  f.bundle.sources[2].startPage = f.bundle.sources[2].endPage = 4;
  f.analyses[1].page = 3; f.analyses[2].page = 4;
  f.analyses.push({ ...f.analyses[0], page: 2 });
  assert.equal(verify(f).invoiceCents, 10000); assert.equal(verify(f).amount.state, 'matched');
  const other = { ...f.bundle.sources[0], expenseItemId: 'b', startPage: 5, endPage: 5 };
  f.bundle.sources.push(other); f.bundle.originalUrls = [...f.bundle.sources];
  f.request.expenseItems.push({ id: 'b', label: '其他物资', amountCents: 1000 }); f.request.amountCents += 1000;
  f.analyses.push({ ...f.analyses[0], page: 5 });
  assert.equal(verify(f).amount.state, 'different'); assert.match(verify(f).amount.message, /重复/);
});

test('initial-review queue serially checks only associated evidence types and skips unrelated or Word materials', async () => {
  const calls = [], checks = createInvoiceChecks(async (id, page) => { calls.push(page); return { analysis: { page } }; }, { includeSupporting: true });
  checks.ensure({ id: 'mixed', pageCount: 4, sources: [
    { kind: 'invoice', startPage: 1, endPage: 1 },
    { kind: 'supporting', materialType: '订单截图', startPage: 2, endPage: 2 },
    { kind: 'supporting', materialType: '付款截图', startPage: 3, endPage: 3 },
    { kind: 'supporting', materialType: '领取单', startPage: 4, endPage: 4 },
    { kind: 'supporting', materialType: '订单截图', startPage: null, endPage: null },
  ] });
  for (let attempt = 0; attempt < 100 && !checks.get('mixed').complete; attempt++) await setImmediate();
  assert.deepEqual(calls, [1, 2, 3]); assert.equal(checks.get('mixed').complete, true); checks.dispose();
});

test('real offline OCR reads a synthetic payment screenshot as original PNG bytes', async () => {
  const bytes = await readFile(new URL('./fixtures/reimbursement-supporting-synthetic.png', import.meta.url));
  const analysis = await processLocalAnalysis({ bytes, pageNumber: 1,
    materialKind: 'supporting', materialType: '订单和付款截图', originalName: 'synthetic-payment.png' });
  assert.equal(analysis.supporting.paidAmount.value, '80.00', JSON.stringify(analysis));
  assert.match(analysis.supporting.productName.value, /抽纸/); assert.equal(analysis.method, 'local-ocr-and-image');
});

test('Table/Box restore supporting-page results and original bytes without changing review state', async () => {
  const f = reimbursementTableFixture(), inputs = [];
  const options = { workflowVersion: 1, analyzePage: async input => { inputs.push(input); return { supporting: { version: 1, productName: field('抽纸'), paidAmount: field('80.00') } }; } };
  const service = f.makeService(options), owner = { id: 'synthetic-owner' };
  await service.summaries.saveActivity({ id: 'synthetic-admin', canReview: true }, { id: 'synthetic-event', name: '合成活动', date: '2026-10-20', location: '合成地点', participantCount: 1, description: '隔离测试' });
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([400, 300]).drawText('Payment total: 80.00', { x: 40, y: 200, font });
  const bytes = Buffer.from(await pdf.save());
  const { bundle } = await service.preprocess(owner, [{ name: 'payment.pdf', kind: 'supporting', materialType: '付款截图', expenseItemId: 'a', bytes }]);
  const { request } = await service.submit(owner, { name: '合成申请人', purpose: '材料核验', amount: '80.00',
    activityId: 'synthetic-event', expenseItems: [{ id: 'a', label: '抽纸', amount: '80.00' }], bundleId: bundle.id, idempotencyKey: bundle.id });
  const result = await service.analyze(owner, bundle.id, 1);
  assert.equal(inputs[0].materialKind, 'supporting'); assert.equal(inputs[0].materialType, '付款截图');
  assert.deepEqual(inputs[0].bytes, bytes); assert.equal(result.analysis.supporting.paidAmount.value, '80.00');
  const restored = f.makeService(options);
  assert.equal((await restored.analyze(owner, bundle.id, 1)).cached, true);
  assert.equal(inputs.length, 1); assert.equal((await restored.get(owner, request.id)).request.status, 'pending');
});
