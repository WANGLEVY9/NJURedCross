import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { reimbursementTableFixture } from './helpers/reimbursement-table-fixture.js';
import { createReimbursementBox } from '../lib/reimbursements/box-storage.js';
import { checksum } from '../lib/reimbursements/material-codec.js';
import { createReimbursementState } from '../lib/reimbursements/state.js';
import { createMaterialCodec } from '../lib/reimbursements/material-codec.js';

const owner = { id: 'synthetic-owner', studentId: 'SYNTHETIC', email: 'synthetic@example.invalid' },
  initial = { id: 'synthetic-initial', financePermissions: ['initial'] }, final = { id: 'synthetic-final', financePermissions: ['final', 'view', 'payment'] };
const activity = { id: 'synthetic-event', name: '合成活动', date: '2026-10-20', location: '合成地点',
  participantCount: 1, description: '合成用途', unitName: '合成单位', fundAccount: 'SYNTHETIC' };
const decision = (request, action) => ({ revision: request.revision, stateVersion: request.stateVersion, action, materialsChecked: true });
async function claim(f, service) {
  const pdf = await PDFDocument.create(); pdf.addPage([300, 200]); const bytes = Buffer.from(await pdf.save());
  const { bundle } = await service.preprocess(owner, [{ name: 'synthetic.pdf', bytes, kind: 'invoice', expenseItemId: 'item' }]);
  const input = { name: '合成申请人', purpose: '合成事由', amount: '15.00', bankAccount: '0000000000000000', bundleId: bundle.id,
    idempotencyKey: bundle.id, activityId: activity.id, expenseItems: [{ id: 'item', label: '合成条目', amount: '15.00' }] };
  const { request } = await service.submit(owner, input); return { request, input, bytes };
}

test('Table metadata plus Box objects restore two-stage reviews, materials, summaries, payment and all retry receipts', async () => {
  const f = reimbursementTableFixture(); let service = f.makeService(); await service.summaries.saveActivity(final, activity);
  const { request, input, bytes } = await claim(f, service);
  await service.analyze(initial, request.bundle.id, 1);
  await service.materialPackets.create(initial, request.id, { revision: 1, bundleId: request.bundle.id, materialsChecked: true });
  const pending = (await service.review(initial, request.id, decision(request, 'initial-approve'))).request;
  service = f.makeService();
  assert.equal((await service.list(owner)).requests[0].status, 'final_pending');
  assert.deepEqual((await service.attachment(owner, request.bundle.id, 0)).bytes, bytes);
  assert.equal((await service.analyze(final, request.bundle.id, 1)).cached, true);
  assert.equal((await service.submit(owner, input)).duplicate, true);
  const approved = (await service.review(final, request.id, decision(pending, 'final-approve'))).request;
  const summaryBody = { activityId: activity.id, activityRevision: 1, selections: [{ requestId: request.id, revision: 1 }],
    form: { handlerName: '合成经办', handlerPhone: 'SYNTHETIC', fillDate: '2026-10-22' }, idempotencyKey: 'summary-one' };
  const generated = await service.summaries.create(final, summaryBody);
  const payment = { revision: 1, stateVersion: approved.stateVersion, amount: '15.00', paidDate: '2026-10-22',
    reference: 'SYNTHETIC', note: '', confirmed: true, idempotencyKey: 'payment-one' };
  await service.registerPayment(final, request.id, payment); service = f.makeService();
  assert.equal((await service.registerPayment(final, request.id, payment)).duplicate, true);
  assert.equal((await service.summaries.create(final, summaryBody)).duplicate, true);
  assert.equal((await service.summaries.download(final, generated.summary.id, 'packet')).bytes.toString(), 'synthetic-packet');
  assert.equal((await service.get(owner, request.id)).request.history.filter(row => row.action === 'payment-recorded').length, 1);
  assert.equal(f.rows.get(f.tables.requests).length, 1); assert.equal(f.rows.get(f.tables.requests)[0]['平台状态'], '已打款');
  assert.equal(f.rows.get(f.tables.requests)[0]['银行卡号'], '0000000000000000');
  assert.equal(f.rows.get(f.tables.summaries).length, 1); assert.ok(f.objects.size >= 3);
  const priorReads = f.state.reads;
  await service.list(owner); await service.summaries.list(final); assert.equal(f.state.reads, priorReads);
  await assert.rejects(service.attachment({ id: 'stranger' }, request.bundle.id, 0), { statusCode: 404 });
  assert.equal(f.state.reads, priorReads);
});

