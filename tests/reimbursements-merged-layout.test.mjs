import test from 'node:test';
import assert from 'node:assert/strict';
import { degrees, PDFDocument } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { processPdfs } from '../lib/reimbursements/pdf.js';
import { pictureFixture } from './helpers/reimbursement-materials.js';

async function invoiceBytes(label, { pages = 1, size = [595, 842], rotate = 0 } = {}) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index++) {
    const page = doc.addPage(size);
    page.setRotation(degrees(rotate));
    page.drawText(`${label}-${index + 1}`, { x: 40, y: size[1] - 80, size: 14 });
  }
  return Buffer.from(await doc.save());
}

async function readPages(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise, pages = [];
  try {
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index);
      const items = (await page.getTextContent()).items;
      const ops = await page.getOperatorList();
      pages.push({ text: items.map(item => item.str).join('').trim(),
        locations: items.filter(item => item.str.trim()).map(item => item.transform.slice(4)),
        images: ops.fnArray.filter(fn => fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject).length });
    }
  } finally { await task.destroy(); }
  return pages;
}

const supporting = (name, materialType, bytes) => ({ name, kind: 'supporting', materialType, bytes });

test('merged evidence leads with the invoice, then one page holding the order and payment screenshots', async () => {
  const result = await processPdfs([
    supporting('order.png', '订单截图', pictureFixture('png')),
    supporting('payment.jpg', '付款截图', pictureFixture('jpg')),
    supporting('pickup.pdf', '领取单', await invoiceBytes('PICKUP', { size: [700, 400] })),
    { name: 'invoice.pdf', kind: 'invoice', bytes: await invoiceBytes('INVOICE', { size: [310, 580] }) },
  ]);
  assert.equal(result.pageCount, 3);
  // The manifest keeps upload order so original names, hashes and downloads stay aligned.
  assert.deepEqual(result.sources.map(source => [source.preview, source.startPage, source.endPage]),
    [['image', 2, 2], ['image', 2, 2], [undefined, 3, 3], [undefined, 1, 1]]);
  const pages = await readPages(result.merged);
  assert.deepEqual(pages.map(page => page.text), ['INVOICE-1', '', 'PICKUP-1']);
  assert.equal(pages[1].images, 2, '订单与付款截图应并排在同一页');
  assert.equal(pages[0].images, 0);
  const merged = await PDFDocument.load(result.merged);
  assert.deepEqual(merged.getPages().map(page => page.getSize()), [
    { width: 842, height: 595 }, { width: 595, height: 842 }, { width: 595, height: 842 },
  ]);
  assert.ok(pages[0].locations[0][0] > 250, '竖版发票等比居中到横版 A4');
  assert.ok(pages[2].locations[0][1] > 400, '横版附加材料等比居中到竖版 A4');
});

test('without an invoice the first page already carries the order and payment pair', async () => {
  const result = await processPdfs([
    supporting('payment.png', '付款截图', pictureFixture('png')),
    supporting('order.png', '订单截图', pictureFixture('png')),
  ]);
  assert.equal(result.pageCount, 1);
  assert.deepEqual(result.sources.map(source => source.startPage), [1, 1]);
  const pages = await readPages(result.merged);
  assert.deepEqual(pages.map(page => page.text), ['']);
  assert.equal(pages[0].images, 2);
});

test('a PDF order pairs with a payment image and keeps its extra pages', async () => {
  const result = await processPdfs([
    { name: 'order.pdf', kind: 'supporting', materialType: '订单截图', bytes: await invoiceBytes('ORDER', { pages: 2 }) },
    supporting('payment.png', '付款截图', pictureFixture('png')),
  ]);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.sources.map(source => [source.startPage, source.endPage]), [[1, 2], [1, 1]]);
  const pages = await readPages(result.merged);
  assert.deepEqual(pages.map(page => page.text), ['ORDER-1', 'ORDER-2']);
  assert.equal(pages[0].images, 1);
  assert.equal(pages[1].images, 0);
});

test('rotated PDF evidence keeps the order on the left and payment on the right', async () => {
  const result = await processPdfs([
    supporting('payment.pdf', '付款截图', await invoiceBytes('PAYMENT', { size: [420, 240], rotate: 270 })),
    supporting('order.pdf', '订单截图', await invoiceBytes('ORDER', { size: [420, 240], rotate: 90 })),
  ]);
  const [page] = await readPages(result.merged);
  assert.equal(result.pageCount, 1);
  assert.equal(page.text, 'ORDER-1PAYMENT-1');
  assert.ok(page.locations[0][0] > 20 && page.locations[0][0] < 290);
  assert.ok(page.locations[1][0] > 305 && page.locations[1][0] < 575);
});

