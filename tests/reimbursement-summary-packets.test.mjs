import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createLocalReimbursementService } from '../lib/reimbursements/local-service.js';
import { processPdfs } from '../lib/reimbursements/pdf.js';
import { generateItemPackets } from '../lib/reimbursements/item-packets.js';
import { wordFixture } from './helpers/reimbursement-materials.js';

const owner = { id: 'summary-packet-owner' }, initial = { id: 'summary-packet-initial', financePermissions: ['initial'] },
  final = { id: 'summary-packet-final', financePermissions: ['final'] };
const event = { id: 'summary-packet-event', name: '合成项目汇总活动', date: '2026-10-12', location: '合成地点',
  participantCount: 1, description: '合成项目页序验证', unitName: '合成单位', fundAccount: 'TEST' };
async function pdf(label, pages = 1, rotate = false) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index++) { const page = doc.addPage([300, 200]); page.drawText(`${label}-${index + 1}`); if (rotate) page.setRotation(degrees(90)); }
  return Buffer.from(await doc.save());
}
async function text(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false });
  try { const doc = await task.promise, result = []; for (let page = 1; page <= doc.numPages; page++) result.push((await (await doc.getPage(page)).getTextContent()).items.map(item => item.str).join('')); return result; }
  finally { await task.destroy(); }
}
async function setup({ onlyWord = false, generateSummary } = {}) {
  const captured = [];
  const service = createLocalReimbursementService({ workflowVersion: 2, processFiles: processPdfs, generatePackets: generateItemPackets, requireDistinctReviewers: true,
    generateSummary: generateSummary || (async (summary, materials) => { captured.push({ summary, materials }); return { formPdf: Buffer.from('form'), packetPdf: Buffer.from('packet'), formPages: 1, packetPages: 1 + summary.attachmentPages, attachments: [] }; }) });
  await service.summaries.saveActivity(final, event);
  const files = onlyWord ? [{ name: 'word.docx', kind: 'supporting', materialType: '其他', expenseItemId: 'a', bytes: wordFixture() }] : [
    { name: 'other.pdf', kind: 'supporting', materialType: '领取单', expenseItemId: 'a', bytes: await pdf('OTHER') },
    { name: 'invoice-b.pdf', kind: 'invoice', expenseItemId: 'b', bytes: await pdf('INVOICE-B') },
    { name: 'payment.pdf', kind: 'supporting', materialType: '付款截图', expenseItemId: 'a', bytes: await pdf('PAYMENT') },
    { name: 'word.docx', kind: 'supporting', materialType: '其他', expenseItemId: 'a', bytes: wordFixture() },
    { name: 'order.pdf', kind: 'supporting', materialType: '订单截图', expenseItemId: 'a', bytes: await pdf('ORDER') },
    { name: 'invoice-a.pdf', kind: 'invoice', expenseItemId: 'a', bytes: await pdf('INVOICE-A', 2, true) },
    { name: 'common.pdf', kind: 'supporting', materialType: '其他', bytes: await pdf('COMMON') }];
  const { bundle } = await service.preprocess(owner, files);
  let request = (await service.submit(owner, { name: '合成申请人', amount: '20.00', purpose: '项目顺序验证', activityId: event.id,
    bankAccount: '0123456789012345', bundleId: bundle.id, idempotencyKey: bundle.id,
    expenseItems: [{ id: 'a', label: '鼠标', amount: '15.00' }, { id: 'b', label: '交通', amount: '5.00' }] })).request;
  await service.materialPackets.create(initial, request.id, { revision: 1, bundleId: bundle.id, materialsChecked: true });
  request = (await service.review(initial, request.id, { action: 'initial-approve', revision: 1, stateVersion: 1, materialsChecked: true })).request;
  request = (await service.review(final, request.id, { action: 'final-approve', revision: 1, stateVersion: request.stateVersion, materialsChecked: true })).request;
  const body = { activityId: event.id, activityRevision: 1, selections: [{ requestId: request.id, revision: 1 }],
    form: { handlerName: '合成经办人', handlerPhone: 'TEST', fillDate: '2026-10-12' }, idempotencyKey: 'summary-packets-1' };
  return { service, request, files, body, captured };
}

test('two-stage activity summaries consume current reviewed project packets in expense order without repeating common or order/payment pages', async () => {
  const { service, request, body, files, captured } = await setup();
  const history = service.get(owner, request.id).request.history;
  const preview = service.summaries.preview(final, body).summary;
  assert.equal(preview.materialsOrder, 'request-expense-invoice-order-payment-other');
  assert.deepEqual(preview.materialGroups.map(group => [group.groupKind, group.expenseItemId, group.pageCount]), [['expense', 'a', 5], ['expense', 'b', 1], ['common', '', 1]]);
  assert.equal(preview.attachmentPages, 7); assert.equal(preview.totalCents, 2000);
  assert.equal(JSON.stringify(preview).includes('"bytes"'), false);
  await service.summaries.create(final, body);
  const materials = captured[0].materials;
  assert.deepEqual(await text(materials[0].bytes), ['INVOICE-A-1', 'INVOICE-A-2', 'ORDER-1', 'PAYMENT-1', 'OTHER-1']);
  assert.deepEqual(await text(materials[1].bytes), ['INVOICE-B-1']); assert.deepEqual(await text(materials[2].bytes), ['COMMON-1']);
  const copied = await PDFDocument.load(materials[0].bytes); assert.equal(copied.getPage(0).getRotation().angle, 90);
  assert.deepEqual(materials[0].sources.map(source => source.originalIndex), [5, 4, 2, 0, 3]);
  assert.equal(materials[0].sources[0].originalStartPage, 1); assert.equal(materials[0].sources[0].originalEndPage, 2);
  assert.equal(materials[0].sources.at(-1).startPage, null);
  for (const [index, file] of files.entries()) assert.deepEqual(service.attachment(owner, request.bundle.id, index).bytes, file.bytes);
  assert.deepEqual(service.get(owner, request.id).request.history, history); assert.equal(service.get(owner, request.id).request.paymentStatus, 'pending');
  assert.equal((await service.summaries.create(final, body)).duplicate, true); assert.equal(captured.length, 1);
});

test('Word-only project packets remain separate originals with zero copied pages in the activity summary', async () => {
  const { service, body, captured } = await setup({ onlyWord: true });
  const preview = service.summaries.preview(final, body).summary;
  assert.equal(preview.attachmentPages, 0); assert.equal(preview.materialGroups.length, 1);
  assert.equal(preview.unmergedAttachments.length, 1);
  assert.equal(preview.unmergedAttachments[0].name, '合成申请人-鼠标-15.00-其他-01.docx');
  await service.summaries.create(final, body);
  assert.equal(captured[0].materials[0].bytes.length, 0); assert.equal(captured[0].materials[0].sources[0].startPage, null);
});

test('summary generation failure preserves project packets and eligibility and does not claim requests', async () => {
  let calls = 0;
  const { service, request, body } = await setup({ generateSummary: async () => { if (!calls++) throw new Error('synthetic renderer failure');
    return { formPdf: Buffer.from('form'), packetPdf: Buffer.from('packet'), formPages: 1, packetPages: 8, attachments: [] }; } });
  await assert.rejects(service.summaries.create(final, body), /synthetic renderer failure/);
  assert.equal(service.get(owner, request.id).request.summaryEligibility.eligible, true);
  assert.equal(service.summaries.list(final).summaries.length, 0);
  assert.equal(service.materialPackets.list(final, request.id).packets.groups.length, 3);
  assert.equal((await service.summaries.create(final, body)).summary.materialGroups.length, 3);
});