test('missing Box and failed uploads never publish a financial transaction or consume quota', async () => {
  const f = reimbursementTableFixture(), service = f.makeService(); f.state.boxReady = false;
  await assert.rejects(service.preprocess(owner, [{ name: 'synthetic.pdf', bytes: Buffer.from('not parsed') }]), { code: 'reimbursement_box_not_configured' });
  assert.equal(f.calls.length, 0); f.state.boxReady = true;
  await service.summaries.saveActivity(final, activity); const before = (await f.makeStore().load()).version;
  f.state.failFiles = true; await assert.rejects(claim(f, service), { code: 'reimbursement_box_save_failed' });
  assert.equal((await f.makeStore().load()).version, before);
  assert.equal(f.rows.get(f.tables.requests).length, 0);
  f.state.failFiles = false; await claim(f, f.makeService()); assert.equal(f.rows.get(f.tables.requests).length, 1);
});

test('read-only store and incomplete schema stop before any write', async () => {
  const f = reimbursementTableFixture(), state = createReimbursementState(), codec = createMaterialCodec(f.files);
  const previous = await f.makeStore().load();
  await assert.rejects(f.makeStore(false).commit(await codec.encodeState(state), previous), { code: 'reimbursement_writes_disabled' });
  f.metadata.tables.find(table => table.name === f.tables.requests).columns.pop();
  assert.equal((await f.makeStore().inspect()).ready, false);
  await assert.rejects(f.makeStore().load(), { code: 'reimbursement_schema_pending' }); assert.equal(f.calls.length, 0);
});

test('lost journal ACK reconciles once; an unconfirmed publication fences further writes across service recreation', async () => {
  const f = reimbursementTableFixture(); f.state.afterTable = f.tables.journal;
  await f.makeService().summaries.saveActivity(final, activity);
  assert.equal(f.rows.get(f.tables.journal).length, 1); assert.equal(f.state.pending, null);
  f.state.afterTable = null; f.state.beforeTable = f.tables.journal;
  await assert.rejects(f.makeService().summaries.saveActivity(final, { ...activity, revision: 1, name: '未确认变更' }), { code: 'reimbursement_commit_unconfirmed' });
  assert.ok(f.state.pending); const count = f.calls.length;
  f.state.beforeTable = null;
  await assert.rejects(f.makeService().summaries.saveActivity(final, { ...activity, revision: 1, name: '不可重新追加' }), { code: 'reimbursement_commit_unknown' });
  assert.equal(f.calls.length, count); assert.equal((await f.makeService().summaries.listActivities(owner)).activities[0].name, activity.name);
});

test('projection failure keeps accepted submission; retry repairs the same stable row without duplicating a request', async () => {
  const f = reimbursementTableFixture(), service = f.makeService(); await service.summaries.saveActivity(final, activity);
  f.state.afterTable = f.tables.requests; f.state.hideTable = f.tables.requests;
  await assert.rejects(claim(f, service), { code: 'reimbursement_projection_pending' });
  assert.equal(f.rows.get(f.tables.requests).length, 1); f.state.afterTable = null; f.state.hideTable = null;
  const requests = (await f.makeService().list(owner)).requests; assert.equal(requests.length, 1);
  // Another harmless write repairs mirrors by platform ID and preserves the accepted journal.
  await f.makeService().summaries.saveActivity(final, { ...activity, revision: 1 });
  assert.equal(f.rows.get(f.tables.requests).length, 1);
  f.rows.get(f.tables.requests)[0]['报销金额'] = 999;
  await assert.rejects(f.makeService().summaries.saveActivity(final, { ...activity, revision: 2 }), { code: 'reimbursement_projection_changed' });
  assert.equal(f.rows.get(f.tables.requests)[0]['报销金额'], 999);
});

