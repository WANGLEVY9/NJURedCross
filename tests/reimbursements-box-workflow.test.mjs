import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { reimbursementTableServer } from './helpers/reimbursements-table-server.js';
import { renderTestSummary } from './helpers/reimbursement-summary-renderer.js';
import { wordFixture, pictureFixture } from './helpers/reimbursement-materials.js';
import { createReimbursementNotifier } from '../lib/reimbursements/notifications.js';
import { checksum } from '../lib/reimbursements/material-codec.js';
import ExcelJS from 'exceljs';

const final = { id: 'synthetic-final', financePermissions: ['final', 'view'] };
const owner = { id: 'synthetic-owner' };
async function invoice(width) { const pdf = await PDFDocument.create(); pdf.addPage([width, 200]); return Buffer.from(await pdf.save()); }
const review = (request, action, note = '') => ({ revision: request.revision, stateVersion: request.stateVersion, action, materialsChecked: true, note });
function api(f) {
  return async (path, { user = 'owner', body } = {}) => {
    const response = await fetch(f.origin + '/api/reimbursements' + path, { method: body ? 'POST' : 'GET',
      headers: { 'x-synthetic-user': user, ...(body ? { 'x-csrf-token': f.csrf, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) } : {}) },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
    if (response.headers.get('content-type')?.includes('application/json')) return { status: response.status, data: await response.json() };
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()), headers: response.headers };
  };
}
async function submit(call, files, key, amount = '15.00') {
  const form = new FormData();
  for (const file of files) form.append(file.kind === 'invoice' ? 'invoices' : 'supporting', new Blob([file.bytes]), file.name);
  form.append('manifest', JSON.stringify(files.map(file => ({ expenseItemId: file.expenseItemId || '', materialType: file.materialType || '' }))));
  const uploaded = await call('/bundles', { body: form }); assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  const body = { bundleId: uploaded.data.bundle.id, name: '合成申请人', purpose: '隔离验证', bankAccount: '0000000000000000',
    amount, activityId: 'synthetic-event', expenseDate: '2026-10-18', idempotencyKey: key,
    expenseItems: [{ id: 'item', category: '办公用品', label: key, amount }] };
  const result = await call('', { body }); assert.equal(result.status, 201, JSON.stringify(result.data));
  return { request: result.data.request, body };
}

