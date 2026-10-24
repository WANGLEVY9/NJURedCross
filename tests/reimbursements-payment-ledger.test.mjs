import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PDFDocument } from 'pdf-lib';
import { createLocalReimbursementService } from '../lib/reimbursements/local-service.js';
import { generateItemPackets } from '../lib/reimbursements/item-packets.js';
import { processPdfs } from '../lib/reimbursements/pdf.js';
import { createPreviewServer } from '../scripts/preview-materials.mjs';

const owner = { id: 'payment-owner' }, initial = { id: 'payment-initial', financePermissions: ['initial'] },
  final = { id: 'payment-final', financePermissions: ['final'] }, payer = { id: 'payment-operator', financePermissions: ['payment'] },
  viewer = { id: 'payment-viewer', financePermissions: ['view'] };
function zipEntries(bytes) {
  const entries = {}; let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extra; entries[name] = bytes.subarray(start, start + size).toString(); offset = start + size;
  }
  return entries;
}
const body = request => ({ revision: request.revision, stateVersion: request.stateVersion, amount: '15.00', paidDate: '2026-10-12',
  reference: 'SYNTHETIC-RECEIPT-001', note: '合成登记，不是银行转账', confirmed: true, idempotencyKey: 'payment-one' });
async function setup({ bankAccount = '0123456789012345' } = {}) {
  const service = createLocalReimbursementService({ workflowVersion: 2, processFiles: processPdfs, generatePackets: generateItemPackets, now: () => '2026-10-12T08:00:00Z' });
  await service.summaries.saveActivity(final, { id: 'payment-event', name: '合成付款活动' });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 200]); const bytes = Buffer.from(await pdf.save());
  async function claim(person = owner, amount = '15.00', items = [{ id: 'item', label: '鼠标', amount: '15.00' }]) {
    const { bundle } = await service.preprocess(person, [{ name: 'invoice.pdf', kind: 'invoice', expenseItemId: items[0].id, bytes }]);
    return (await service.submit(person, { name: '=SYNTHETIC-NAME', purpose: '合成付款申请', amount, bankAccount,
      bundleId: bundle.id, idempotencyKey: bundle.id, activityId: 'payment-event', expenseDate: '2026-10-11', expenseItems: items })).request;
  }
  async function approve(request) {
    await service.materialPackets.create(initial, request.id, { revision: request.revision, bundleId: request.bundle.id, materialsChecked: true });
    const sent = (await service.review(initial, request.id, { action: 'initial-approve', revision: request.revision, stateVersion: request.stateVersion, materialsChecked: true })).request;
    return (await service.review(final, request.id, { action: 'final-approve', revision: sent.revision, stateVersion: sent.stateVersion, materialsChecked: true })).request;
  }
  return { service, claim, approve, request: await claim() };
}

test('only final-approved requests with a valid recipient and payment permission can be registered', async () => {
  const { service, request, approve } = await setup();
  const full = { ...payer, financePermissions: ['payment', 'view'] };
  await assert.rejects(service.registerPayment(full, request.id, body(request)), { statusCode: 409 });
  const approved = await approve(request);
  assert.throws(() => service.registerPayment(final, approved.id, body(approved)), { statusCode: 403 });
  assert.throws(() => service.registerPayment({ id: 'material-only', canReview: true }, approved.id, body(approved)), { statusCode: 403 });
  await assert.rejects(service.registerPayment(payer, approved.id, { ...body(approved), confirmed: false }), { statusCode: 400 });
  await assert.rejects(service.registerPayment(payer, approved.id, { ...body(approved), amount: '15.01' }), { statusCode: 400 });
  await assert.rejects(service.registerPayment(payer, approved.id, { ...body(approved), paidDate: '2026-10-13' }), { statusCode: 400 });
  await assert.rejects(service.registerPayment(payer, approved.id, { ...body(approved), bankAccount: '1111111111111111' }), { statusCode: 400 });
  assert.equal(service.get(owner, approved.id).request.paymentStatus, 'pending');
  const missing = await setup({ bankAccount: undefined });
  // Passing undefined above uses the helper default; explicitly omit on a new request instead.
  const noCardService = createLocalReimbursementService({ workflowVersion: 2, processFiles: processPdfs, generatePackets: generateItemPackets });
  const raw = (await missing.service.attachment(owner, missing.request.bundle.id, 0)).bytes;
  const { bundle } = await noCardService.preprocess(owner, [{ name: 'invoice.pdf', kind: 'invoice', expenseItemId: 'item', bytes: raw }]);
  await noCardService.summaries.saveActivity(final, { id: 'event', name: '缺银行卡合成活动' });
  const noCard = (await noCardService.submit(owner, { name: '测试', amount: '15.00', purpose: '缺卡验证', activityId: 'event',
    bundleId: bundle.id, idempotencyKey: bundle.id, expenseItems: [{ id: 'item', label: '鼠标', amount: '15.00' }] })).request;
  await noCardService.materialPackets.create(initial, noCard.id, { revision: 1, bundleId: bundle.id, materialsChecked: true });
  const sent = (await noCardService.review(initial, noCard.id, { action: 'initial-approve', revision: 1, stateVersion: 1, materialsChecked: true })).request;
  const accepted = (await noCardService.review(final, noCard.id, { action: 'final-approve', revision: 1, stateVersion: sent.stateVersion, materialsChecked: true })).request;
  assert.equal(accepted.paymentEligibility.eligible, false);
  await assert.rejects(noCardService.registerPayment(payer, accepted.id, { ...body(accepted), paidDate: '2020-01-01' }), { statusCode: 409 });
});