test('a combined PDF with one screenshot per page is placed on one sheet', async () => {
  const result = await processPdfs([
    supporting('combined.pdf', '订单和付款截图', await invoiceBytes('SHOT', { pages: 2 })),
  ]);
  assert.equal(result.pageCount, 1);
  assert.equal((await readPages(result.merged))[0].text, 'SHOT-1SHOT-2');
  assert.equal(result.sources[0].composedEvidence, true);
});

test('evidence from different expense items never shares a PDF page', async () => {
  const result = await processPdfs([
    { ...supporting('order-a.png', '订单截图', pictureFixture()), expenseItemId: 'a' },
    { ...supporting('payment-b.png', '付款截图', pictureFixture()), expenseItemId: 'b' },
    { ...supporting('payment-a.png', '付款截图', pictureFixture()), expenseItemId: 'a' },
    { ...supporting('order-b.png', '订单截图', pictureFixture()), expenseItemId: 'b' },
  ]);
  assert.deepEqual(result.sources.map(source => source.startPage), [1, 2, 1, 2]);
  assert.deepEqual((await readPages(result.merged)).map(page => page.images), [2, 2]);
});

test('order/payment pairs come before unpaired screenshots and attachments regardless of upload order', async () => {
  const result = await processPdfs([
    { ...supporting('other.pdf', '领取单', await invoiceBytes('OTHER')), expenseItemId: 'a' },
    { ...supporting('unpaired.pdf', '订单截图', await invoiceBytes('EXTRA')), expenseItemId: 'b' },
    { ...supporting('payment.pdf', '付款截图', await invoiceBytes('PAYMENT')), expenseItemId: 'a' },
    { ...supporting('order.pdf', '订单截图', await invoiceBytes('ORDER')), expenseItemId: 'a' },
  ]);
  assert.deepEqual(result.sources.map(source => source.startPage), [3, 2, 1, 1]);
  assert.deepEqual((await readPages(result.merged)).map(page => page.text), ['ORDER-1PAYMENT-1', 'EXTRA-1', 'OTHER-1']);
});

test('several invoices stay in upload order ahead of the screenshots', async () => {
  const result = await processPdfs([
    supporting('order.png', '订单截图', pictureFixture('png')),
    { name: 'invoice-b.pdf', kind: 'invoice', bytes: await invoiceBytes('B') },
    { name: 'invoice-a.pdf', kind: 'invoice', bytes: await invoiceBytes('A', { pages: 2 }) },
    supporting('payment.jpg', '付款截图', pictureFixture('jpg')),
  ]);
  assert.equal(result.pageCount, 4);
  assert.deepEqual(result.sources.map(source => [source.startPage, source.endPage]), [[4, 4], [1, 1], [2, 3], [4, 4]]);
  const pages = await readPages(result.merged);
  assert.deepEqual(pages.map(page => page.text), ['B-1', 'A-1', 'A-2', '']);
});

test('trip documents stand alone after the invoice and the last page pairs the ride and payment captures', async () => {
  const result = await processPdfs([
    supporting('payment.pdf', '付款截图', await invoiceBytes('PAYMENT')),
    supporting('trip.pdf', '行程单', await invoiceBytes('TRIP')),
    supporting('order.pdf', '订单截图', await invoiceBytes('RIDE')),
    supporting('other.pdf', '领取单', await invoiceBytes('OTHER')),
    { name: 'invoice.pdf', kind: 'invoice', bytes: await invoiceBytes('INVOICE') },
  ]);
  assert.deepEqual((await readPages(result.merged)).map(page => page.text), ['INVOICE-1', 'TRIP-1', 'OTHER-1', 'RIDE-1PAYMENT-1']);
  assert.deepEqual(result.sources.map(source => source.startPage), [4, 2, 4, 3, 1]);
});

test('order, logistics and payment documents occupy the left, center and right of the same A4 page', async () => {
  const result = await processPdfs([
    supporting('logistics.pdf', '物流截图', await invoiceBytes('LOGISTICS')),
    supporting('payment.pdf', '共用付款账单', await invoiceBytes('PAYMENT')),
    supporting('order.pdf', '订单截图', await invoiceBytes('ORDER')),
  ]);
  assert.deepEqual(result.sources.map(source => source.startPage), [1, 1, 1]);
  const [page] = await readPages(result.merged);
  assert.equal(page.text, 'ORDER-1LOGISTICS-1PAYMENT-1');
  assert.ok(page.locations[0][0] < 198 && page.locations[1][0] > 198 && page.locations[1][0] < 397 && page.locations[2][0] > 397);
});