test('formal HTTP workflow persists all material kinds through the real Box adapter, sends stored PDFs, and restores activity review and payments', async t => {
  const f = await reimbursementTableServer(); t.after(() => f.close()); const call = api(f);
  const service = () => f.fixture.makeService({ workflowVersion: 3, generateSummary: renderTestSummary });
  await service().summaries.saveActivity(final, { id: 'synthetic-event', name: '合成活动', date: '2026-10-20', campus: '苏州',
    location: '合成地点', participantCount: 12, description: '仅用于隔离回归的活动内容' });
  const firstFiles = [{ kind: 'invoice', expenseItemId: 'item', name: 'invoice.pdf', bytes: await invoice(301) },
    { kind: 'supporting', expenseItemId: 'item', materialType: '订单截图', name: 'order.png', bytes: pictureFixture('png') },
    { kind: 'supporting', expenseItemId: 'item', materialType: '付款截图', name: 'payment.jpg', bytes: pictureFixture('jpg') },
    { kind: 'supporting', materialType: '其他', name: 'notes.docx', bytes: wordFixture() }];
  const a = (await submit(call, firstFiles, '第一项')).request;
  const b = (await submit(call, [{ kind: 'invoice', expenseItemId: 'item', name: 'second.pdf', bytes: await invoice(350) }], '第二项', '20.00')).request;
  const storedRequest = f.fixture.rows.get(f.fixture.tables.requests).find(row => row['平台申请ID'] === a.id);
  assert.equal(storedRequest['姓名'], '合成申请人'); assert.equal(storedRequest['报销金额'], 15); assert.equal(storedRequest['报销条目'], '第一项');
  const originalRefs = JSON.parse(storedRequest['原件引用']);
  assert.deepEqual(originalRefs.map(ref => ref.name), a.bundle.originalUrls.map(file => file.name));
  assert.ok(originalRefs.every(ref => ref.material.path.startsWith('/报销材料/对象/') && f.fixture.objects.has(ref.material.sha256)));
  f.reopen();
  const beforeDownload = f.fixture.box.calls.length;
  assert.equal((await call('/mine')).data.requests.length, 2);
  assert.equal(f.fixture.box.calls.slice(beforeDownload).some(call => call.endpoint.includes('/seafhttp/')), false);
  for (const [index, file] of firstFiles.entries()) {
    const result = await call(`/bundles/${a.bundle.id}/original/${index}`);
    assert.equal(result.status, 200); assert.deepEqual(result.bytes, file.bytes);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.ok(decodeURIComponent(result.headers.get('content-disposition')).includes(a.bundle.originalUrls[index].name));
  }
  assert.match(a.bundle.originalUrls[0].name, /第一项-15.00-发票\.pdf$/);
  assert.match(a.bundle.originalUrls[1].name, /第一项-15.00-订单截图-01\.png$/);
  assert.equal((await call(`/bundles/${a.bundle.id}/original/3`)).headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.ok([403, 404].includes((await call(`/bundles/${a.bundle.id}/merged`, { user: 'material-admin' })).status));
  assert.equal((await call('', { user: 'initial-other' })).data.requests.length, 0);
  const merged = await call(`/bundles/${a.bundle.id}/merged`);
  assert.equal((await PDFDocument.load(merged.bytes)).getPageCount(), 3);
  const sent = [];
  const notifier = () => createReimbursementNotifier({ service: service(), enabled: () => true, origin: f.origin,
    getReviewer: async key => ({ id: `synthetic-contact-${key}`, email: `${key}@example.invalid`, emailVerified: true }),
    send: async message => { sent.push(message); return { ok: true }; } });
  assert.equal((await notifier().deliver()).selected, 2);
  assert.equal(sent[0].to, 'initial-suzhou@example.invalid');
  assert.deepEqual(sent[0].attachments[0].content, merged.bytes);
  assert.equal(sent[0].text.includes('0000000000000000'), false);
  assert.equal((await notifier().deliver()).selected, 0);
  const waiting = [];
  for (const request of [a, b]) {
    const result = await call(`/requests/${request.id}/review`, { user: 'initial-suzhou', body: review(request, 'initial-approve') });
    assert.equal(result.status, 200); assert.equal(result.data.request.status, 'final_pending'); waiting.push(result.data.request);
  }
  assert.equal((await notifier().deliver()).selected, 2);
  assert.equal(sent[2].to, 'final@example.invalid'); assert.equal(sent[2].attachments, undefined);
  const activity = (await call('/activities', { user: 'final' })).data.activities[0];
  const summaryBody = { activityId: activity.id, activityRevision: activity.revision, idempotencyKey: 'synthetic-summary',
    selections: waiting.map(request => ({ requestId: request.id, revision: request.revision, stateVersion: request.stateVersion })),
    itemOrder: [...waiting].reverse().map(request => ({ requestId: request.id, itemId: 'item' })),
    form: { handlerName: '合成经办', handlerPhone: 'SYNTHETIC', fillDate: '2026-10-24' } };
  const generated = await call('/summaries', { user: 'final', body: summaryBody }); assert.equal(generated.status, 201, JSON.stringify(generated.data));
  const summary = generated.data.summary; assert.equal(summary.status, 'draft'); assert.equal(summary.totalCents, 3500);
  assert.deepEqual(summary.rows.map(row => row.label), ['第二项', '第一项']); assert.equal(summary.unmergedAttachments.length, 1);
  f.reopen();
  const packet = await call(`/summaries/${summary.id}/packet`, { user: 'final' }); assert.equal(packet.status, 200);
  const pdf = await PDFDocument.load(packet.bytes); assert.equal(pdf.getPageCount(), summary.formPages + 4);
  assert.equal(pdf.getPage(summary.formPages).getWidth(), 350);
  const form = await call(`/summaries/${summary.id}/form`, { user: 'final' }); assert.equal(form.status, 200);
  assert.equal(f.fixture.objects.has(checksum(packet.bytes)), true); assert.equal(f.fixture.objects.has(checksum(form.bytes)), true);
  const storedSummary = f.fixture.rows.get(f.fixture.tables.summaries).find(row => row['平台汇总ID'] === summary.id);
  assert.equal(storedSummary['报销总金额'], 35);
  const summaryRefs = JSON.parse(storedSummary['材料引用']);
  assert.equal(summaryRefs.form.sha256, checksum(form.bytes)); assert.equal(summaryRefs.packet.sha256, checksum(packet.bytes));
  assert.equal((await service().get(owner, a.id)).request.paymentStatus, 'not-ready');
  const approved = await call(`/summaries/${summary.id}/review`, { user: 'final', body: { action: 'approve', stateVersion: summary.stateVersion,
    materialsChecked: true, scopeConfirmed: true } }); assert.equal(approved.status, 200);
  const pending = (await call('/mine')).data.requests.find(item => item.id === a.id); assert.equal(pending.paymentStatus, 'pending');
  const payment = { revision: pending.revision, stateVersion: pending.stateVersion, amount: '15.00', paidDate: '2026-10-22',
    reference: 'SYNTHETIC-RECEIPT', confirmed: true, idempotencyKey: 'synthetic-payment' };
  assert.equal((await call(`/requests/${a.id}/payment`, { user: 'admin', body: payment })).status, 409);
  const funding = await call(`/finance/summaries/${summary.id}/funding`, { user: 'final', body: { stateVersion: approved.data.summary.stateVersion,
    submittedDate: '2026-10-20', receivedDate: '2026-10-21', receivedAmount: '35.00' } }); assert.equal(funding.status, 200, JSON.stringify(funding.data));
  const financeRows = (await call('/finance', { user: 'final' })).data.items.filter(row => row.requestId === a.id);
  const itemPayment = { selections: financeRows.map(row => ({ requestId: row.requestId, itemId: row.itemId, revision: row.revision, stateVersion: row.stateVersion })),
    amount: '15.00', paidDate: '2026-10-22', reference: 'SYNTHETIC-RECEIPT', confirmed: true, idempotencyKey: 'synthetic-payment' };
  const paid = await call('/finance/payments', { user: 'final', body: itemPayment }); assert.equal(paid.status, 201, JSON.stringify(paid.data));
  f.reopen(); assert.equal((await call('/finance/payments', { user: 'final', body: itemPayment })).data.duplicate, true);
  const ledger = (await call('/ledger', { user: 'admin' })).data;
  assert.equal(ledger.totals.paidCount, 1); assert.equal(ledger.totals.waitingCount, 1);
  assert.equal(JSON.stringify(ledger).includes('0000000000000000'), false);
  const downloadCount = f.fixture.state.reads;
  const exported = await call('/ledger/export', { user: 'final', body: { mode: 'requests', columns: ['applicant', 'amount', 'status'], filters: {} } });
  assert.equal(exported.status, 200, JSON.stringify(exported.data)); assert.equal(exported.bytes.subarray(0, 2).toString(), 'PK');
  assert.equal(f.fixture.state.reads, downloadCount);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(exported.bytes);
  assert.deepEqual(workbook.worksheets[0].getRow(1).values.slice(1), ['申请人', '申请金额（元）', '处理状态']);
  assert.equal(workbook.worksheets[0].rowCount, 3);
  const itemsExport = await call('/ledger/export', { user: 'final', body: { mode: 'items', columns: ['applicant', 'expenseLabel', 'expenseAmount', 'invoiceNumber'], filters: {} } });
  assert.equal(itemsExport.status, 200);
  const detailWorkbook = new ExcelJS.Workbook(); await detailWorkbook.xlsx.load(itemsExport.bytes);
  assert.deepEqual(detailWorkbook.worksheets[0].getRow(1).values.slice(1), ['申请人', '支出项目', '支出金额（元）', '发票号码']);
  assert.equal(detailWorkbook.worksheets[0].rowCount, 3);
  assert.deepEqual(new Set(detailWorkbook.worksheets[0].getColumn(2).values.slice(2)), new Set(['第一项', '第二项']));
  assert.deepEqual(detailWorkbook.worksheets[0].getColumn(3).values.slice(2).sort((a, b) => a - b), [15, 20]);
  const document = (await f.fixture.makeStore().load()).document, refs = [];
  function visit(value) { if (!value || typeof value !== 'object') return; if (value.$material?.size) refs.push(value.$material); for (const entry of Object.values(value)) visit(entry); }
  visit(document); assert.ok(refs.length > 10);
  assert.ok(refs.every(ref => ref.path.startsWith('/报销材料/对象/') && f.fixture.objects.has(ref.sha256)));
  assert.equal([...f.fixture.box.directories].some(path => path.endsWith(' (1)')), false);
  assert.ok(f.fixture.box.calls.every(call => !['DELETE', 'PUT', 'PATCH'].includes(call.method)));
});

test('returned applications replace materials through Box; old notifications are cancelled and previous versions cannot approve', async t => {
  const f = await reimbursementTableServer(); t.after(() => f.close()); const call = api(f);
  await f.fixture.makeService({ workflowVersion: 3 }).summaries.saveActivity(final, { id: 'synthetic-event', name: '合成活动',
    date: '2026-10-20', campus: '苏州', location: '合成地点', participantCount: 12, description: '隔离验证' });
  const original = (await submit(call, [{ kind: 'invoice', expenseItemId: 'item', name: 'old.pdf', bytes: await invoice(300) }], '修订条目')).request;
  const returned = await call(`/requests/${original.id}/review`, { user: 'initial-suzhou', body: review(original, 'initial-return', '请补充最新凭证') });
  assert.equal(returned.status, 200); assert.equal(returned.data.request.status, 'returned');
  const newBytes = await invoice(360), form = new FormData(); form.append('invoices', new Blob([newBytes]), 'replacement.pdf');
  form.append('manifest', JSON.stringify([{ expenseItemId: 'item' }]));
  const upload = await call('/bundles', { body: form }); assert.equal(upload.status, 201);
  const resubmitted = await call(`/requests/${original.id}/resubmit`, { body: { bundleId: upload.data.bundle.id, amount: '15.00', name: '合成申请人',
    bankAccount: '0000000000000000', purpose: '补充材料', activityId: 'synthetic-event', expenseItems: [{ id: 'item', label: '修订条目', amount: '15.00' }], idempotencyKey: 'replacement' } });
  assert.equal(resubmitted.status, 200); assert.equal(resubmitted.data.request.revision, 2); f.reopen();
  const restored = (await call('/mine')).data.requests[0]; assert.equal(restored.revision, 2);
  assert.deepEqual((await call(`/bundles/${restored.bundle.id}/original/0`)).bytes, newBytes);
  const stale = await call(`/requests/${restored.id}/review`, { user: 'initial-suzhou', body: review(original, 'initial-approve') }); assert.equal(stale.status, 409);
  const sent = [], notifier = createReimbursementNotifier({ service: f.fixture.makeService({ workflowVersion: 3 }), enabled: () => true, origin: f.origin,
    getReviewer: async () => ({ id: 'synthetic-reviewer', email: 'reviewer@example.invalid', emailVerified: true }),
    send: async message => { sent.push(message); return { ok: true }; } });
  assert.equal((await notifier.deliver()).selected, 1); assert.equal(sent.length, 1);
  assert.match(sent[0].text, /第 2 版/);
  assert.deepEqual(sent[0].attachments[0].content, (await call(`/bundles/${restored.bundle.id}/merged`)).bytes);
});

test('an uncertain Box upload never publishes a material batch; retry overwrites the same content address without duplicate directories', async t => {
  const f = await reimbursementTableServer(); t.after(() => f.close());
  const service = () => f.fixture.makeService({ workflowVersion: 3 }), bytes = await invoice(310);
  const files = [{ kind: 'invoice', expenseItemId: 'item', name: 'synthetic.pdf', bytes }];
  f.fixture.state.loseUploadAcknowledgement = true;
  await assert.rejects(service().preprocess(owner, files), { code: 'reimbursement_box_save_failed' });
  assert.equal(f.fixture.rows.get(f.fixture.tables.journal).length, 0);
  assert.equal(f.fixture.objects.size, 1);
  const acceptedHash = f.fixture.objects.keys().next().value;
  const result = await service().preprocess(owner, files);
  assert.ok(result.bundle.id); assert.equal((await f.fixture.makeStore().load()).document.maps.bundles.length, 1);
  assert.equal(f.fixture.objects.has(acceptedHash), true);
  assert.equal(f.fixture.objects.has(checksum(bytes)), true);
  assert.deepEqual((await service().attachment(owner, result.bundle.id, 0)).bytes, bytes);
  assert.equal([...f.fixture.box.directories].some(path => path.endsWith(' (1)')), false);
});
