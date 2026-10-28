import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { reimbursementTableFixture } from './helpers/reimbursement-table-fixture.js';
import { reimbursementTableServer } from './helpers/reimbursements-table-server.js';
import { reimbursementMaterialIssues, requiredReimbursementMaterials } from '../public/app/shared/reimbursement-material-rules.js';
import { reimbursementActivityCatalogue } from '../lib/reimbursements/activity-catalogue.js';
import { applyRequestActivityCorrection, financeRecord } from '../lib/reimbursements/finance-items.js';

const owner = { id: 'synthetic-owner' }, initial = { id: 'synthetic-initial-suzhou', financePermissions: ['initial'], financeRegion: 'initial-suzhou' },
  final = { id: 'synthetic-final', financePermissions: ['final', 'view'] }, viewer = { id: 'viewer', financePermissions: ['view'] };
async function seed(service, { strict = false, date = '2026-10-20' } = {}) {
  await service.summaries.saveActivity(final, { id: 'event', name: '合成活动', campus: '苏州', date, participantCount: 2, location: '合成地点', description: '合成活动目的' });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 200]); const bytes = Buffer.from(await pdf.save());
  const { bundle } = await service.preprocess(owner, [{ name: 'invoice.pdf', kind: 'invoice', expenseItemId: 'a', bytes },
    { name: 'order.pdf', kind: 'supporting', materialType: '订单截图', expenseItemId: 'a', bytes }]);
  const input = { name: '合成申请人', purpose: '原事由', amount: '20.00', activityId: 'event', expenseDate: date, voucherNote: '',
    ...(strict ? { materialRulesVersion: 1, meetingRelated: false, singleOrderConfirmed: true } : {}),
    expenseItems: [{ id: 'a', category: strict ? '火车票/高铁票' : '用品', ...(strict ? { railJourney: { fromStation: '南京南', toStation: '上海虹桥', journey: '单程' } } : {}), label: '原物品', amount: '20.00', note: '原用途' }], bundleId: bundle.id, idempotencyKey: bundle.id };
  return { request: (await service.submit(owner, input)).request, input, bytes };
}
async function returned(service) {
  const seeded = await seed(service);
  seeded.request = (await service.review(initial, seeded.request.id, { action: 'initial-return', revision: 1, stateVersion: 1, note: '请补充付款截图' })).request;
  return seeded;
}
const source = (item, entries) => ({ requestId: item.id, revision: item.revision, stateVersion: item.stateVersion, bundleId: item.bundle.id, entries });
const edits = item => ({ activityId: item.activityId, activityName: '修订活动', campus: '南京', amount: '18.00', purpose: '修订事由',
  expenseDate: '2026-10-21', voucherNote: '修订说明', expenseItems: [{ id: 'a', category: '打印材料', label: '修订物品', amount: '18.00', note: '修订用途' }] });

test('each agreed category has its own required materials, meeting invitation is conditional, and Word cannot replace screenshot evidence', () => {
  for (const category of ['火车票/高铁票', '机票', '物资采买', '打印材料', '打车', '快递', '住宿']) {
    const body = { materialRulesVersion: 1, singleOrderConfirmed: true, meetingRelated: false, expenseItems: [{ category }] };
    const files = requiredReimbursementMaterials(category).map(type => ({ name: `${type}.pdf`, kind: type === '发票' ? 'invoice' : 'supporting', materialType: type }));
    assert.deepEqual(reimbursementMaterialIssues(body, files), []);
    for (const file of files) assert.ok(reimbursementMaterialIssues(body, files.filter(other => other !== file)).length);
    assert.match(reimbursementMaterialIssues({ ...body, meetingRelated: true }, files).join(), /会议邀请函/);
    assert.ok(reimbursementMaterialIssues({ ...body, singleOrderConfirmed: false }, files).length);
  }
  assert.ok(reimbursementMaterialIssues({ materialRulesVersion: 1, singleOrderConfirmed: true, meetingRelated: false, expenseItems: [{ category: '物资采买' }] }, [
    { kind: 'invoice', name: 'invoice.pdf' }, { kind: 'supporting', materialType: '订单和付款截图', name: 'screenshots.docx' }]).length);
  assert.deepEqual(reimbursementMaterialIssues({ expenseItems: [{ category: '旧类别' }] }, []), []);
});

