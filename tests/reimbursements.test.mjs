import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PDFDocument } from 'pdf-lib';
import { processPdfs, buyerHint } from '../lib/reimbursements/pdf.js';
import { createLocalReimbursementService, amountCents } from '../lib/reimbursements/local-service.js';
import { createPreviewServer } from '../scripts/preview-materials.mjs';

const owner = { id: 'alice' }, other = { id: 'bob' }, reviewer = { id: 'reviewer', canReview: true };
const sourceFile = { name: 'sample.pdf', bytes: Buffer.from('%PDF-local-test-placeholder') };
const stubProcessing = async files => ({ merged: Buffer.from('merged'), pageCount: files.length,
  sources: files.map((file, index) => ({ name: file.name, pages: 1, startPage: index + 1, endPage: index + 1, checks: [] })) });
function newService() { return createLocalReimbursementService({ workflowVersion: 1, processFiles: stubProcessing }); }
async function draft(service, actor = owner) { return (await service.preprocess(actor, [sourceFile])).bundle; }
const body = bundle => ({ name: '示例申请人', amount: '128.50', purpose: '活动用品采购', bundleId: bundle.id, idempotencyKey: 'submit-1' });
const approval = revision => ({ action: 'approve', revision, materialsChecked: true, note: '已核对原票' });

test('amount uses exact cents and rejects fractional cents, exponentials, negatives and empty input', () => {
  assert.equal(amountCents('128.50'), 12850); assert.equal(amountCents('0.01'), 1);
  for (const value of ['0', '-1', '1.001', '1e2', 'NaN', '', '01.00', 2, null]) assert.throws(() => amountCents(value), /金额/);
});
test('buyer hints use the explicit buyer field and never match a university name elsewhere', () => {
  assert.equal(buyerHint('购买方信息\n名称：南京大学\n纳税人识别号：123').state, 'matched');
  assert.equal(buyerHint('销售方 名称：南京大学').state, 'unknown');
  assert.equal(buyerHint('购买方信息\n销售方信息\n名称：南京大学').state, 'unknown');
  assert.equal(buyerHint('购买方 名称：南京大学附属医院').state, 'different');
  assert.equal(buyerHint('南京大学活动发票\n购买方 名称：其他单位').state, 'different');
  assert.equal(buyerHint('').state, 'unknown');
});
test('PDF merge preserves order, original bytes and page geometry, without assuming text or seal matches', async () => {
  const first = await PDFDocument.create(); first.addPage([200, 300]); first.addPage([220, 320]);
  const second = await PDFDocument.create(); second.addPage([400, 500]);
  const files = [{ name: 'first.pdf', bytes: Buffer.from(await first.save()) }, { name: 'second.pdf', bytes: Buffer.from(await second.save()) }];
  const original = files.map(file => Buffer.from(file.bytes));
  const result = await processPdfs(files);
  const merged = await PDFDocument.load(result.merged);
  assert.deepEqual(merged.getPages().map(page => page.getSize()), [{ width: 200, height: 300 }, { width: 220, height: 320 }, { width: 400, height: 500 }]);
  assert.deepEqual(result.sources.map(source => [source.startPage, source.endPage]), [[1, 2], [3, 3]]);
  files.forEach((file, index) => assert.deepEqual(file.bytes, original[index]));
  assert.ok(result.sources.every(source => source.checks.every(check => check.state === 'unknown' && check.seal === 'manual')));
});
test('PDF preprocess rejects non-PDF files, oversized bundles, corrupt documents and interactive forms', async () => {
  await assert.rejects(processPdfs([]), /1 至 10/);
  await assert.rejects(processPdfs(Array.from({ length: 11 }, () => sourceFile)), /1 至 10/);
  await assert.rejects(processPdfs([{ name: 'image.png', bytes: Buffer.from('not PDF') }]), /有效 PDF/);
  await assert.rejects(processPdfs([sourceFile]), /无法读取/);
  const doc = await PDFDocument.create(); const page = doc.addPage();
  doc.getForm().createTextField('example').addToPage(page);
  await assert.rejects(processPdfs([{ name: 'form.pdf', bytes: Buffer.from(await doc.save()) }]), /可填写表单/);
});

