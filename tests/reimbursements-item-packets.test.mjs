import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PDFDocument, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createLocalReimbursementService } from '../lib/reimbursements/local-service.js';
import { generateItemPackets } from '../lib/reimbursements/item-packets.js';
import { processPdfs } from '../lib/reimbursements/pdf.js';
import { reimbursementMaterialGroups } from '../public/app/shared/reimbursement-groups.js';
import { createPreviewServer } from '../scripts/preview-materials.mjs';
import { wordFixture, pictureFixture } from './helpers/reimbursement-materials.js';

const owner = { id: 'packet-owner' }, admin = { id: 'packet-admin', canReview: true };
async function pdf(label, pages = 1, size = [300, 200], rotate = false) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index++) {
    const page = doc.addPage(size); page.drawText(`${label}-${index + 1}`, { x: 30, y: 70, size: 12 });
    if (rotate) page.setRotation(degrees(90));
  }
  return Buffer.from(await doc.save());
}
async function setup(options = {}) {
  const service = createLocalReimbursementService({ workflowVersion: 1, processFiles: processPdfs, ...options });
  await service.summaries.saveActivity(admin, { id: 'packet-event', name: '合成材料整理活动' });
  const files = [
    { name: 'other.pdf', kind: 'supporting', materialType: '领取单', expenseItemId: 'mouse', bytes: await pdf('OTHER') },
    { name: 'invoice-b.pdf', kind: 'invoice', expenseItemId: 'travel', bytes: await pdf('INVOICE-B', 1, [400, 200]) },
    { name: 'payment.jpg', kind: 'supporting', materialType: '付款截图', expenseItemId: 'mouse', bytes: pictureFixture('jpg') },
    { name: 'word.docx', kind: 'supporting', materialType: '其他', expenseItemId: 'mouse', bytes: wordFixture() },
    { name: 'order.png', kind: 'supporting', materialType: '订单截图', expenseItemId: 'mouse', bytes: pictureFixture('png') },
    { name: 'invoice-a.pdf', kind: 'invoice', expenseItemId: 'mouse', bytes: await pdf('INVOICE-A', 2, [300, 200], true) },
    { name: 'common.pdf', kind: 'supporting', materialType: '其他', bytes: await pdf('COMMON') },
  ];
  const { bundle } = await service.preprocess(owner, files);
  const input = { bundleId: bundle.id, name: '合成报销人', amount: '20.00', purpose: '项目材料验证', activityId: 'packet-event', idempotencyKey: bundle.id,
    expenseItems: [{ id: 'mouse', label: '鼠标', category: '办公用品', amount: '15.00' }, { id: 'travel', label: '交通', category: '交通费', amount: '5.00' }] };
  const { request } = await service.submit(owner, input);
  const body = { revision: request.revision, bundleId: bundle.id, materialsChecked: true };
  return { service, files, bundle, request, body, input };
}

test('grouping uses stable expense IDs, orders evidence and preserves common and unassigned attachments', () => {
  const groups = reimbursementMaterialGroups({ amountCents: 100, expenseItems: [{ id: 'a', label: '同名', amountCents: 50 }, { id: 'b', label: '同名', amountCents: 50 }],
    bundle: { originalUrls: [{ kind: 'supporting', expenseItemId: 'a', materialType: '其他' }, { kind: 'supporting', materialType: '其他' },
      { kind: 'invoice', expenseItemId: 'b' }, { kind: 'invoice', expenseItemId: 'missing' }, { kind: 'legacy' },
      { kind: 'supporting', expenseItemId: 'a', materialType: '付款截图' }, { kind: 'supporting', expenseItemId: 'a', materialType: '订单截图' }] } });
  assert.deepEqual(groups.map(group => group.files.map(file => file.index)), [[6, 5, 0], [2], [1], [3, 4]]);
  assert.deepEqual(groups.map(group => group.kind), ['expense', 'expense', 'common', 'unassigned']);
});

