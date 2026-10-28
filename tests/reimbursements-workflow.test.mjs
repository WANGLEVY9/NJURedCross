import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PDFDocument } from 'pdf-lib';
import { createLocalReimbursementService } from '../lib/reimbursements/local-service.js';
import { generateItemPackets } from '../lib/reimbursements/item-packets.js';
import { processPdfs } from '../lib/reimbursements/pdf.js';
import { createPreviewServer } from '../scripts/preview-materials.mjs';
import { createLocalSummaries } from '../lib/reimbursements/local-summary.js';
import { seedSummaryDemo } from '../scripts/preview-reimbursement-summary.mjs';

const owner = { id: 'workflow-owner' }, initial = { id: 'workflow-initial', financePermissions: ['initial'] },
  final = { id: 'workflow-final', financePermissions: ['final'] }, viewer = { id: 'workflow-viewer', financePermissions: ['view'] },
  payer = { id: 'workflow-payer', financePermissions: ['payment'] };
const decision = (request, action, extra = {}) => ({ action, revision: request.revision, stateVersion: request.stateVersion,
  materialsChecked: true, note: '', ...extra });
async function setup(options = {}) {
  const service = createLocalReimbursementService({ workflowVersion: 2, processFiles: processPdfs, generatePackets: generateItemPackets, ...options });
  await service.summaries.saveActivity(final, { id: 'workflow-event', name: '合成二级审核活动', date: '2026-10-12', location: '合成地点',
    participantCount: 1, unitName: '合成单位', fundAccount: 'TEST', description: '二级审核合成验证' });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 200]);
  const files = [{ name: 'invoice.pdf', bytes: Buffer.from(await pdf.save()), kind: 'invoice', expenseItemId: 'item' }];
  const { bundle } = await service.preprocess(owner, files);
  const input = { bundleId: bundle.id, name: '合成申请人', amount: '15.00', purpose: '二级审核验证', idempotencyKey: bundle.id,
    activityId: 'workflow-event', expenseItems: [{ id: 'item', category: '办公用品', label: '鼠标', amount: '15.00' }] };
  const { request } = await service.submit(owner, input);
  const generate = request => service.materialPackets.create(initial, request.id, { revision: request.revision, bundleId: request.bundle.id, materialsChecked: true });
  return { service, files, input, request, generate };
}

test('new requests use two distinct stages; only final approval enables summaries and pending payment', async () => {
  const { service, request, generate } = await setup();
  assert.equal(request.workflowVersion, 2); assert.equal(request.statusLabel, '待初审'); assert.equal(request.paymentStatus, 'not-ready');
  await assert.rejects(service.review(final, request.id, decision(request, 'final-approve')), { statusCode: 409 });
  await assert.rejects(service.review(initial, request.id, decision(request, 'approve')), /不能跳过/);
  await assert.rejects(service.review(initial, request.id, decision(request, 'initial-approve')), /先生成/);
  await generate(request);
  assert.equal(service.get(owner, request.id).request.status, 'pending');
  const sent = (await service.review(initial, request.id, decision(request, 'initial-approve'))).request;
  assert.equal(sent.status, 'final_pending'); assert.equal(sent.stateVersion, 2); assert.equal(sent.initialReview.actor, initial.id);
  assert.equal(sent.summaryEligibility.eligible, false); assert.equal(sent.paymentStatus, 'not-ready');
  const approved = (await service.review(final, sent.id, decision(sent, 'final-approve'))).request;
  assert.equal(approved.status, 'approved'); assert.equal(approved.finalReview.actor, final.id);
  assert.equal(approved.paymentStatus, 'pending'); assert.equal(approved.summaryEligibility.eligible, true);
  assert.deepEqual(approved.history.map(item => item.action), ['submit', 'initial-approve', 'final-approve']);
  assert.equal(service.workflowInfo(payer).paymentRegistration, true);
});

