import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { reimbursementTableFixture } from './helpers/reimbursement-table-fixture.js';
import { reimbursementTableServer } from './helpers/reimbursements-table-server.js';

const owner = { id: 'owner-a' }, initial = { id: 'initial', financePermissions: ['initial'] },
  final = { id: 'final', realName: '合成终审', phone: 'SYNTHETIC', financePermissions: ['final', 'view'] }, viewer = { id: 'viewer', financePermissions: ['view'] };
const ref = row => ({ requestId: row.requestId, itemId: row.itemId, revision: row.revision, stateVersion: row.stateVersion });
const approve = summary => ({ action: 'approve', stateVersion: summary.stateVersion, materialsChecked: true, scopeConfirmed: true });
async function setup() {
  const fixture = reimbursementTableFixture(); const make = () => fixture.makeService({ workflowVersion: 3 }); const service = make();
  for (const [id, category] of [['a', '生命中心'], ['b', '博爱中心']]) await service.summaries.saveActivity(final, {
    id, name: `合成活动${id}`, category, campus: '苏州', date: '2026-10-20', location: '合成地点', participantCount: 2, description: '隔离合成财务验证',
  });
  const originals = [];
  for (const width of [300, 350]) { const pdf = await PDFDocument.create(); pdf.addPage([width, 200]); originals.push(Buffer.from(await pdf.save())); }
  async function submit(person = owner, label = '支出') {
    const { bundle } = await service.preprocess(person, originals.map((bytes, index) => ({ bytes, name: `invoice-${index}.pdf`, kind: 'invoice', expenseItemId: String(index) })));
    const input = { activityId: 'a', name: '同名申请人', purpose: label, amount: '30.00', expenseDate: '2026-10-20', bundleId: bundle.id,
      expenseItems: [{ id: '0', label: `${label}一`, amount: '10.00' }, { id: '1', label: `${label}二`, amount: '20.00' }], idempotencyKey: bundle.id };
    const { request } = await service.submit(person, input);
    await service.review(initial, request.id, { action: 'initial-approve', revision: request.revision, stateVersion: request.stateVersion, materialsChecked: true });
    return { id: request.id, input, bundle };
  }
  async function summary(activityId, ids, settlements) {
    const { items, activities } = await service.finance.list(final), activity = activities.find(a => a.id === activityId);
    const rows = items.filter(row => row.activityId === activityId && row.canSummarize && (!ids || ids.some(id => id === `${row.requestId}/${row.itemId}`)));
    const byRequest = new Map(); rows.forEach(row => { const selection = byRequest.get(row.requestId) || { requestId: row.requestId, revision: row.revision, stateVersion: row.stateVersion, itemIds: [] };
      selection.itemIds.push(row.itemId); byRequest.set(row.requestId, selection); });
    const result = await service.summaries.create(final, { activityId, activityRevision: activity.revision, selections: [...byRequest.values()],
      itemOrder: rows.map(row => ({ requestId: row.requestId, itemId: row.itemId })), ...(settlements ? { settlements } : {}),
      form: { handlerName: '合成终审', handlerPhone: 'SYNTHETIC', fillDate: '2026-10-22' }, idempotencyKey: crypto.randomUUID() });
    return result.summary;
  }
  const funding = async (batch, changes = {}) => service.finance.registerFunding(final, batch.id, {
    stateVersion: (await service.summaries.get(final, batch.id)).summary.stateVersion, submittedDate: '2026-10-20', receivedDate: '2026-10-21', receivedAmount: (batch.totalCents / 100).toFixed(2), ...changes,
  });
  const pay = async (rows, changes = {}) => service.finance.pay(final, { selections: rows.map(ref), amount: (rows.reduce((s, r) => s + r.payableCents, 0) / 100).toFixed(2),
    paidDate: '2026-10-22', confirmed: true, idempotencyKey: crypto.randomUUID(), ...changes });
  return { service, fixture, make, submit, summary, funding, pay, originals };
}