test('large PDF over the former 10 MB limit passes the HTTP, parser and private-original boundaries', async t => {
  const doc = await PDFDocument.create(); doc.addPage([200, 300]);
  // A valid large stream keeps the test independent of image codecs and remote files.
  doc.context.register(doc.context.stream(Buffer.alloc(12 * 1024 * 1024, 65)));
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  assert.ok(bytes.length > 10 * 1024 * 1024 && bytes.length < 30 * 1024 * 1024);
  const server = await createPreviewServer({ seedSyncFailure: false, reimbursementService: createLocalReimbursementService({ workflowVersion: 1 }) });
  server.listen(0); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const auth = await fetch(`${origin}/api/auth/session`), session = await auth.json(), cookie = auth.headers.get('set-cookie').split(';')[0];
  const root = `${origin}/api/preview/reimbursements`;
  const config = await (await fetch(`${root}/config`, { headers: { Cookie: cookie } })).json();
  assert.equal(config.limits.fileMB, 30); assert.equal(config.limits.totalMB, 100);
  const form = new FormData(); form.append('files', new Blob([bytes], { type: 'application/pdf' }), 'large-local.pdf');
  const response = await fetch(`${root}/bundles`, { method: 'POST', body: form, headers: { Cookie: cookie, 'X-CSRF-Token': session.csrfToken } });
  assert.equal(response.status, 201); const result = await response.json(); assert.equal(result.bundle.pageCount, 1);
  const original = await fetch(`${origin}${result.bundle.originalUrls[0].url}`, { headers: { Cookie: cookie } });
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
});

test('30 MB file and 100 MB batch caps reject before the parser runs', async () => {
  let parsed = false;
  const service = createLocalReimbursementService({ workflowVersion: 1, processFiles: async () => { parsed = true; throw new Error('unexpected parser call'); } });
  const oversized = { name: 'oversized.pdf', bytes: Buffer.alloc(30 * 1024 * 1024 + 1) };
  await assert.rejects(service.preprocess(owner, [oversized]), /30 MB/);
  await assert.rejects(processPdfs([oversized]), /30 MB/);
  const chunk = { name: 'batch.pdf', bytes: Buffer.alloc(26 * 1024 * 1024) };
  await assert.rejects(service.preprocess(owner, [chunk, chunk, chunk, chunk]), /100 MB/);
  await assert.rejects(processPdfs([chunk, chunk, chunk, chunk]), /100 MB/);
  assert.equal(parsed, false);
});
test('attachments and requests stay with their owner; reviewer cannot read an unsubmitted draft', async () => {
  const service = newService(); const bundle = await draft(service);
  assert.throws(() => service.attachment(other, bundle.id), /不存在/);
  assert.throws(() => service.attachment(reviewer, bundle.id), /不存在/);
  await assert.rejects(service.submit(other, body(bundle)), /属于本账号/);
  const submitted = await service.submit(owner, body(bundle));
  assert.equal(service.list(other).requests.length, 0);
  assert.throws(() => service.list(owner, true), /权限/);
  assert.throws(() => service.get(other, submitted.request.id), /不存在/);
  assert.deepEqual(service.attachment(reviewer, bundle.id).bytes, Buffer.from('merged'));
  assert.deepEqual(service.attachment(owner, bundle.id, 0).bytes, sourceFile.bytes);
  assert.match(bundle.sources[0].sha256, /^[a-f0-9]{64}$/);
});
test('submission is idempotent and changed content under the same key cannot create another request', async () => {
  const service = newService(); const bundle = await draft(service); const input = body(bundle);
  const first = await service.submit(owner, input), repeat = await service.submit(owner, input);
  assert.equal(first.request.id, repeat.request.id); assert.equal(repeat.duplicate, true);
  assert.equal(service.list(owner).requests.length, 1);
  await assert.rejects(service.submit(owner, { ...input, amount: '99.99' }), /同一操作/);
  await assert.rejects(service.submit(owner, { ...input, idempotencyKey: 'other' }), /这份材料已提交/);
});