test('corrupt referenced chunks or files fail closed, while stale transactions cannot overwrite accepted versions', async () => {
  const f = reimbursementTableFixture(), service = f.makeService(); await service.summaries.saveActivity(final, activity);
  const previous = await f.makeStore().load(); await service.summaries.saveActivity(final, { ...activity, revision: 1 });
  await assert.rejects(f.makeStore().commit(previous.document, previous), { statusCode: 409 });
  const { request, bytes } = await claim(f, service);
  f.objects.set(checksum(bytes), Buffer.from('corrupt'));
  await assert.rejects(f.makeService().attachment(owner, request.bundle.id, 0), { code: 'reimbursement_material_corrupt' });
  f.rows.get(f.tables.chunks)[0]['内容'] += 'x';
  await assert.rejects(f.makeStore().load(), { code: 'reimbursement_chunk_corrupt' });
});

test('Box placeholder never calls transport; configured downloads require the expected origin, length and checksum', async () => {
  let calls = 0;
  const placeholder = createReimbursementBox({ fetch: async () => { calls++; } });
  await assert.rejects(placeholder.put({}), { code: 'reimbursement_box_not_configured' }); assert.equal(calls, 0);
  const bytes = Buffer.from('synthetic'), sha256 = checksum(bytes);
  const configured = createReimbursementBox({ token: 'synthetic-not-a-real-token', server: 'https://synthetic.box.invalid',
    fetch: async url => String(url).includes('/download-link/')
      ? new Response(JSON.stringify('https://synthetic.box.invalid/content')) : new Response(bytes) });
  assert.deepEqual(await configured.read({ sha256, path: `/报销材料/对象/${sha256.slice(0, 2)}/${sha256}.bin`, size: bytes.length }), bytes);
  await assert.rejects(configured.read({ sha256, path: '/other-library/file', size: bytes.length }));
});

test('large Unicode metadata uses bounded chunks; unpublished failures and unrelated orphan blocks are not replayed', async () => {
  const f = reimbursementTableFixture(), store = f.makeStore(), previous = await store.load();
  const state = createReimbursementState(), codec = createMaterialCodec(f.files);
  state.activities.set('synthetic-large', { name: '合成大记录', description: '合成'.repeat(20000) });
  const document = await codec.encodeState(state);
  f.state.beforeTable = f.tables.chunks;
  await assert.rejects(store.commit(document, previous), { code: 'reimbursement_chunk_save_failed' });
  assert.equal(f.rows.get(f.tables.journal).length, 0);
  f.state.beforeTable = null;
  f.rows.get(f.tables.chunks).push({ _id: 'synthetic-orphan', '块ID': 'orphan', '摘要': 'not-valid', '内容': 'unpublished' });
  await store.commit(document, previous);
  assert.ok(f.rows.get(f.tables.chunks).length > 2);
  assert.ok(f.rows.get(f.tables.chunks).every(row => row['内容'].length <= 48000));
  assert.equal(new Map((await store.load()).document.maps.activities).get('synthetic-large').description, '合成'.repeat(20000));
  f.rows.get(f.tables.journal).push({ ...f.rows.get(f.tables.journal)[0], _id: 'synthetic-fork' });
  await assert.rejects(store.load(), { code: 'reimbursement_journal_conflict' });
});

test('existing financial rows without platform IDs are preserved and never adopted as platform approvals', async () => {
  const f = reimbursementTableFixture(), legacy = { _id: 'synthetic-legacy', '姓名': '合成历史记录', '报销金额': 999, '已打款': true };
  f.rows.get(f.tables.requests).push({ ...legacy });
  const service = f.makeService(); await service.summaries.saveActivity(final, activity); await claim(f, service);
  assert.deepEqual(f.rows.get(f.tables.requests)[0], legacy);
  assert.equal(f.rows.get(f.tables.requests).length, 2);
  assert.equal((await service.list(owner)).requests.length, 1);
});
