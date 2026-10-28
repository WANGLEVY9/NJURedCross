import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { reimbursementTableFixture } from './helpers/reimbursement-table-fixture.js';
import { reimbursementTableServer } from './helpers/reimbursements-table-server.js';

const owner = { id: 'synthetic-owner' }, initial = { id: 'synthetic-initial-suzhou', financePermissions: ['initial'], financeRegion: 'initial-suzhou' },
  other = { id: 'synthetic-initial-other', financePermissions: ['initial'], financeRegion: 'initial-other' },
  final = { id: 'synthetic-final', financePermissions: ['final', 'view'] };
async function seed(service) {
  for (const [id, campus] of [['synthetic-event', '苏州'], ['synthetic-other', '仙林']])
    await service.summaries.saveActivity(final, { id, campus, name: `${campus}原活动`, date: '2026-10-20', location: '合成地点', participantCount: 2, description: '隔离修订验证' });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 200]); const bytes = Buffer.from(await pdf.save());
  const { bundle } = await service.preprocess(owner, [{ name: 'original.pdf', bytes, kind: 'invoice', expenseItemId: 'a' }]);
  const input = { name: '合成申请人', purpose: '原事由', amount: '20.00', expenseDate: '2026-10-20', voucherNote: '',
    activityId: 'synthetic-event', expenseItems: [{ id: 'a', label: '原物资', amount: '20.00', note: '原用途' }], bundleId: bundle.id, idempotencyKey: bundle.id };
  return { request: (await service.submit(owner, input)).request, bytes };
}
const changes = () => ({ activityId: 'synthetic-other', activityName: '修订活动名称', campus: '南京', amount: '18.50',
  purpose: '修订采购事由', expenseDate: '2026-10-21', voucherNote: '特殊情况说明示例',
  expenseItems: [{ id: 'a', label: '修订物资', amount: '18.50', note: '修订活动用途' }] });
const approve = (item, edits = changes()) => ({ action: 'initial-approve', revision: item.revision, stateVersion: item.stateVersion, materialsChecked: true, changes: edits });

test('initial corrections atomically enter final review, keep identity and reviewer binding, and update packets, projections and ledger', async () => {
  const f = reimbursementTableFixture(), service = () => f.makeService({ workflowVersion: 3 });
  const { request, bytes } = await seed(service());
  const oldPacket = await service().materialPackets.download(initial, request.id, 1, 0, 'merged');
  const edited = (await service().review(initial, request.id, approve(request))).request;
  assert.equal(edited.status, 'final_pending'); assert.equal(edited.statusLabel, '待复审');
  assert.equal(edited.id, request.id); assert.equal(edited.code, request.code); assert.equal(edited.owner, request.owner); assert.equal(edited.name, request.name);
  assert.equal(edited.revision, request.revision); assert.equal(edited.bundleId, request.bundleId); assert.equal(edited.stateVersion, request.stateVersion + 1);
  assert.equal(edited.amountCents, 1850); assert.equal(edited.activityName, '修订活动名称'); assert.equal(edited.activityId, 'synthetic-other');
  assert.equal(edited.initialAssignment.campus, '南京'); assert.equal(edited.initialAssignment.key, request.initialAssignment.key);
  assert.equal(edited.initialAssignment.name, '李婉荣'); assert.equal(edited.initialReview.actor, initial.id);
  assert.equal(edited.expenseItems[0].label, '修订物资'); assert.equal(edited.expenseItems[0].note, '修订活动用途');
  assert.equal(edited.expenseDate, '2026-10-21'); assert.equal(edited.voucherNote, '特殊情况说明示例');
  assert.equal(edited.history.at(-1).changes.before.amountCents, 2000); assert.equal(edited.history.at(-1).changes.after.amountCents, 1850);
  assert.equal((await service().summaries.listActivities(final)).activities.find(activity => activity.id === 'synthetic-other').name, '仙林原活动');
  await assert.rejects(service().get(other, request.id, true), { statusCode: 404 });
  assert.deepEqual((await service().attachment(owner, request.bundleId, 0)).bytes, bytes);
  assert.match((await service().get(owner, request.id)).request.bundle.originalUrls[0].name, /修订物资-18\.50/);
  const packet = await service().materialPackets.download(final, request.id, 1, 0, 'merged');
  assert.deepEqual(packet.bytes, oldPacket.bytes); assert.match(packet.name, /修订物资-18\.50/);
  const row = f.rows.get(f.tables.requests)[0]; assert.equal(row['报销金额'], 18.5); assert.equal(row['活动名称'], '修订活动名称'); assert.equal(row['活动时间'], '2026-10-21');
  const ledger = await service().ledger.list(final, {}); assert.equal(ledger.rows[0].activity, '修订活动名称');
  const activity = (await service().summaries.listActivities(final)).activities.find(activity => activity.id === 'synthetic-other');
  const { summary } = await service().summaries.preview(final, { activityId: activity.id, activityRevision: activity.revision,
    selections: [{ requestId: edited.id, revision: edited.revision, stateVersion: edited.stateVersion }],
    form: { handlerName: '合成经办', handlerPhone: 'SYNTHETIC', fillDate: '2026-10-26' } });
  assert.equal(summary.totalCents, 1850); assert.equal(summary.rows[0].label, '修订物资');
});