test('bank account keeps string digits, rejects invalid formats and participates in replay and resubmission', async () => {
  const service = newService(), bundle = await draft(service);
  const syntheticAccount = '0123456789012345';
  for (const bankAccount of ['', '123456789012345', '12345678901234567890', '1234 567890123456',
    '0123456789012345 ', '\t0123456789012345', '012345678901234X', '１２３４５６７８９０１２３４５６', 1234567890123456, null]) {
    await assert.rejects(service.submit(owner, { ...body(bundle), bankAccount }), /银行卡号/);
  }
  assert.equal(service.list(owner).requests.length, 0);
  const input = { ...body(bundle), bankAccount: syntheticAccount };
  const { request } = await service.submit(owner, input);
  assert.equal(request.bankAccount, syntheticAccount);
  assert.equal(service.get(reviewer, request.id, true).request.bankAccount, syntheticAccount);
  assert.equal((await service.submit(owner, input)).duplicate, true);
  await assert.rejects(service.submit(owner, { ...input, bankAccount: '1234567890123456789' }), /同一操作/);
  assert.throws(() => service.get(other, request.id), /不存在/);
  await service.review(reviewer, request.id, { action: 'return', revision: 1, note: '合成补充要求' });
  const replacement = await draft(service);
  const updated = (await service.submit(owner, { ...body(replacement), bankAccount: '1234567890123456789', idempotencyKey: 'bank-resubmit' }, request.id)).request;
  assert.equal(updated.bankAccount, '1234567890123456789');
  assert.equal(updated.revision, 2);
});
test('return requires a reason, replacement creates a new revision, stale review cannot approve it', async () => {
  const service = newService(), bundle = await draft(service);
  const item = (await service.submit(owner, body(bundle))).request;
  assert.throws(() => service.review(owner, item.id, approval(1)), /权限/);
  await assert.rejects(service.review(reviewer, item.id, { action: 'return', revision: 1, note: '' }), /退回原因/);
  await service.review(reviewer, item.id, { action: 'return', revision: 1, note: '请补充明细' });
  await assert.rejects(service.submit(owner, { ...body(bundle), idempotencyKey: 'same-bundle' }, item.id), /补充后的材料/);
  const replacement = await draft(service);
  const updated = (await service.submit(owner, { ...body(replacement), idempotencyKey: 'resubmit-1' }, item.id)).request;
  assert.equal(updated.revision, 2); assert.equal(updated.status, 'pending'); assert.equal(updated.history.length, 3);
  await assert.rejects(service.review(reviewer, item.id, approval(1)), /版本已变化/);
  const approved = (await service.review(reviewer, item.id, approval(2))).request;
  assert.equal(approved.status, 'approved'); assert.equal(approved.history.at(-1).revision, 2);
  await assert.rejects(service.review(reviewer, item.id, approval(2)), /状态或材料版本/);
  assert.deepEqual(service.attachment(reviewer, bundle.id, 0).bytes, sourceFile.bytes);
});
test('approval requires material confirmation without separate buyer or seal selections', async () => {
  const service = newService(), bundle = await draft(service);
  const item = (await service.submit(owner, body(bundle))).request;
  await assert.rejects(service.review(reviewer, item.id, { ...approval(1), materialsChecked: false }), /人工确认/);
  await assert.rejects(service.review(reviewer, item.id, { action: 'approve', revision: 1 }), /人工确认/);
  assert.equal(service.get(owner, item.id).request.status, 'pending');
  const approved = (await service.review(reviewer, item.id, { ...approval(1), note: '' })).request;
  assert.equal(approved.status, 'approved');
  assert.deepEqual(approved.history.at(-1), { action: 'approve', actor: reviewer.id, at: approved.updatedAt,
    note: '', revision: 1, materialsChecked: true });
});
test('legacy review keeps one timestamp for the request and audit history when the clock advances', async () => {
  for (const action of ['approve', 'return']) {
    let tick = 0;
    const service = createLocalReimbursementService({ workflowVersion: 1, processFiles: stubProcessing,
      now: () => new Date(Date.UTC(2030, 0, 1) + tick++).toISOString() });
    const bundle = await draft(service), item = (await service.submit(owner, body(bundle))).request;
    const reviewed = (await service.review(reviewer, item.id, { ...approval(1), action, note: '合成审核说明' })).request;
    assert.equal(reviewed.status, action === 'approve' ? 'approved' : 'returned');
    assert.equal(reviewed.history.at(-1).at, reviewed.updatedAt);
  }
});
test('HTTP workflow uses real PDF processing, session/CSRF guards and private download routes', async t => {
  const server = await createPreviewServer({ seedSyncFailure: false, reimbursementService: createLocalReimbursementService({ workflowVersion: 1 }) });
  server.listen(0); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sessionResponse = await fetch(`${origin}/api/auth/session`);
  const cookie = sessionResponse.headers.get('set-cookie').split(';')[0];
  const session = await sessionResponse.json();
  const doc = await PDFDocument.create(); doc.addPage([200, 300]); const bytes = await doc.save();
  const form = () => { const data = new FormData(); data.append('files', new Blob([bytes], { type: 'application/pdf' }), 'sample.pdf'); return data; };
  const root = `${origin}/api/preview/reimbursements`;
  assert.equal((await fetch(`${root}/bundles`, { method: 'POST', body: form(), headers: { Cookie: cookie } })).status, 403);
  const response = await fetch(`${root}/bundles`, { method: 'POST', body: form(), headers: { Cookie: cookie, 'X-CSRF-Token': session.csrfToken } });
  assert.equal(response.status, 201); const uploaded = await response.json();
  const download = await fetch(`${origin}${uploaded.bundle.mergedUrl}`, { headers: { Cookie: cookie } });
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.equal((await PDFDocument.load(await download.arrayBuffer())).getPageCount(), 1);
  const analysisUrl = `${root}/bundles/${uploaded.bundle.id}/analyze`;
  const analyzeHeaders = { Cookie: cookie, 'Content-Type': 'application/json' };
  assert.equal((await fetch(analysisUrl, { method: 'POST', headers: analyzeHeaders, body: '{"page":1}' })).status, 403);
  analyzeHeaders['X-CSRF-Token'] = session.csrfToken;
  assert.equal((await fetch(analysisUrl, { method: 'POST', headers: analyzeHeaders, body: '{"page":0}' })).status, 400);
  assert.equal((await fetch(analysisUrl, { method: 'POST', headers: analyzeHeaders, body: '{"page":1,"url":"https://example.invalid"}' })).status, 400);
  const bankAccount = '0123456789012345';
  const config = await (await fetch(`${root}/config`, { headers: analyzeHeaders })).json();
  assert.deepEqual(config.bankAccount, { minLength: 16, maxLength: 19 });
  const rejected = await fetch(root, { method: 'POST', headers: analyzeHeaders, body: JSON.stringify({ ...body(uploaded.bundle), bankAccount: '0123 456789012345' }) });
  assert.equal(rejected.status, 400);
  const submitted = await fetch(root, { method: 'POST', headers: analyzeHeaders, body: JSON.stringify({ ...body(uploaded.bundle), bankAccount }) });
  assert.equal(submitted.status, 201);
  const { request } = await submitted.json(), reviewUrl = `${root}/requests/${request.id}/review`;
  assert.equal(request.bankAccount, bankAccount);
  const decision = { action: 'approve', revision: request.revision, note: '' };
  assert.equal((await fetch(reviewUrl, { method: 'POST', headers: analyzeHeaders, body: JSON.stringify(decision) })).status, 400);
  const approvedResponse = await fetch(reviewUrl, { method: 'POST', headers: analyzeHeaders,
    body: JSON.stringify({ ...decision, materialsChecked: true }) });
  assert.equal(approvedResponse.status, 200);
  const approved = (await approvedResponse.json()).request;
  assert.equal(approved.status, 'approved');
  assert.equal(approved.history.at(-1).materialsChecked, true);
  assert.equal(Object.hasOwn(approved.history.at(-1), 'titleCheck'), false);
  assert.equal(Object.hasOwn(approved.history.at(-1), 'sealCheck'), false);
  assert.equal((await fetch(`${origin}/vendor/pdfjs/build/pdf.mjs`)).status, 200);
  await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': session.csrfToken }, body: '{}' });
  assert.equal((await fetch(`${origin}${uploaded.bundle.mergedUrl}`, { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await fetch(analysisUrl, { method: 'POST', headers: analyzeHeaders, body: '{"page":1}' })).status, 401);
});