test('Box-backed original references can retain, remove, replace and append without changing the historical bundle', async () => {
  const f = reimbursementTableFixture(), make = () => f.makeService({ workflowVersion: 3 });
  const { request, input, bytes } = await returned(make());
  const pdf = await PDFDocument.create(); pdf.addPage([330, 200]); const replacement = Buffer.from(await pdf.save());
  const { bundle } = await make().preprocess(owner, [{ name: 'payment.pdf', bytes: replacement, kind: 'supporting', materialType: '付款截图', expenseItemId: 'a' }],
    source(request, [{ originalIndex: 0, expenseItemId: 'a' }, { uploadIndex: 0, expenseItemId: 'a', materialType: '付款截图' }]));
  const restored = make();
  assert.deepEqual((await restored.attachment(owner, bundle.id, 0)).bytes, bytes);
  assert.deepEqual((await restored.attachment(owner, bundle.id, 1)).bytes, replacement);
  assert.deepEqual((await restored.attachment(owner, request.bundle.id, 1)).bytes, bytes);
  const result = await restored.submit(owner, { ...input, bundleId: bundle.id, idempotencyKey: bundle.id }, request.id);
  assert.equal(result.request.id, request.id); assert.equal(result.request.revision, 2);
  assert.equal(result.request.bundle.originalUrls.length, 2); assert.equal(result.request.bundle.sources[1].materialType, '付款截图');
  assert.equal(result.request.history[0].bundleId, request.bundle.id);
});

test('metadata-only corrections retain all originals without a new upload and reject foreign, stale, duplicate or forged references', async () => {
  const f = reimbursementTableFixture(), s = f.makeService({ workflowVersion: 3 }), { request, input } = await returned(s);
  const all = source(request, [{ originalIndex: 0 }, { originalIndex: 1 }]);
  for (const context of [{ ...all, revision: 99 }, { ...all, entries: [{ originalIndex: 9 }] },
    { ...all, entries: [{ originalIndex: 0 }, { originalIndex: 0 }] }, { ...all, entries: [{ originalIndex: 0, uploadIndex: 0 }] },
    { ...all, entries: [{ originalIndex: 0, url: 'https://example.invalid/private' }] }]) await assert.rejects(s.preprocess(owner, [], context));
  await assert.rejects(s.preprocess({ id: 'another-owner' }, [], all));
  const { bundle } = await s.preprocess(owner, [], all);
  await assert.rejects(s.submit(owner, { ...input, bundleId: bundle.id, idempotencyKey: bundle.id }));
  const next = await s.submit(owner, { ...input, purpose: '只改文字', bundleId: bundle.id, idempotencyKey: bundle.id }, request.id);
  assert.equal(next.request.revision, 2);
  await assert.rejects(s.preprocess(owner, [], all), /版本|状态/);
});

test('final corrections preserve initial approval and original bytes, update packet names, audit category and invalidate old drafts', async () => {
  const f = reimbursementTableFixture(), s = f.makeService({ workflowVersion: 3 });
  const { request } = await seed(s);
  const sent = (await s.review(initial, request.id, { action: 'initial-approve', revision: 1, stateVersion: 1, materialsChecked: true })).request;
  const a = (await s.summaries.listActivities(final)).activities.find(a => a.id === 'event');
  const draft = await s.summaries.create(final, { activityId: a.id, activityRevision: a.revision,
    selections: [{ requestId: sent.id, revision: sent.revision, stateVersion: sent.stateVersion, itemIds: ['a'] }],
    form: { handlerName: '合成终审', handlerPhone: 'SYNTHETIC', fillDate: '2026-10-22' }, idempotencyKey: 'draft-before-edit' });
  const before = (await s.attachment(final, request.bundle.id, 0)).bytes;
  const body = { revision: sent.revision, stateVersion: sent.stateVersion, changes: edits(sent) };
  for (const actor of [owner, initial, viewer]) await assert.rejects(s.editRequest(actor, sent.id, body), /权限/);
  const result = (await s.editRequest(final, sent.id, body)).request;
  assert.equal(result.initialReview.actor, sent.initialReview.actor); assert.equal(result.status, 'final_pending');
  assert.equal(result.initialAssignment.name, sent.initialAssignment.name); assert.equal(result.amountCents, 1800);
  assert.equal(result.expenseItems[0].category, '打印材料'); assert.equal(result.history.at(-1).action, 'finance-request-edited');
  assert.equal(result.history.at(-1).changes.before.expenseItems[0].category, '用品');
  assert.deepEqual((await s.attachment(final, request.bundle.id, 0)).bytes, before);
  assert.match((await s.materialPackets.list(final, request.id)).packets.groups[0].merged.name, /修订物品-18.00/);
  await assert.rejects(s.editRequest(final, sent.id, body), /版本/);
  await assert.rejects(s.summaries.review(final, draft.summary.id, { action: 'approve', stateVersion: draft.summary.stateVersion, materialsChecked: true, scopeConfirmed: true }), /变化|版本/);
});

