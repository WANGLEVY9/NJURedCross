import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { processPdfs } from '../lib/reimbursements/pdf.js';
import { createLocalReimbursementService } from '../lib/reimbursements/local-service.js';
import { createPreviewServer } from '../scripts/preview-materials.mjs';
import { wordFixture, pictureFixture } from './helpers/reimbursement-materials.js';

const owner = { id: 'mixed-owner' }, admin = { id: 'mixed-admin', canReview: true };
async function mixedFiles() {
  const doc = await PDFDocument.create(); doc.addPage([300, 200]);
  return [{ name: 'invoice.pdf', bytes: Buffer.from(await doc.save()), kind: 'invoice', expenseItemId: 'item' },
    ...['png', 'jpg', 'jpeg'].map(extension => ({ name: `picture.${extension}`, bytes: pictureFixture(extension), kind: 'supporting' })),
    { name: 'word.docx', bytes: wordFixture(), kind: 'supporting' }];
}
const submit = bundle => ({ bundleId: bundle.id, name: '混合申请人', amount: '1.00', purpose: '活动材料', activityId: 'mixed-event',
  idempotencyKey: bundle.id, expenseItems: [{ id: 'item', category: '办公用品', label: '活动清单', amount: '1.00' }] });
async function service(options = {}) {
  const service = createLocalReimbursementService(options);
  await service.summaries.saveActivity(admin, { id: 'mixed-event', name: '混合材料活动', date: '2026-10-10', location: '合成地点',
    participantCount: 1, description: '合成用途', unitName: '红十字会', fundAccount: 'TEST' });
  return service;
}

test('mixed materials preview PDFs and pictures in order, retain Word as an original and preserve all source bytes', async () => {
  const files = await mixedFiles(), originals = files.map(file => Buffer.from(file.bytes)), result = await processPdfs(files);
  assert.equal((await PDFDocument.load(result.merged)).getPageCount(), 4);
  assert.deepEqual(result.sources.map(source => [source.startPage, source.endPage]), [[1, 1], [2, 2], [3, 3], [4, 4], [null, null]]);
  assert.equal(result.sources[4].preview, 'original-only');
  files.forEach((file, index) => assert.deepEqual(file.bytes, originals[index]));
});

test('invoice uploads reject images and Word, while invalid supporting extensions and forged content are rejected', async () => {
  for (const file of [{ name: 'invoice.jpg', kind: 'invoice', bytes: pictureFixture('jpg') },
    { name: 'invoice.docx', kind: 'invoice', bytes: wordFixture() },
    { name: 'picture.png', kind: 'supporting', bytes: Buffer.from('fake') },
    { name: 'word.docx', kind: 'supporting', bytes: wordFixture({ wrongType: true }) },
    { name: 'script.exe', kind: 'supporting', bytes: Buffer.from('fake') },
    { name: 'word.doc', kind: 'supporting', bytes: Buffer.from('fake') }]) await assert.rejects(processPdfs([file]));
});

const fontPath = process.env.REIMBURSEMENT_FONT_PATH || (process.platform === 'win32' ? 'C:/Windows/Fonts/simfang.ttf' : '');
const wordOnlyScenarios = [
  { name: 'Word-only bundles retain originals and send no invented PDF pages to the summary renderer', generateSummary: async (_summary, materials) => {
    assert.equal(materials.length, 1); assert.equal(materials[0].bytes.length, 0);
    assert.equal(materials[0].sources[0].startPage, null);
    return { formPdf: Buffer.from('synthetic-form'), packetPdf: Buffer.from('synthetic-form'), formPages: 1, packetPages: 1,
      attachments: materials.map(material => ({ requestId: material.requestId, startPage: null, endPage: null, sources: material.sources })) };
  } },
  { name: 'Word-only bundles generate a real Chinese summary PDF without adding attachment pages', skip: !existsSync(fontPath) },
];
// Business coverage runs without system fonts; only Chinese PDF rendering requires the configured font.
for (const scenario of wordOnlyScenarios) test(scenario.name, { skip: scenario.skip }, async () => {
  const local = await service({ generateSummary: scenario.generateSummary }), bytes = wordFixture();
  const { bundle } = await local.preprocess(owner, [{ name: 'only.docx', kind: 'supporting', bytes }]);
  assert.equal(bundle.pageCount, 0); assert.equal(bundle.mergedUrl, null);
  const { request } = await local.submit(owner, submit(bundle));
  assert.equal(request.bundle.originalUrls[0].name, '混合申请人-活动材料-金额-补充材料-01.docx');
  assert.equal(local.attachment(owner, bundle.id, 0).contentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.deepEqual(local.attachment(owner, bundle.id, 0).bytes, bytes);
  assert.throws(() => local.attachment(owner, bundle.id), /Word 原件/);
  await local.review(admin, request.id, { action: 'approve', revision: 1, materialsChecked: true });
  const { summary } = await local.summaries.create(admin, { activityId: 'mixed-event', activityRevision: 1,
    selections: [{ requestId: request.id, revision: 1 }], form: { handlerName: '合成经办人', handlerPhone: 'TEST', fillDate: '2026-10-10' }, idempotencyKey: 'mixed-summary' });
  assert.equal(summary.unmergedAttachments.length, 1); assert.equal(summary.attachmentPages, 0);
  assert.equal(summary.attachments[0].startPage, null); assert.equal(summary.packetPages, summary.formPages);
  assert.deepEqual(local.attachment(admin, bundle.id, 0).bytes, bytes);
  if (!scenario.generateSummary) {
    const packet = local.summaries.download(admin, summary.id, 'packet');
    assert.equal((await PDFDocument.load(packet.bytes)).getPageCount(), summary.formPages);
  }
});

test('HTTP downloads send generated names, actual MIME types and unchanged originals for mixed uploads', async t => {
  const local = await service(), server = await createPreviewServer({ reimbursementService: local, seedSyncFailure: false });
  server.listen(0); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`, root = `${origin}/api/preview/reimbursements`;
  const auth = await fetch(`${origin}/api/auth/session`), session = await auth.json();
  const headers = { Cookie: auth.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken };
  const files = await mixedFiles(), form = new FormData();
  files.forEach(file => form.append(file.kind === 'invoice' ? 'invoices' : 'supporting', new Blob([file.bytes]), file.name));
  form.append('manifest', JSON.stringify(files.map(file => ({ expenseItemId: file.expenseItemId || '' }))));
  const response = await fetch(`${root}/bundles`, { method: 'POST', headers, body: form });
  assert.equal(response.status, 201); const { bundle } = await response.json();
  const submission = await fetch(root, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(submit(bundle)) });
  assert.equal(submission.status, 201); const { request } = await submission.json();
  const merged = await fetch(`${origin}${request.bundle.mergedUrl}`, { headers });
  assert.ok(decodeURIComponent(merged.headers.get('content-disposition')).includes('混合申请人-办公用品-活动清单-合并材料.pdf'));
  for (let index = 0; index < files.length; index++) {
    const download = await fetch(`${origin}${request.bundle.originalUrls[index].url}`, { headers });
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), files[index].bytes);
    assert.ok(decodeURIComponent(download.headers.get('content-disposition')).includes(request.bundle.originalUrls[index].name));
  }
  const word = await fetch(`${origin}${request.bundle.originalUrls[4].url}`, { headers });
  assert.equal(word.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.ok(word.headers.get('content-disposition').includes('filename="material.docx"'));
  assert.equal((await (await fetch(`${root}/config`, { headers })).json()).materialUploads.version, 3);
});