test('payment registration preserves review and materials, is replay-safe and records one immutable history entry', async () => {
  const { service, request, approve } = await setup(); const approved = await approve(request), input = body(approved);
  const original = service.attachment(owner, approved.bundle.id, 0).bytes;
  const paid = (await service.registerPayment(payer, approved.id, input)).request;
  assert.equal(paid.status, 'approved'); assert.equal(paid.statusLabel, '已打款'); assert.equal(paid.paymentStatus, 'paid');
  assert.equal(paid.stateVersion, approved.stateVersion + 1); assert.deepEqual(paid.finalReview, approved.finalReview);
  assert.equal(paid.paymentRecord.actor, payer.id); assert.equal(paid.paymentRecord.amountCents, 1500);
  assert.equal(paid.history.at(-1).action, 'payment-recorded');
  assert.equal((await service.registerPayment(payer, paid.id, input)).duplicate, true);
  await assert.rejects(service.registerPayment(payer, paid.id, { ...input, reference: 'changed' }), { statusCode: 409 });
  await assert.rejects(service.registerPayment(payer, paid.id, { ...input, idempotencyKey: 'another', stateVersion: paid.stateVersion }), { statusCode: 409 });
  assert.deepEqual(service.attachment(owner, paid.bundle.id, 0).bytes, original);
  assert.equal(service.get(owner, paid.id).request.history.length, 4); assert.equal(paid.summaryEligibility.eligible, true);
});