test('new production forms cannot bypass category evidence, one-order confirmation or the activity date window', async () => {
  const f = reimbursementTableFixture(), s = f.makeService({ workflowVersion: 3, requireMaterialRules: true });
  const { request, input } = await seed(s, { strict: true });
  assert.equal(request.materialRulesVersion, 1);
  const { bundle } = await s.preprocess(owner, [{ name: 'invoice.pdf', bytes: (await s.attachment(owner, request.bundle.id, 0)).bytes, kind: 'invoice', expenseItemId: 'a' }]);
  const fresh = { ...input, bundleId: bundle.id, idempotencyKey: bundle.id };
  for (const body of [{ ...fresh, materialRulesVersion: undefined }, { ...fresh, singleOrderConfirmed: false }, { ...fresh, meetingRelated: true },
    { ...fresh, expenseItems: [{ ...fresh.expenseItems[0], category: '打车' }] }]) await assert.rejects(s.submit(owner, body));
  const activity = (await s.summaries.listActivities(final)).activities[0];
  assert.equal(activity.name, '合成活动');
  await s.summaries.saveActivity(final, { id: 'old-activity', campus: '苏州', name: '过期活动', date: '2020-01-01' });
  await assert.rejects(s.submit(owner, { ...fresh, activityId: 'old-activity' }), /30 天/);
});

test('finance catalogue includes approved ended activities, excludes drafts and superseded rows, and does not invent attendance', async () => {
  const row = { _id: 'ended', 状态: '已结束', 活动名称: '近期已结束活动', 活动类别: '普通活动', 组织类别: '生命中心', 活动地区: 'suzhou', 报名日期: '2026-10-20', 工作内容: '活动目的' };
  const result = reimbursementActivityCatalogue([], [row, { ...row, _id: 'draft', 状态: '草稿' }, { ...row, _id: 'old', sourceSuperseded: true }, { ...row, _id: 'unapproved' }], item => item._id !== 'unapproved');
  assert.equal(result.length, 1); assert.equal(result[0].campus, '苏州'); assert.equal(result[0].category, '生命中心');
  const f = reimbursementTableFixture(), s = f.makeService({ workflowVersion: 3, activityProvider: async () => result });
  const a = (await s.summaries.listActivities(final)).activities[0]; assert.equal(a.description, '活动目的'); assert.equal(a.participantCount, null);
  const explicit = reimbursementActivityCatalogue([], [{ ...row, 活动人数: '12' }], () => true);
  assert.equal(explicit[0].participantCount, 12);
});

test('correcting activity cannot move already approved expense rows', () => {
  const request = { activityId: 'old', expenseItems: [{ id: 'a' }, { id: 'b' }] };
  financeRecord(request, request.expenseItems[0]).finalReview = { summaryId: 'archived' };
  applyRequestActivityCorrection(request, 'new'); request.activityId = 'new';
  assert.equal(request.financeItems.a.activityId, 'old'); assert.equal(request.financeItems.b.activityId, 'new');
});

test('multipart retained-only upload and final correction routes enforce CSRF and ownership', async t => {
  const f = await reimbursementTableServer(); t.after(() => f.close());
  const s = f.fixture.makeService({ workflowVersion: 3 }), { request } = await returned(s);
  const form = () => { const data = new FormData(); data.append('revisionSource', JSON.stringify(source(request, [{ originalIndex: 0 }]))); data.append('manifest', '[]'); return data; };
  assert.equal((await fetch(f.origin + '/api/reimbursements/bundles', { method: 'POST', body: form() })).status, 403);
  const response = await fetch(f.origin + '/api/reimbursements/bundles', { method: 'POST', headers: { 'x-csrf-token': f.csrf }, body: form() });
  assert.equal(response.status, 201); assert.equal((await response.json()).bundle.originalUrls.length, 1);
  assert.equal((await fetch(`${f.origin}/api/reimbursements/requests/${request.id}/edit`, { method: 'POST', headers: { 'x-synthetic-user': 'final', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});