test('forged identity, state, reviewer fields, item IDs, invalid dates or totals cannot partially change a request', async () => {
  const f = reimbursementTableFixture(), service = f.makeService({ workflowVersion: 3 });
  const { request } = await seed(service);
  const bad = [
    { ...changes(), name: '篡改申请人' }, { ...changes(), owner: 'stranger' }, { ...changes(), status: 'approved' },
    { ...changes(), initialAssignment: { key: 'initial-other' } }, { ...changes(), activityId: 'missing' },
    { ...changes(), campus: '鼓楼' }, { ...changes(), expenseDate: '2026-02-30' }, { ...changes(), amount: '19.00' },
    { ...changes(), expenseItems: [{ id: 'forged', label: '篡改关联', amount: '18.50' }] },
  ];
  for (const edit of bad) {
    await assert.rejects(service.review(initial, request.id, approve(request, edit)), { statusCode: 400 });
    const current = (await service.get(owner, request.id)).request;
    assert.equal(current.amountCents, 2000); assert.equal(current.status, 'pending'); assert.equal(current.history.length, 1);
    assert.equal((await service.materialPackets.list(initial, request.id)).packets.groups[0].label, '原物资');
  }
  await assert.rejects(service.review(other, request.id, approve(request)), { statusCode: 404 });
  await assert.rejects(service.review(final, request.id, approve(request)), { statusCode: 403 });
  await assert.rejects(service.review(initial, request.id, { ...approve(request), materialsChecked: false }), { statusCode: 400 });
});

test('stale concurrent edits apply once and cannot alter a later stage or save via return', async () => {
  const f = reimbursementTableFixture(), service = f.makeService({ workflowVersion: 3 });
  const { request } = await seed(service);
  await assert.rejects(service.review(initial, request.id, { ...approve(request), action: 'initial-return', note: '需要补充' }), { statusCode: 400 });
  const results = await Promise.allSettled([service.review(initial, request.id, approve(request)), service.review(initial, request.id, approve(request))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const edited = (await service.get(owner, request.id)).request;
  assert.equal(edited.history.filter(event => event.changes).length, 1);
  await assert.rejects(service.review(final, request.id, { ...approve(edited), action: 'final-return', note: '交初审核对' }), { statusCode: 400 });
});

test('formal API accepts applications without bank details and saves permitted initial edits with CSRF checks', async t => {
  const f = await reimbursementTableServer(); t.after(() => f.close());
  const { request } = await seed(f.fixture.makeService({ workflowVersion: 3 }));
  assert.equal(request.bankAccount, undefined);
  const config = await (await fetch(f.origin + '/api/reimbursements/config')).json(); assert.equal(config.bankAccount, false);
  const url = `${f.origin}/api/reimbursements/requests/${request.id}/review`;
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-synthetic-user': 'initial-suzhou' }, body: JSON.stringify(approve(request)) })).status, 403);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-synthetic-user': 'initial-suzhou', 'x-csrf-token': f.csrf }, body: JSON.stringify(approve(request)) });
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.request.amountCents, 1850); assert.equal(result.request.status, 'final_pending');
});

test('initial corrections after a final return invalidate an earlier activity draft even with unchanged original files', async () => {
  const f = reimbursementTableFixture(), service = f.makeService({ workflowVersion: 3 });
  const { request } = await seed(service);
  const sent = (await service.review(initial, request.id, { action: 'initial-approve', revision: request.revision,
    stateVersion: request.stateVersion, materialsChecked: true })).request;
  const activity = (await service.summaries.listActivities(final)).activities.find(activity => activity.id === request.activityId);
  const { summary } = await service.summaries.create(final, { activityId: activity.id, activityRevision: activity.revision,
    selections: [{ requestId: sent.id, revision: sent.revision, stateVersion: sent.stateVersion }],
    form: { handlerName: '合成经办', handlerPhone: 'SYNTHETIC', fillDate: '2026-10-26' }, idempotencyKey: 'synthetic-draft' });
  const back = (await service.review(final, sent.id, { action: 'final-return', revision: sent.revision, stateVersion: sent.stateVersion, note: '请核对名称和金额' })).request;
  await service.review(initial, back.id, approve(back));
  await assert.rejects(service.summaries.review(final, summary.id, { action: 'approve', stateVersion: summary.stateVersion,
    materialsChecked: true, scopeConfirmed: true }), { statusCode: 409 });
});