test('expense rows group by activity category and preserve source identity when one item moves across activities', async () => {
  const { service, submit, summary, fixture, make, originals } = await setup(); const request = await submit();
  const { items } = await service.finance.list(final); assert.equal(items.length, 2); assert.equal(items[0].activityCategory, '生命中心');
  await assert.rejects(service.finance.move(viewer, { selections: [ref(items[0])], activityId: 'b' }), { statusCode: 403 });
  await service.finance.move(final, { selections: [ref(items[0])], activityId: 'b' });
  const moved = (await make().finance.list(final)).items; assert.equal(moved.find(i => i.itemId === '0').activityId, 'b');
  assert.equal(moved.find(i => i.itemId === '0').sourceActivityId, 'a'); assert.equal(moved.find(i => i.itemId === '1').activityId, 'a');
  const b = await summary('b'); assert.deepEqual(b.rows.map(r => r.label), ['支出一']); assert.equal(b.totalCents, 1000);
  assert.deepEqual(b.materialGroups.map(g => g.expenseItemId), ['0']);
  await service.summaries.review(final, b.id, approve(b));
  assert.equal((await service.get(owner, request.id)).request.status, 'final_pending');
  const a = await summary('a'); await service.summaries.review(final, a.id, approve(a));
  assert.equal((await make().get(owner, request.id)).request.status, 'approved');
  const rows = (await service.finance.list(final)).items; assert.equal(rows.filter(r => r.status === 'approved').length, 2);
  await assert.rejects(service.finance.move(final, { selections: [ref(rows[0])], activityId: 'a' }), { statusCode: 409 });
  assert.deepEqual((await service.attachment(owner, request.bundle.id, 0)).bytes, originals[0]);
  assert.ok(fixture.objects.size); assert.equal((await service.get(owner, request.id)).request.amountCents, 3000);
});

test('final amount reductions require reasons, reject foreign items and never replace original requested amounts', async () => {
  const { service, submit, summary } = await setup(); const request = await submit();
  const change = { requestId: request.id, itemId: '0', amount: '8.00', reason: '' };
  await assert.rejects(summary('a', null, [change]), /差额原因/);
  await assert.rejects(summary('a', null, [{ ...change, amount: '10.01', reason: '增加' }]), /不能超过/);
  await assert.rejects(summary('a', null, [{ ...change, itemId: 'foreign', reason: '无效' }]), /未选择/);
  const batch = await summary('a', null, [{ ...change, reason: '部分支出不予报销' }]); assert.equal(batch.totalCents, 2800);
  await service.summaries.review(final, batch.id, approve(batch));
  const rows = (await service.finance.list(final)).items; assert.equal(rows[0].amountCents, 1000); assert.equal(rows[0].approvedCents, 800);
  assert.equal((await service.get(owner, request.id)).request.amountCents, 3000);
});

test('submission and funding are distinct; short receipts require exact per-item allocations and reasons before any payment', async () => {
  const { service, submit, summary, funding, pay } = await setup(); await submit();
  const batch = await summary('a'); await service.summaries.review(final, batch.id, approve(batch));
  const getRows = async () => (await service.finance.list(final)).items;
  await assert.rejects(pay(await getRows()), /尚未登记经费到账/);
  await funding(batch, { receivedDate: '', receivedAmount: '' });
  assert.equal((await getRows())[0].canPay, false);
  await assert.rejects(funding(batch, { receivedAmount: '25.00' }), /逐项分配/);
  const allocations = (await getRows()).map(row => ({ requestId: row.requestId, itemId: row.itemId, amount: row.itemId === '0' ? '5.00' : '20.00', reason: '' }));
  await assert.rejects(funding(batch, { receivedAmount: '25.00', allocations }), /差额原因/);
  allocations[0].reason = '财务核减五元';
  await assert.rejects(funding(batch, { receivedAmount: '24.00', allocations }), /之和/);
  await assert.rejects(funding(batch, { receivedAmount: '25.00', receivedDate: '2026-10-19', allocations }), /不能早于/);
  await funding(batch, { receivedAmount: '25.00', allocations });
  const rows = await getRows(); assert.ok(rows.every(r => r.canPay)); assert.equal(rows[0].payableCents, 500);
  await assert.rejects(pay(rows, { amount: '30.00' }), /总金额/);
  await assert.rejects(pay(rows, { paidDate: '2026-10-20' }), /不能早于/);
  await pay(rows);
  await assert.rejects(funding(batch, { receivedAmount: '30.00' }), /已有打款/);
  assert.equal((await getRows()).reduce((s, r) => s + r.paidCents, 0), 2500);
});