test('old single-stage approval and incomplete or stale review proofs never qualify as final approval', () => {
  const summaries = createLocalSummaries({ requests: new Map(), bundles: new Map(), queue: async fn => fn(),
    actorId: () => {}, reviewer: () => {}, now: () => 'synthetic', reserveBytes: () => {} });
  const base = { id: 'legacy', revision: 1, bundleId: 'bundle', status: 'approved', activityId: 'event', expenseItems: [{ id: 'item' }] };
  assert.equal(summaries.eligibility(base).eligible, false);
  const proof = { revision: 1, bundleId: 'bundle' };
  assert.equal(summaries.eligibility({ ...base, workflowVersion: 2, finalReview: proof }).eligible, false);
  assert.equal(summaries.eligibility({ ...base, workflowVersion: 2, initialReview: proof, finalReview: { ...proof, revision: 0 } }).eligible, false);
  assert.equal(summaries.eligibility({ ...base, workflowVersion: 2, initialReview: proof, finalReview: proof }).eligible, true);
});

test('the offline summary preview seeds real two-stage proofs using separate synthetic reviewers', async () => {
  const service = await seedSummaryDemo({ workflowVersion: 2 });
  const claims = service.list(final, true).requests;
  assert.equal(claims.length, 4);
  for (const claim of claims) {
    assert.equal(claim.workflowVersion, 2); assert.equal(claim.status, 'approved');
    assert.notEqual(claim.initialReview.actor, claim.finalReview.actor);
    assert.equal(claim.paymentStatus, 'pending'); assert.equal(claim.summaryEligibility.eligible, true);
  }
});

test('permissions do not inherit material administrator rights; each stage and read-only access remain separated', async () => {
  const { service, request, generate } = await setup();
  const materialAdmin = { id: 'material-only', canReview: true };
  assert.throws(() => service.list(materialAdmin, true), { statusCode: 403 });
  assert.throws(() => service.review(materialAdmin, request.id, decision(request, 'initial-approve')), { statusCode: 403 });
  assert.throws(() => service.materialPackets.create(final, request.id, { revision: 1, bundleId: request.bundle.id, materialsChecked: true }), { statusCode: 403 });
  assert.equal(service.list(payer, true).requests.length, 0);
  assert.equal(service.list(viewer, true).requests.length, 1);
  await assert.rejects(service.review(viewer, request.id, decision(request, 'initial-approve')), { statusCode: 403 });
  assert.throws(() => service.summaries.saveActivity(initial, {}), { statusCode: 403 });
  await generate(request);
  const sent = (await service.review(initial, request.id, decision(request, 'initial-approve'))).request;
  await assert.rejects(service.review(initial, sent.id, decision(sent, 'final-approve')), { statusCode: 403 });
  const approved = (await service.review(final, sent.id, decision(sent, 'final-approve'))).request;
  assert.equal(service.list(payer, true).requests[0].id, approved.id);
  assert.throws(() => service.summaries.preview(viewer, {}), { statusCode: 403 });
});

test('final returns to initial; initial can recheck the same version and resubmit without involving the applicant', async () => {
  const { service, request, generate, input } = await setup(); await generate(request);
  const sent = (await service.review(initial, request.id, decision(request, 'initial-approve'))).request;
  await assert.rejects(service.review(final, request.id, decision(sent, 'final-return')), /退回原因/);
  const back = (await service.review(final, request.id, decision(sent, 'final-return', { note: '请再次核对订单金额' }))).request;
  assert.equal(back.status, 'initial_returned'); assert.equal(back.revision, 1);
  const { bundle } = await service.preprocess(owner, [{ name: 'other.pdf', bytes: service.attachment(owner, request.bundle.id, 0).bytes, kind: 'invoice', expenseItemId: 'item' }]);
  await assert.rejects(service.submit(owner, { ...input, idempotencyKey: bundle.id, bundleId: bundle.id }, back.id), { statusCode: 409 });
  await service.materialPackets.create(initial, back.id, { revision: back.revision, bundleId: back.bundle.id, materialsChecked: true });
  const again = (await service.review(initial, back.id, decision(back, 'initial-approve', { note: '已重新核对' }))).request;
  assert.equal(again.status, 'final_pending'); assert.equal(again.revision, 1); assert.equal(again.stateVersion, 4);
  assert.equal(again.history.findLast(event => event.action === 'final-return').note, '请再次核对订单金额');
});