test('real generation copies exact pages with geometry, makes order/payment PDFs and retains Word originals', async () => {
  const { service, files, request, body } = await setup();
  const history = service.get(owner, request.id).request.history;
  const { packets } = await service.materialPackets.create(admin, request.id, body);
  assert.equal(packets.groups.length, 3);
  assert.deepEqual(packets.groups[0].merged.sources.map(source => [source.index, source.startPage, source.endPage]), [[5, 1, 2], [4, 3, 3], [2, 4, 4], [0, 5, 5]]);
  assert.deepEqual(packets.groups[0].orderPayment.sources.map(source => source.index), [4, 2]);
  assert.deepEqual(packets.groups[0].originalOnly.map(file => file.index), [3]);
  assert.equal(packets.groups[0].merged.name, '合成报销人-鼠标-15.00-合并材料-01.pdf');
  assert.equal(packets.groups[1].merged.pageCount, 1); assert.equal(packets.groups[2].kind, 'common');
  const file = service.materialPackets.download(admin, request.id, 1, 0, 'merged');
  const generated = await PDFDocument.load(file.bytes);
  assert.equal(generated.getPageCount(), 5);
  assert.deepEqual(generated.getPage(0).getSize(), { width: 300, height: 200 });
  assert.equal(generated.getPage(0).getRotation().angle, 90);
  const task = getDocument({ data: new Uint8Array(file.bytes), verbosity: 0 });
  const parsed = await task.promise;
  try {
    assert.ok((await (await parsed.getPage(1)).getTextContent()).items.some(item => item.str === 'INVOICE-A-1'));
    assert.ok((await (await parsed.getPage(5)).getTextContent()).items.some(item => item.str === 'OTHER-1'));
  } finally { await task.destroy(); }
  for (const [index, original] of files.entries()) assert.deepEqual(service.attachment(admin, request.bundle.id, index).bytes, original.bytes);
  const current = service.get(owner, request.id).request;
  assert.equal(current.status, 'pending'); assert.equal(current.revision, 1); assert.deepEqual(current.history, history);
  assert.equal('packets' in current, false);
});

test('generation is explicit, permission and version guarded, and concurrent retries reuse a single derivative', async () => {
  let calls = 0;
  const { service, request, body } = await setup({ generatePackets: async input => { calls++; return generateItemPackets(input); } });
  assert.equal(service.materialPackets.list(admin, request.id).packets, null);
  assert.throws(() => service.materialPackets.list(owner, request.id), { statusCode: 403 });
  assert.throws(() => service.materialPackets.create(owner, request.id, body), { statusCode: 403 });
  await assert.rejects(service.materialPackets.create(admin, request.id, { ...body, materialsChecked: false }), { statusCode: 400 });
  await assert.rejects(service.materialPackets.create(admin, request.id, { ...body, revision: 0 }), { statusCode: 409 });
  await assert.rejects(service.materialPackets.create(admin, request.id, { ...body, bundleId: 'other' }), { statusCode: 409 });
  const results = await Promise.all([service.materialPackets.create(admin, request.id, body), service.materialPackets.create(admin, request.id, body)]);
  assert.equal(calls, 1); assert.equal(results[1].duplicate, true); assert.deepEqual(results[0].packets, results[1].packets);
  assert.throws(() => service.materialPackets.download(owner, request.id, 1, 0, 'merged'), { statusCode: 403 });
  assert.throws(() => service.materialPackets.download(admin, request.id, 0, 0, 'merged'), { statusCode: 409 });
  assert.throws(() => service.materialPackets.download(admin, request.id, 1, 99, 'merged'), { statusCode: 404 });
  const download = service.materialPackets.download(admin, request.id, 1, 0, 'merged');
  download.bytes.fill(0); assert.notEqual(service.materialPackets.download(admin, request.id, 1, 0, 'merged').bytes[0], 0);
});

