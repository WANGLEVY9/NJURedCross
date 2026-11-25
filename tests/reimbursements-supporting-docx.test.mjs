import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { reimbursementTableFixture } from './helpers/reimbursement-table-fixture.js';
import { validateWord } from '../lib/reimbursements/supporting-files.js';
import { buildEvidenceDocx } from '../lib/reimbursements/docx-writer.js';
import { extractDocxImages } from '../lib/reimbursements/docx-media.js';

const owner = { id: 'synthetic-owner' }, final = { id: 'synthetic-final', financePermissions: ['final', 'view'] };

async function picture(width = 900, height = 1300, background = '#ffffff') {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
}
async function blankInvoice() {
  const document = await PDFDocument.create(); document.addPage([595, 842]); return Buffer.from(await document.save());
}
async function seeded(options = {}) {
  const fixture = reimbursementTableFixture(), service = fixture.makeService({ workflowVersion: 3, ...options });
  await service.summaries.saveActivity(final, { id: 'event', name: '合成活动', campus: '苏州', date: '2026-10-15', participantCount: 1, location: '合成地点', description: '合成目的' });
  return { fixture, service };
}
const application = (bundleId, category = '物资采买') => ({ name: '合成申请人', purpose: '购买便利用品', amount: '20.00', activityId: 'event',
  expenseDate: '2026-10-15', materialRulesVersion: 1, meetingRelated: false, singleOrderConfirmed: true,
  expenseItems: [{ id: 'a', category, label: '便利用品', amount: '20.00', note: '' }], bundleId, idempotencyKey: bundleId });

test('generated Word packet is a valid OOXML package whose pictures survive extraction', async () => {
  const first = await picture(600, 900, '#ffffff'), second = await picture(800, 1200, '#f4fff4');
  const bytes = buildEvidenceDocx({ title: '报销补充材料', subtitle: '购买便利用品',
    meta: [{ label: '申请人', value: '合成申请人' }, { label: '报销金额', value: '20.00 元' }],
    groups: [{ heading: '第 1 项 · 便利用品', note: '订单截图 · 共 1 张', images: [{ bytes: first, extension: 'png', width: 600, height: 900, caption: '订单.png' }] },
      { heading: '第 1 项 · 便利用品', note: '付款截图 · 共 1 张', images: [{ bytes: second, extension: 'png', width: 800, height: 1200, caption: '付款.png' }] }],
    footer: '平台自动生成。' });
  validateWord(bytes, 'docx');
  const { images } = extractDocxImages(bytes);
  assert.equal(images.length, 2);
  assert.equal(images[0].extension, 'png');
  assert.deepEqual([images[0].bytes.length, images[1].bytes.length], [first.length, second.length]);
  assert.equal(images[0].bytes.equals(first), true);
  assert.equal(images[1].bytes.equals(second), true);
});

test('order and payment pictures produce one downloadable Word packet on submission', async () => {
  const { service } = await seeded();
  const shots = await Promise.all([picture(), picture(900, 1300, '#f6fff6')]);
  const { bundle } = await service.preprocess(owner, [
    { name: 'invoice.pdf', kind: 'invoice', expenseItemId: 'a', bytes: await blankInvoice() },
    { name: 'order.png', kind: 'supporting', materialType: '订单截图', expenseItemId: 'a', bytes: shots[0] },
    { name: 'payment.png', kind: 'supporting', materialType: '付款截图', expenseItemId: 'a', bytes: shots[1] },
  ]);
  assert.equal(bundle.supportingDocxUrl, null);
  const result = await service.submit(owner, application(bundle.id));
  assert.match(result.request.bundle.supportingDocxName, /报销补充材料\.docx$/);
  assert.match(result.request.bundle.supportingDocxUrl, /\/supporting\.docx$/);
  const file = await service.attachment(owner, bundle.id, null, 'supporting.docx');
  assert.equal(file.contentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  validateWord(file.bytes, 'docx');
  const { images } = extractDocxImages(file.bytes);
  assert.equal(images.length, 2, 'both screenshots must be embedded in the packet');
});

test('a Word upload shows the order and payment on one PDF page and still yields a Word packet', async () => {
  const { service } = await seeded();
  const shot = await picture();
  const word = buildEvidenceDocx({ title: '订单与付款证据', groups: [
    { heading: '第 1 项 · 便利用品', note: '订单截图', images: [{ bytes: shot, extension: 'png', width: 900, height: 1300, caption: '订单截图' }] },
    { heading: '第 1 项 · 便利用品', note: '付款截图', images: [{ bytes: shot, extension: 'png', width: 900, height: 1300, caption: '付款截图' }] },
  ] });
  const { bundle } = await service.preprocess(owner, [
    { name: 'invoice.pdf', kind: 'invoice', expenseItemId: 'a', bytes: await blankInvoice() },
    { name: 'screenshots.docx', kind: 'supporting', materialType: '订单和付款截图', expenseItemId: 'a', bytes: word },
  ]);
  const source = bundle.sources.find(item => item.name === 'screenshots.docx');
  assert.equal(source.preview, 'word-images');
  assert.equal(source.pages, 1, 'order and payment in Word must share one page');
  assert.equal(bundle.pageCount, 2);
  const result = await service.submit(owner, application(bundle.id));
  assert.ok(result.request.bundle.supportingDocxUrl);
  const analysed = await service.analyze(final, bundle.id, bundle.pageCount);
  assert.equal(analysed.ok, true);
  assert.equal(analysed.analysis.sourceName, 'screenshots.docx');
  assert.equal(analysed.analysis.materialType, '订单和付款截图');
});

test('an invoice-only submission produces no Word packet and no empty packet file', async () => {
  const { service } = await seeded();
  const { bundle } = await service.preprocess(owner, [
    { name: 'train.pdf', kind: 'invoice', expenseItemId: 'a', bytes: await blankInvoice() },
  ]);
  const result = await service.submit(owner, { ...application(bundle.id, '火车票/高铁票'),
    expenseItems: [{ id: 'a', category: '火车票/高铁票', label: '高铁票', amount: '20.00', note: '',
      railJourney: { fromStation: '南京南', toStation: '上海虹桥', journey: '单程' } }] });
  assert.equal(result.request.bundle.supportingDocxUrl, null);
  await assert.rejects(service.attachment(owner, bundle.id, null, 'supporting.docx'), /没有可下载的补充材料 Word/);
});