test('batch payments are atomic, versioned and replay safe; same display names retain different owners', async () => {
  const { service, submit, summary, funding, pay, make } = await setup(); await submit(); await submit({ id: 'owner-b' });
  const batch = await summary('a'); await service.summaries.review(final, batch.id, approve(batch)); await funding(batch);
  const rows = (await service.finance.list(final)).items; assert.equal(new Set(rows.map(r => r.owner)).size, 2);
  const firstOwner = rows.filter(r => r.owner === owner.id), key = crypto.randomUUID();
  const input = { selections: firstOwner.map(ref), amount: '30.00', paidDate: '2026-10-22', confirmed: true, idempotencyKey: key };
  const results = await Promise.allSettled([service.finance.pay(final, input), service.finance.pay(final, { ...input, idempotencyKey: 'competitor' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await make().finance.pay(final, input)).duplicate, true);
  await assert.rejects(service.finance.pay(final, { ...input, amount: '29.00' }), { statusCode: 409 });
  await assert.rejects(pay(rows), { statusCode: 409 });
  const current = (await service.finance.list(final)).items; assert.equal(current.filter(r => r.status === 'paid').length, 2);
  await pay(current.filter(r => r.owner === 'owner-b'));
  assert.equal((await make().finance.list(final)).items.filter(r => r.status === 'paid').length, 4);
});

test('partial payments count only once in the ledger and survive Table/Box service recreation', async () => {
  const { service, submit, summary, funding, pay, make } = await setup(); const request = await submit();
  const batch = await summary('a'); await service.summaries.review(final, batch.id, approve(batch)); await funding(batch);
  const rows = (await service.finance.list(final)).items; await pay([rows[0]]);
  const reopened = make(); const current = (await reopened.get(owner, request.id)).request;
  assert.equal(current.paymentStatus, 'partial'); assert.equal(current.paymentRecord.amountCents, 1000);
  assert.equal((await reopened.ledger.list(viewer, {})).totals.paidCents, 1000);
  const latest = (await reopened.finance.list(final)).items; await pay(latest.filter(r => r.status !== 'paid'));
  const complete = (await make().get(owner, request.id)).request; assert.equal(complete.paymentStatus, 'paid'); assert.equal(complete.paymentRecord.amountCents, 3000);
});

test('returning remaining items preserves completed final reviews across initial correction and applicant resubmission', async () => {
  const { service, submit, summary } = await setup(); const { id, input } = await submit();
  const first = await summary('a', [`${id}/0`]); await service.summaries.review(final, first.id, approve(first));
  const remaining = await summary('a'); await service.summaries.review(final, remaining.id, { action: 'return', stateVersion: remaining.stateVersion, note: '第二项补材料' });
  let request = (await service.get(owner, id)).request;
  await service.review(initial, id, { action: 'initial-return', revision: request.revision, stateVersion: request.stateVersion, note: '补第二项发票' });
  request = (await service.get(owner, id)).request;
  const bytes = (await service.attachment(owner, request.bundle.id, 0)).bytes;
  const { bundle } = await service.preprocess(owner, [{ name: 'new.pdf', kind: 'invoice', expenseItemId: '1', bytes }]);
  await assert.rejects(service.submit(owner, { ...input, bundleId: bundle.id, idempotencyKey: 'changed', expenseItems: [{ ...input.expenseItems[0], label: '篡改已终审' }, input.expenseItems[1]] }, id), /已终审/);
  await service.submit(owner, { ...input, bundleId: bundle.id, idempotencyKey: 'resubmission' }, id);
  const rows = (await service.finance.list(final)).items; assert.equal(rows.find(r => r.itemId === '0').status, 'approved');
  assert.equal(rows.find(r => r.itemId === '1').status, 'pending'); assert.equal(rows[0].summaryId, first.id);
});

test('HTTP finance endpoints require reviewer roles and CSRF, and expose no bank or email fields', async t => {
  const f = await reimbursementTableServer(); t.after(() => f.close());
  const url = `${f.origin}/api/reimbursements/finance`;
  assert.equal((await fetch(url, { headers: { 'x-synthetic-user': 'owner' } })).status, 403);
  const response = await fetch(url, { headers: { 'x-synthetic-user': 'final' } }); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.operator.name, '顾语涵'); assert.equal(data.permissions.pay, true);
  assert.equal(JSON.stringify(data).includes('bankAccount'), false); assert.equal(JSON.stringify(data).includes('applicantEmail'), false);
  assert.equal((await fetch(`${url}/move`, { method: 'POST', headers: { 'x-synthetic-user': 'final', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});

test('workspace metadata does not fetch PDF objects, and special item identifiers cannot mutate object prototypes', async () => {
  const { service, fixture, submit, summary } = await setup(); await submit(); const batch = await summary('a');
  await service.summaries.review(final, batch.id, approve(batch));
  const reads = fixture.state.reads; await service.finance.list(final); assert.equal(fixture.state.reads, reads);
  const { financeRecord } = await import('../lib/reimbursements/finance-items.js');
  const request = {}; financeRecord(request, { id: '__proto__' }).activityId = 'safe';
  assert.equal(Object.hasOwn(request.financeItems, '__proto__'), true); assert.equal(({}).activityId, undefined);
});