test('concurrent registration with different keys succeeds once and reports totals without exposing bank accounts', async () => {
  const { service, request, approve, claim } = await setup(); const approved = await approve(request);
  await claim({ id: 'other-owner' });
  const results = await Promise.allSettled([service.registerPayment(payer, approved.id, body(approved)),
    service.registerPayment(payer, approved.id, { ...body(approved), idempotencyKey: 'competing' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const ledger = service.ledger.list(viewer, {});
  assert.equal(ledger.totals.count, 2); assert.equal(ledger.totals.paidCents, 1500); assert.equal(ledger.totals.waitingCents, 0);
  assert.equal(service.ledger.list(payer, {}).totals.count, 1);
  assert.equal(JSON.stringify(ledger).includes('0123456789012345'), false);
  assert.equal(JSON.stringify(ledger).includes('bankAccount'), false);
  assert.equal(service.ledger.list(viewer, { status: 'paid' }).rows.length, 1);
  assert.equal(service.ledger.list(viewer, { status: 'approved' }).rows.length, 0);
  assert.equal(service.ledger.list(viewer, { activityId: 'wrong' }).rows.length, 0);
  assert.equal(service.ledger.list(viewer, { from: '2026-10-12' }).rows.length, 0);
  assert.throws(() => service.ledger.list(owner, {}), { statusCode: 403 });
  assert.throws(() => service.ledger.list(viewer, { from: '2026-10-12', to: '2026-10-11' }), { statusCode: 400 });
});

test('Excel exports only chosen columns, preserves literal formulas and omits private fields; detail amounts do not repeat', async () => {
  const { service, request, claim } = await setup();
  const input = { mode: 'requests', columns: ['code', 'applicant', 'amount'], filters: {} };
  const file = service.ledger.exportFile(viewer, input), entries = zipEntries(file.bytes);
  assert.ok(entries['xl/workbook.xml'].includes('报销总表'));
  const sheet = entries['xl/worksheets/sheet1.xml'];
  assert.ok(sheet.includes('=SYNTHETIC-NAME')); assert.ok(sheet.includes('t="inlineStr"')); assert.equal(sheet.includes('<f>'), false);
  assert.equal(file.bytes.includes(Buffer.from('0123456789012345')), false);
  assert.equal(sheet.includes('费用发生日期'), false); assert.ok(sheet.includes('<v>15</v>'));
  for (const column of ['bankAccount', 'idCard', '__proto__', '银行卡号', '身份证']) assert.throws(() => service.ledger.exportFile(viewer, { ...input, columns: [column] }), { statusCode: 400 });
  assert.throws(() => service.ledger.exportFile(initial, input), { statusCode: 403 });
  assert.throws(() => service.ledger.exportFile(viewer, { ...input, columns: ['amount', 'amount'] }), { statusCode: 400 });
  const second = await claim({ id: 'detail-owner' }, '20.00', [{ id: 'item', label: '鼠标', amount: '15.00' }, { id: 'second', label: '交通', amount: '5.00' }]);
  const detail = zipEntries(service.ledger.exportFile(viewer, { mode: 'items', columns: ['amount', 'expenseLabel', 'expenseAmount', 'invoiceNumber'], filters: { search: second.code } }).bytes)['xl/worksheets/sheet1.xml'];
  assert.equal((detail.match(/<v>20<\/v>/g) || []).length, 1);
  assert.ok(detail.includes('<v>15</v>')); assert.ok(detail.includes('<v>5</v>')); assert.ok(detail.includes('待核对'));
  assert.equal(service.get(owner, request.id).request.history.length, 1);
});

test('HTTP guards protect payment and export routes and return private spreadsheets with selected columns', async t => {
  const { service, request, approve } = await setup(); const approved = await approve(request);
  const actor = { id: payer.id, financePermissions: ['payment', 'view'] };
  const server = await createPreviewServer({ reimbursementService: service, portalActor: actor, seedSyncFailure: false });
  server.listen(0); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  const auth = await fetch(root + '/api/auth/session'), session = await auth.json();
  const headers = { Cookie: auth.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' };
  const payment = root + `/api/preview/reimbursements/requests/${approved.id}/payment`;
  assert.equal((await fetch(payment, { method: 'POST', headers: { Cookie: headers.Cookie }, body: JSON.stringify(body(approved)) })).status, 403);
  assert.equal((await fetch(payment, { method: 'POST', headers, body: JSON.stringify(body(approved)) })).status, 201);
  assert.equal((await fetch(payment, { method: 'POST', headers, body: JSON.stringify(body(approved)) })).status, 200);
  const exportUrl = root + '/api/preview/reimbursements/ledger/export', input = { mode: 'requests', columns: ['code', 'status'], filters: { status: 'paid' } };
  assert.equal((await fetch(exportUrl, { method: 'POST', headers: { Cookie: headers.Cookie }, body: JSON.stringify(input) })).status, 403);
  const response = await fetch(exportUrl, { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('content-type').includes('spreadsheetml'));
  assert.ok(zipEntries(Buffer.from(await response.arrayBuffer()))['xl/worksheets/sheet1.xml'].includes('已打款'));
  const ledger = await (await fetch(root + '/api/preview/reimbursements/ledger', { headers })).json();
  assert.equal(ledger.rows[0].canRegisterPayment, false);
});

test('invoice detail export uses the correct source page and cached six fields without running recognition or changing originals', async () => {
  let analysisCalls = 0;
  const values = { buyerName: '合成购买方', buyerTaxId: '001234567890123456', sellerName: '合成开票方',
    invoiceNumber: '00012345678901234567', invoiceDate: '2026-10-11', totalAmount: '15.00' };
  const service = createLocalReimbursementService({ workflowVersion: 2, processFiles: processPdfs, analyzePage: async () => {
    analysisCalls++;
    return { invoice: { fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { state: 'extracted', value }])) } };
  } });
  await service.summaries.saveActivity(final, { id: 'cache-event', name: '合成缓存活动' });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 200]); const bytes = Buffer.from(await pdf.save());
  const { bundle } = await service.preprocess(owner, [
    { name: 'first.pdf', kind: 'invoice', expenseItemId: 'first', bytes },
    { name: 'second.pdf', kind: 'invoice', expenseItemId: 'second', bytes }]);
  const request = (await service.submit(owner, { name: '合成申请人', purpose: '发票导出缓存验证', amount: '20.00', activityId: 'cache-event',
    bankAccount: '0123456789012345', bundleId: bundle.id, idempotencyKey: bundle.id,
    expenseItems: [{ id: 'first', label: '项目一', amount: '5.00' }, { id: 'second', label: '项目二', amount: '15.00' }] })).request;
  await service.analyze(owner, bundle.id, 2);
  const file = service.ledger.exportFile(viewer, { mode: 'items', columns: ['expenseLabel', 'buyerName', 'buyerTaxId', 'sellerName', 'invoiceNumber', 'invoiceDate', 'invoiceAmount'], filters: {} });
  const sheet = zipEntries(file.bytes)['xl/worksheets/sheet1.xml'], dataRows = sheet.match(/<row r="[23]">.*?<\/row>/g);
  assert.equal(analysisCalls, 1);
  assert.ok(dataRows[0].includes('待核对')); assert.equal(dataRows[0].includes(values.invoiceNumber), false);
  for (const value of Object.values(values)) assert.ok(dataRows[1].includes(value));
  assert.ok(dataRows[1].includes('second.pdf · 第 1 页'));
  assert.deepEqual(service.attachment(owner, bundle.id, 1).bytes, bytes);
  assert.equal(service.get(owner, request.id).request.history.length, 1);
});