test('applicant supplements only after initial return; new material versions invalidate prior reviews and packet URLs', async () => {
  const { service, request, generate, files, input } = await setup(); await generate(request);
  const sent = (await service.review(initial, request.id, decision(request, 'initial-approve'))).request;
  const back = (await service.review(final, request.id, decision(sent, 'final-return', { note: '缺材料' }))).request;
  const returned = (await service.review(initial, request.id, decision(back, 'initial-return', { note: '请补充订单截图' }))).request;
  assert.equal(returned.status, 'returned');
  const { bundle } = await service.preprocess(owner, files);
  const resubmitted = (await service.submit(owner, { ...input, bundleId: bundle.id, idempotencyKey: bundle.id }, request.id)).request;
  assert.equal(resubmitted.revision, 2); assert.equal(resubmitted.status, 'pending');
  assert.equal(resubmitted.initialReview, null); assert.equal(resubmitted.finalReview, null); assert.equal(resubmitted.paymentStatus, 'not-ready');
  assert.equal(service.materialPackets.list(initial, request.id).packets, null);
  assert.throws(() => service.materialPackets.download(final, request.id, 1, 0, 'merged'), { statusCode: 409 });
  await assert.rejects(service.review(final, request.id, decision(sent, 'final-approve')), { statusCode: 409 });
  assert.equal(resubmitted.history.length, 5);
});

test('material version alone cannot authorize stale actions after a return cycle; concurrent decisions commit once', async () => {
  const { service, request, generate } = await setup(); await generate(request);
  const actions = await Promise.allSettled([service.review(initial, request.id, decision(request, 'initial-approve')),
    service.review(initial, request.id, decision(request, 'initial-return', { note: '竞争操作' }))]);
  assert.equal(actions.filter(item => item.status === 'fulfilled').length, 1);
  const sent = service.get(owner, request.id).request;
  const back = (await service.review(final, sent.id, decision(sent, 'final-return', { note: '重新核对' }))).request;
  const resent = (await service.review(initial, back.id, decision(back, 'initial-approve'))).request;
  await assert.rejects(service.review(final, sent.id, decision(sent, 'final-approve')), { statusCode: 409 });
  await service.review(final, resent.id, decision(resent, 'final-approve'));
});

test('different reviewer rule is configurable and body fields cannot override it or grant permissions', async () => {
  const both = { id: initial.id, financePermissions: ['initial', 'final'] };
  const { service, request, generate } = await setup({ requireDistinctReviewers: true }); await generate(request);
  const sent = (await service.review(both, request.id, decision(request, 'initial-approve'))).request;
  await assert.rejects(service.review(both, request.id, decision(sent, 'final-approve')), { statusCode: 403 });
  await assert.rejects(service.review(final, request.id, decision(sent, 'final-approve', { financePermissions: ['final'], actor: 'other' })), { statusCode: 400 });
  await service.review(final, request.id, decision(sent, 'final-approve'));
});

test('HTTP stage transitions use explicit permissions and CSRF; old approve cannot bypass the workflow', async t => {
  const { service, request, generate } = await setup(); await generate(request);
  const actor = { ...initial, canReview: true };
  const server = await createPreviewServer({ reimbursementService: service, portalActor: actor, seedSyncFailure: false });
  server.listen(0); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  const auth = await fetch(root + '/api/auth/session'), session = await auth.json();
  const headers = { Cookie: auth.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' };
  const url = root + `/api/preview/reimbursements/requests/${request.id}/review`;
  const config = await (await fetch(root + '/api/preview/reimbursements/config', { headers })).json();
  assert.equal(config.workflow.version, 2); assert.deepEqual(config.workflow.permissions, ['initial']);
  assert.equal((await fetch(url, { method: 'POST', headers: { Cookie: headers.Cookie }, body: JSON.stringify(decision(request, 'initial-approve')) })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(decision(request, 'approve')) })).status, 400);
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(decision(request, 'initial-approve')) });
  assert.equal(response.status, 200);
  const sent = (await response.json()).request;
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(decision(sent, 'final-approve')) })).status, 403);
});
