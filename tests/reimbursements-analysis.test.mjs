import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { redSealCandidates } from '../lib/reimbursements/seal-candidates.js';
import { processLocalAnalysis } from '../lib/reimbursements/analysis-processor.js';
import { createLocalReimbursementService } from '../lib/reimbursements/local-service.js';

const owner = { id: 'alice' }, other = { id: 'bob' }, reviewer = { id: 'reviewer', canReview: true };
const files = [{ name: 'first.pdf', bytes: Buffer.from('original-first') }, { name: 'second.pdf', bytes: Buffer.from('original-second') }];
const processFiles = async () => ({ merged: Buffer.from('merged'), pageCount: 3, sources: [
  { name: 'first.pdf', startPage: 1, endPage: 2, pages: 2, checks: [{ page: 1, state: 'unknown' }, { page: 2, state: 'unknown' }] },
  { name: 'second.pdf', startPage: 3, endPage: 3, pages: 1, checks: [{ page: 1, state: 'unknown' }] },
] });
const result = { buyer: { state: 'matched', name: '南京大学', method: 'local-ocr', confidence: 90 },
  seal: { state: 'candidate', regions: [], message: '疑似印章' } };

test('red circular regions are candidates; red text/solid logos and no red are not treated as confirmed seals', () => {
  const canvas = createCanvas(500, 500), ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 500, 500);
  assert.equal(redSealCandidates(ctx.getImageData(0, 0, 500, 500)).state, 'not-detected');
  ctx.strokeStyle = '#c51010'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(250, 250, 60, 0, Math.PI * 2); ctx.stroke();
  const hint = redSealCandidates(ctx.getImageData(0, 0, 500, 500));
  assert.equal(hint.state, 'candidate'); assert.equal(hint.regions.length, 1);
  assert.match(hint.message, /疑似/);
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 500, 500); ctx.fillStyle = 'red'; ctx.fillRect(100, 100, 100, 100);
  assert.equal(redSealCandidates(ctx.getImageData(0, 0, 500, 500)).state, 'not-detected');
});
test('uncolored black/white seal shapes stay uncertain instead of proving absence', () => {
  const canvas = createCanvas(400, 400), ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 400, 400);
  ctx.strokeStyle = 'black'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(200, 200, 60, 0, Math.PI * 2); ctx.stroke();
  const hint = redSealCandidates(ctx.getImageData(0, 0, 400, 400));
  assert.equal(hint.state, 'not-detected'); assert.match(hint.message, /不能据此认定无章/);
});
test('analysis uses the original source-page mapping and keeps original bytes intact', async () => {
  let input;
  const service = createLocalReimbursementService({ processFiles, analyzePage: async value => { input = value; return result; } });
  const bundle = (await service.preprocess(owner, files)).bundle;
  const analysis = (await service.analyze(owner, bundle.id, 3)).analysis;
  assert.equal(input.pageNumber, 1); assert.deepEqual(input.bytes, files[1].bytes);
  assert.equal(analysis.page, 3); assert.equal(analysis.sourcePage, 1); assert.equal(analysis.sourceName, 'second.pdf');
  assert.deepEqual(service.attachment(owner, bundle.id, 1).bytes, files[1].bytes);
  assert.deepEqual(service.attachment(owner, bundle.id).bytes, Buffer.from('merged'));
});
test('analysis denies other owners and unsubmitted reviewer access, including cached results', async () => {
  let calls = 0;
  const service = createLocalReimbursementService({ processFiles, analyzePage: async () => { calls++; return result; } });
  const bundle = (await service.preprocess(owner, files)).bundle;
  await assert.rejects(service.analyze(other, bundle.id, 1), /不存在/);
  await assert.rejects(service.analyze(reviewer, bundle.id, 1), /不存在/);
  await service.analyze(owner, bundle.id, 1);
  await assert.rejects(service.analyze(other, bundle.id, 1), /不存在/);
  await service.submit(owner, { name: '测试人', amount: '1.00', purpose: '测试', bundleId: bundle.id, idempotencyKey: 'one' });
  assert.equal((await service.analyze(reviewer, bundle.id, 1)).cached, true);
  assert.equal(calls, 1);
});
test('concurrent duplicate analysis shares work, cache preserves a copy and does not change approval status', async () => {
  let calls = 0;
  const service = createLocalReimbursementService({ processFiles, analyzePage: async () => { calls++; return result; } });
  const bundle = (await service.preprocess(owner, files)).bundle;
  const submitted = await service.submit(owner, { name: '测试人', amount: '1.00', purpose: '测试', bundleId: bundle.id, idempotencyKey: 'one' });
  const values = await Promise.all([service.analyze(owner, bundle.id, 1), service.analyze(owner, bundle.id, 1)]);
  assert.equal(calls, 1); assert.equal(values[0].analysis.buyer.name, '南京大学');
  values[0].analysis.buyer.name = 'tampered';
  assert.equal((await service.analyze(owner, bundle.id, 1)).analysis.buyer.name, '南京大学');
  assert.equal(service.get(owner, submitted.request.id).request.status, 'pending');
  await assert.rejects(service.analyze(owner, bundle.id, 0), /有效/);
  await assert.rejects(service.analyze(owner, bundle.id, 4), /有效/);
});
test('real local OCR and raster rendering recognize a synthetic image-only PDF without network access', async () => {
  const png = await readFile(new URL('./fixtures/reimbursement-ocr-synthetic.png', import.meta.url));
  const doc = await PDFDocument.create(); const image = await doc.embedPng(png);
  doc.addPage([595, 420]).drawImage(image, { x: 0, y: 0, width: 595, height: 420 });
  const bytes = Buffer.from(await doc.save()), original = Buffer.from(bytes);
  const analysis = await processLocalAnalysis({ bytes, pageNumber: 1, previousCheck: { state: 'unknown', textAvailable: false } });
  assert.equal(analysis.buyer.method, 'local-ocr'); assert.equal(analysis.buyer.name, '南京大学');
  assert.equal(analysis.buyer.state, 'matched'); assert.equal(analysis.seal.state, 'candidate');
  assert.match(analysis.textSnippet, /测试材料/);
  assert.deepEqual(bytes, original);
});

test('failed recognition is not cached and a retry can succeed without altering the request', async () => {
  let calls = 0;
  const service = createLocalReimbursementService({ processFiles, analyzePage: async () => {
    if (++calls === 1) throw Object.assign(new Error('本地识别失败'), { statusCode: 503 });
    return result;
  } });
  const bundle = (await service.preprocess(owner, files)).bundle;
  const item = (await service.submit(owner, { name: '测试人', amount: '1.00', purpose: '测试', bundleId: bundle.id, idempotencyKey: 'one' })).request;
  await assert.rejects(service.analyze(owner, bundle.id, 1), /识别失败/);
  assert.deepEqual(service.get(owner, item.id).request.bundle.analyses, []);
  assert.equal((await service.analyze(owner, bundle.id, 1)).analysis.buyer.state, 'matched');
  assert.equal(calls, 2);
  const updated = service.get(owner, item.id).request;
  assert.equal(updated.status, 'pending'); assert.equal(updated.revision, 1); assert.equal(updated.history.length, 1);
});