test('generation failure is atomic; returned and replaced versions cannot reuse stale derivatives', async () => {
  let fail = true;
  const { service, request, body, files, input } = await setup({ generatePackets: async data => { if (fail) throw new Error('synthetic generation failure'); return generateItemPackets(data); } });
  await assert.rejects(service.materialPackets.create(admin, request.id, body));
  assert.equal(service.materialPackets.list(admin, request.id).packets, null);
  assert.equal(service.get(owner, request.id).request.history.length, 1);
  fail = false; await service.materialPackets.create(admin, request.id, body);
  await service.review(admin, request.id, { action: 'return', revision: 1, note: '合成补充要求' });
  await assert.rejects(service.materialPackets.create(admin, request.id, body), { statusCode: 409 });
  const { bundle } = await service.preprocess(owner, files);
  await service.submit(owner, { ...input, bundleId: bundle.id, idempotencyKey: bundle.id }, request.id);
  assert.equal(service.materialPackets.list(admin, request.id).packets, null);
  await assert.rejects(service.materialPackets.create(admin, request.id, body), { statusCode: 409 });
  assert.throws(() => service.materialPackets.download(admin, request.id, 1, 0, 'merged'), { statusCode: 409 });
});

test('legacy associations are not guessed; Word-only groups retain all originals with no empty PDF download', async () => {
  const service = createLocalReimbursementService({ workflowVersion: 1, processFiles: processPdfs });
  const { bundle } = await service.preprocess(owner, [{ name: 'legacy.pdf', bytes: await pdf('LEGACY') }]);
  const { request } = await service.submit(owner, { bundleId: bundle.id, name: '合成旧记录', amount: '1.00', purpose: '旧材料', idempotencyKey: bundle.id });
  await assert.rejects(service.materialPackets.create(admin, request.id, { revision: 1, bundleId: bundle.id, materialsChecked: true }), /可靠/);
  await service.summaries.saveActivity(admin, { id: 'word-event', name: 'Word 合成活动' });
  const word = (await service.preprocess(owner, [{ name: 'word.docx', bytes: wordFixture(), kind: 'supporting', expenseItemId: 'word', materialType: '其他' }])).bundle;
  const claim = (await service.submit(owner, { bundleId: word.id, name: '合成 Word', amount: '1.00', purpose: 'Word 材料', idempotencyKey: word.id,
    activityId: 'word-event', expenseItems: [{ id: 'word', label: 'Word 条目', amount: '1.00' }] })).request;
  const { packets } = await service.materialPackets.create(admin, claim.id, { revision: 1, bundleId: word.id, materialsChecked: true });
  assert.equal(packets.groups[0].merged.url, null); assert.equal(packets.groups[0].originalOnly.length, 1);
  assert.throws(() => service.materialPackets.download(admin, claim.id, 1, 0, 'merged'), { statusCode: 404 });
});

test('HTTP packet routes retain CSRF, reviewer access, private PDF headers and replay semantics', async t => {
  const { service, request, body } = await setup();
  const server = await createPreviewServer({ reimbursementService: service, portalActor: admin, seedSyncFailure: false });
  server.listen(0); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`, root = `${origin}/api/preview/reimbursements/requests/${request.id}/material-packets`;
  const auth = await fetch(`${origin}/api/auth/session`), session = await auth.json();
  const headers = { Cookie: auth.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' };
  assert.equal((await fetch(root, { method: 'POST', headers: { Cookie: headers.Cookie }, body: JSON.stringify(body) })).status, 403);
  assert.equal((await fetch(root, { method: 'POST', headers, body: JSON.stringify(body) })).status, 201);
  assert.equal((await fetch(root, { method: 'POST', headers, body: JSON.stringify(body) })).status, 200);
  const response = await fetch(root + '/1/0/merged', { headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.ok(response.headers.get('content-disposition').includes(encodeURIComponent('合成报销人-鼠标-15.00-合并材料-01.pdf')));
  assert.equal((await PDFDocument.load(await response.arrayBuffer())).getPageCount(), 5);
  assert.equal((await fetch(root + '/1/999/merged', { headers })).status, 404);
  const outsider = await createPreviewServer({ reimbursementService: service, portalActor: owner, seedSyncFailure: false });
  outsider.listen(0); await once(outsider, 'listening'); t.after(() => new Promise(resolve => outsider.close(resolve)));
  const deniedRoot = `http://127.0.0.1:${outsider.address().port}/api/preview/reimbursements/requests/${request.id}/material-packets`;
  assert.equal((await fetch(deniedRoot)).status, 403);
  assert.equal((await fetch(deniedRoot + '/1/0/merged')).status, 403);
});
